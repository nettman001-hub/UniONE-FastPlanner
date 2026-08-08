'use client';

/**
 * 고른 화면을 구글 스티치에 **실제로 만든다.**
 *
 * 요청문을 복사해 붙여 넣는 길과 나란히 둔다. 붙여 넣기는 아무 준비 없이 바로
 * 되고, 이쪽은 연결이 한 번 필요한 대신 여러 화면을 한꺼번에 만든다.
 *
 * 자격증명은 이 화면을 지나가지 않는다. 저장은 서버로 보내고, 이후로는 서버가
 * 대신 부른다. 여기서는 연결됐는지와 꼬리표만 안다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Sparkles,
  Unlink,
  X,
} from 'lucide-react';

import { Spinner, useToast } from './ui';
import { DESIGN_SKILLS, findSkill, skillSummary } from '@/lib/design/skills';
import {
  forgetProject,
  projectUrlOf,
  reset as resetRun,
  restore,
  snapshot,
  start,
  stop as stopRun,
  subscribe,
  serverSnapshot,
} from '@/lib/design/stitch-runner';
import { useStitchConnection } from '@/lib/design/useStitchConnection';
import type { Plan } from '@/lib/types';

/**
 * 한 번에 몇 개까지 고를 수 있나 — **제한을 두지 않는다.**
 *
 * 예전에는 8개였다. 화면 전부를 한 요청에 몰아넣던 시절, 서버 함수 제한시간을
 * 넘기지 않으려던 값이다. 지금은 화면마다 요청을 따로 보내므로 그 이유가 사라졌다.
 *
 * 다만 24개를 걸면 20분 넘게 걸리고 사용량도 그만큼 나간다. 막지는 않되
 * **얼마나 걸릴지 미리 알려 주고**, 많이 고르면 한 번 더 묻는다.
 */
const CONFIRM_OVER = 10;

/** 화면 하나에 걸리는 대략 시간. 안내용 어림수다. */
const SECONDS_EACH = 45;

interface Model {
  id: string;
  label: string;
  /** 무거운 쪽 — 결과는 낫지만 월 사용 횟수가 적다. */
  heavy: boolean;
}

/**
 * 와이어프레임을 얼마나 그대로 지킬지.
 *
 * 스티치에는 이런 조절값이 **없다.** 받는 인자가 다섯 개뿐이고 가중치·온도 같은
 * 것은 아예 없다. 그래서 우리가 손댈 수 있는 유일한 자리인 **요청문 문장**으로
 * 무게를 옮긴다. 도구에게 무엇을 더 중히 여기라고 말로 이르는 것이다.
 */
type Emphasis = 'strict' | 'balanced' | 'free';

const EMPHASIS_UI: Array<{ key: Emphasis; name: string; what: string }> = [
  { key: 'strict', name: '그대로', what: '적어 둔 항목과 순서를 그대로 씁니다.' },
  { key: 'balanced', name: '균형', what: '내용은 지키고 여백·정렬은 알아서 다듬습니다.' },
  { key: 'free', name: '자유롭게', what: '내용만 지키고 배치는 더 나은 쪽으로 바꿉니다.' },
];

export function StitchRun({ plan }: { plan: Plan }) {
  const toast = useToast();
  /* 연결은 설정 화면과 같은 것을 쓴다 — 계정에 하나뿐인 상태라 두 벌로 두면 어긋난다. */
  const { status, secret, setSecret, saving, connect, disconnect, error, markDisconnected } =
    useStitchConnection();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** 고를 수 있는 모델. 스티치에서 받아 온다. */
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  /** 와이어프레임을 얼마나 그대로 지킬지. */
  const [emphasis, setEmphasis] = useState<Emphasis>('strict');
  /** 고른 디자인 스킬 — 서비스 전체의 결을 정한다. */
  const [skill, setSkill] = useState('clean');
  const [skillOpen, setSkillOpen] = useState(false);

  /*
   * 진행 상태는 **이 컴포넌트가 갖고 있지 않다.**
   *
   * 갖고 있으면 화면을 떠날 때 함께 사라진다. 사장님이 겪은 일이 그것이다 —
   * 만드는 중에 홈에 다녀오니 판이 통째로 비어 있었다. 지금은 모듈에 두고
   * 여기서는 구독만 한다. 다녀와도 돌던 것이 그대로 보이고, 자리를 비운
   * 사이에도 계속 만들어진다.
   */
  const session = useSyncExternalStore(
    useCallback((fn) => subscribe(plan.id, fn), [plan.id]),
    useCallback(() => snapshot(plan.id), [plan.id]),
    serverSnapshot,
  );
  const { running, progress, project, summary, restored } = session;
  const projectUrl = project ? projectUrlOf(project.projectId) : null;

  const pages = useMemo(() => (plan.iaPages ?? []).filter((p) => p.type === 'page'), [plan.iaPages]);
  const withWireframe = useMemo(
    () => new Set((plan.wireframes ?? []).map((w) => w.pageId)),
    [plan.wireframes],
  );
  /** 지난번까지 스티치에 이미 만들어 둔 화면들. */
  const made = useMemo(() => new Set(Object.keys(project?.screens ?? {})), [project]);

  /*
   * 처음 열 때 미리 골라 둔다 — 그림이 있고 **아직 안 만든** 화면들.
   *
   * 이미 만든 것까지 골라 두면, 다시 들어온 사람이 그대로 눌러 같은 화면을 또
   * 만든다. 사용량이 두 배로 나가고 스티치에는 같은 화면이 두 벌 쌓인다.
   * 다시 만들고 싶으면 직접 체크하거나 `전체 선택` 을 누르면 된다.
   *
   * 저장해 둔 것을 다 읽기 전에는 무엇을 만들었는지 모른다. 그래서 기다린다.
   */
  useEffect(() => {
    if (!restored) return;
    setPicked((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set(
        pages.filter((p) => withWireframe.has(p.id) && !made.has(p.id)).map((p) => p.id),
      );
      return next.size > 0 ? next : prev;
    });
  }, [pages, withWireframe, made, restored]);

  /* 고를 수 있는 모델은 스티치에서 받아 온다 — 저쪽이 새 모델을 내면 바로 나온다. */
  useEffect(() => {
    let alive = true;
    fetch('/api/design/stitch/models')
      .then((r) => r.json())
      .then((d: { models?: Model[] }) => {
        if (!alive || !Array.isArray(d.models) || d.models.length === 0) return;
        setModels(d.models);
        // 처음에는 가벼운 쪽 — 화면을 여러 개 만들 때 횟수가 먼저 바닥나기 때문이다.
        setModelId((prev) => prev || (d.models!.find((m) => !m.heavy) ?? d.models![0]).id);
      })
      .catch(() => {
        /* 목록을 못 받아도 서버가 알아서 고른다. */
      });
    return () => {
      alive = false;
    };
  }, []);

  /* 이 플랜을 어느 프로젝트에 만들어 왔는지 되살린다. 돌고 있으면 손대지 않는다. */
  useEffect(() => {
    restore(plan.id);
  }, [plan.id]);

  /*
   * 화면을 떠날 때 **돌던 요청을 끊지 않는다.** 예전에는 여기서 정리했는데,
   * 그래서 홈에 다녀오면 만들던 것이 멈췄다. 멈추는 것은 `멈추기` 로만 한다.
   */

  /*
   * 끝난 결과를 알린다.
   *
   * 자리를 비운 사이에 끝났으면 알림이 뜰 화면이 없다. 그때 것을 다시 들어오자마자
   * 띄우면 방금 일어난 일처럼 보이므로, 처음 붙을 때는 이미 있는 결과를 본 것으로
   * 친다(아래 화면에 글로도 남긴다). 새로 생긴 결과만 알린다.
   */
  const seenSummary = useRef<number | null>(null);
  useEffect(() => {
    const at = summary?.at ?? 0;
    if (seenSummary.current === null) {
      seenSummary.current = at;
      return;
    }
    if (!summary || at === seenSummary.current) return;
    seenSummary.current = at;
    toast(summary.text, summary.tone);
  }, [summary, toast]);

  /* 스티치가 자격증명을 거절했으면 연결 칸으로 되돌린다. */
  useEffect(() => {
    if (session.disconnected) markDisconnected();
  }, [session.disconnected, markDisconnected]);

  /* 연결·해제는 훅이 하고, 여기서는 알림과 이 플랜의 진행 정리를 얹는다. */
  const handleConnect = useCallback(async () => {
    const ok = await connect();
    toast(ok ? '스티치를 연결했습니다.' : (error ?? '연결하지 못했습니다.'), ok ? 'ok' : 'warn');
  }, [connect, error, toast]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    resetRun(plan.id);
  }, [disconnect, plan.id]);

  /**
   * 만들기를 건다.
   *
   * 실제 반복은 `stitch-runner` 가 돈다 — 화면 밖이라 여기를 떠나도 이어진다.
   * 여기서는 무엇을 만들지 고르고, 오래 걸릴 때 한 번 묻는 일까지만 한다.
   */
  const run = useCallback(() => {
    const pageIds = pages.filter((p) => picked.has(p.id)).map((p) => p.id);
    if (pageIds.length === 0) {
      toast('만들 화면을 골라 주세요.', 'warn');
      return;
    }

    /*
     * 많이 고르면 한 번 묻는다. 24개면 20분 가까이 걸리고 사용량도 그만큼 나가는데,
     * 실수로 `전체 선택` 을 누른 것일 수도 있다.
     */
    if (pageIds.length > CONFIRM_OVER) {
      const mins = Math.max(1, Math.round((pageIds.length * SECONDS_EACH) / 60));
      const ok = window.confirm(
        `화면 ${pageIds.length}개를 만듭니다. 약 ${mins}분 걸리고 그만큼 스티치 사용량이 나갑니다.\n\n계속할까요?`,
      );
      if (!ok) return;
    }

    void start(plan.id, { plan, pageIds, modelId, emphasis, skill });
  }, [emphasis, modelId, pages, picked, plan, skill, toast]);

  const stop = useCallback(() => {
    stopRun(plan.id);
    toast('멈췄습니다. 그때까지 만들어진 화면은 스티치에 남아 있습니다.', 'warn');
  }, [plan.id, toast]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (pages.length === 0) return null;

  /* ---------------------------------------------------------------- */

  if (status === null) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-[12px] text-[var(--fg-muted)]">
        연결 상태를 확인하는 중입니다…
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-[12.5px] font-bold">
          <Link2 size={13} />
          스티치를 연결하면 여기서 바로 만들 수 있습니다
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
          연결하면 고른 화면들을 <b>사장님 스티치 계정에</b> 한 번에 만들어 드립니다. 만들어진
          디자인은 스티치에서 계속 편집하실 수 있습니다. 연결하지 않으셔도 아래 요청문을 복사해
          붙여 넣는 방법은 그대로 쓰실 수 있습니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            className="input min-w-0 flex-1"
            type="password"
            value={secret}
            placeholder="스티치에서 발급받은 키를 붙여 넣으세요"
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConnect();
            }}
          />
          <button
            className={`btn btn-primary btn-sm shrink-0${saving ? ' is-busy' : ''}`}
            disabled={saving || secret.trim().length === 0}
            onClick={() => void handleConnect()}
          >
            {saving ? <Spinner size={13} /> : <Link2 size={13} />}
            연결
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
          붙여 넣은 값은 암호화해 보관하고 화면으로 다시 내보내지 않습니다. 언제든 연결을 끊을 수
          있습니다.
        </p>
      </div>
    );
  }

  const picks = pages.filter((p) => picked.has(p.id));

  /** 대략 얼마나 걸릴지. 정확할 필요는 없고, 20분짜리인지 알면 된다. */
  const estimate = (() => {
    const mins = Math.round((picks.length * SECONDS_EACH) / 60);
    return mins < 1 ? '1분 미만' : `${mins}분`;
  })();

  const pickAll = () => setPicked(new Set(pages.map((p) => p.id)));

  const picked_skill = findSkill(skill);

  return (
    <div className="rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-bold">
          스티치에 바로 만들기
          <span className="ml-1.5 font-normal text-[11.5px] text-[var(--fg-muted)]">
            연결됨 {status.label}
          </span>
        </p>
        {projectUrl && (
          <a className="btn btn-sm" href={projectUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} />
            스티치에서 열기
          </a>
        )}
        {/*
          이어 만드는 것이 기본이라, 새로 시작하려면 말해 주어야 한다.
          이 버튼은 스티치의 프로젝트를 지우지 않는다 — 다음 것을 새 프로젝트에
          만들 뿐이다. 그 사실을 함께 적는다.
        */}
        {project && (
          <button
            className="btn btn-sm"
            disabled={running}
            title="지금까지 만든 것은 스티치에 그대로 남습니다. 다음 화면부터 새 프로젝트에 만듭니다."
            onClick={() => {
              forgetProject(plan.id);
              toast('다음부터는 새 프로젝트에 만듭니다. 지금까지 만든 것은 스티치에 그대로 있습니다.', 'ok');
            }}
          >
            새 프로젝트로
          </button>
        )}
        <button className="btn btn-sm" disabled={running} onClick={() => void handleDisconnect()}>
          <Unlink size={12} />
          연결 해제
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
          만들 화면을 고르세요. {picks.length > 0 && <>고른 {picks.length}개에 약 {estimate} 걸립니다.</>}
          {project && <> 앞서 만든 프로젝트에 <b>이어서</b> 만듭니다.</>}
          {/*
            이미 만든 것이 몇 개인지 밝힌다. 목록에 `완료` 가 붙어 있지만,
            화면이 스무 개면 세어 보기 전에는 감이 안 온다.
          */}
          {made.size > 0 && <> 이미 만든 화면 <b>{made.size}개</b>는 빼 두었습니다.</>}
        </p>
        <button className="btn btn-sm" disabled={running} onClick={pickAll}>
          전체 선택
        </button>
        <button className="btn btn-sm" disabled={running} onClick={() => setPicked(new Set())}>
          선택 해제
        </button>
      </div>

      {/*
        디자인 스킬 — 서비스 전체의 결.

        결을 안 정하면 화면마다 색·글꼴·모서리가 제각각으로 나온다. 그렇다고
        매번 글로 쓰라고 하면 기획자는 무엇을 써야 할지 모른다 — 그건 디자이너의
        언어다. 그래서 자주 쓰는 결을 미리 만들어 두고 고르기만 하게 한다.
      */}
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">디자인</span>
          {DESIGN_SKILLS.map((s) => (
            <button
              key={s.key}
              className={skill === s.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              disabled={running}
              onClick={() => setSkill(s.key)}
              title={s.what}
            >
              <span
                className="size-2.5 shrink-0 rounded-full border border-black/10"
                style={{ background: s.color }}
              />
              {s.name}
            </button>
          ))}
          <button
            className={skill === 'none' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            disabled={running}
            onClick={() => setSkill('none')}
            title="결을 정하지 않고 스티치에 맡깁니다."
          >
            안 고름
          </button>
        </div>

        {picked_skill && (
          <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
                {picked_skill.what}
              </p>
              <button className="btn btn-sm shrink-0" onClick={() => setSkillOpen((v) => !v)}>
                {skillOpen ? '접기' : '무엇이 정해지나'}
              </button>
            </div>
            {skillOpen && (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {skillSummary(picked_skill).map((line) => (
                  <li key={line} className="text-[11px] leading-relaxed text-[var(--fg-subtle)]">
                    · {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/*
        모델 고르기.
        목록은 스티치에서 받아 온다 — 저쪽이 새 모델을 내면 코드를 안 고쳐도 나온다.
        처음에는 가벼운 쪽이다. 화면을 여러 개 만들 때는 무거운 쪽 횟수가 먼저 바닥난다.
      */}
      {models.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">모델</span>
          {models.map((m) => (
            <button
              key={m.id}
              className={modelId === m.id ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              disabled={running}
              onClick={() => setModelId(m.id)}
            >
              {m.label}
            </button>
          ))}
          <span className="text-[11px] text-[var(--fg-subtle)]">
            {models.find((m) => m.id === modelId)?.heavy
              ? '결과가 더 좋지만 한 달에 쓸 수 있는 횟수가 적습니다.'
              : '횟수 여유가 있습니다. 여러 화면을 만들 때 알맞습니다.'}
          </span>
        </div>
      )}

      {/*
        무엇에 무게를 둘지.
        스티치에는 이런 조절값이 없어서, 요청문 문장으로 대신한다.
      */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">와이어프레임</span>
        {EMPHASIS_UI.map((e) => (
          <button
            key={e.key}
            className={emphasis === e.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            disabled={running}
            onClick={() => setEmphasis(e.key)}
          >
            {e.name}
          </button>
        ))}
        <span className="text-[11px] text-[var(--fg-subtle)]">
          {EMPHASIS_UI.find((e) => e.key === emphasis)?.what}
        </span>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {pages.map((page) => {
          const state = progress[page.id];
          const on = picked.has(page.id);
          return (
            <li
              key={page.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5"
            >
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-[var(--primary)]"
                checked={on}
                disabled={running}
                onChange={() => toggle(page.id)}
              />
              <span className="id-tag shrink-0">{page.id}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{page.name}</span>
              {!withWireframe.has(page.id) && (
                <span className="chip" title="와이어프레임이 있으면 훨씬 정확해집니다.">
                  그림 없음
                </span>
              )}
              {state?.state === 'running' && (
                <span className="flex items-center gap-1 text-[11px] text-[var(--fg-muted)]">
                  <Loader2 size={11} className="spin" />
                  만드는 중
                </span>
              )}
              {state?.state === 'done' && (
                <a
                  className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ok)]"
                  href={state.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Check size={11} />
                  완료
                </a>
              )}
              {state?.state === 'failed' && (
                <span
                  className="flex items-center gap-1 text-[11px] font-semibold text-[var(--warn)]"
                  title={state.message}
                >
                  <AlertTriangle size={11} />
                  실패
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          className={`btn btn-primary btn-sm${running ? ' is-busy' : ''}`}
          disabled={running || picks.length === 0}
          onClick={run}
        >
          {running ? <Spinner size={13} /> : <Sparkles size={13} />}
          {running ? '만드는 중' : `스티치에 ${picks.length}개 만들기`}
        </button>
        {running && (
          <button className="btn btn-sm" onClick={stop}>
            <X size={12} />
            멈추기
          </button>
        )}
      </div>

      {/*
        돌고 있는 동안 무엇을 해도 되는지 밝힌다.

        다른 화면에 다녀와도 이어진다는 사실을 모르면, 십오 분을 이 화면만 보고
        앉아 있게 된다. 반대로 새로고침이 멈춘다는 사실을 모르면 애써 만든 것을
        중간에 날린다. 둘 다 알려야 한다.
      */}
      {running && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
          다른 화면에 다녀오셔도 <b>계속 만듭니다.</b> 다만 새로고침하거나 창을 닫으면 멈춥니다.
        </p>
      )}

      {/*
        끝난 결과를 글로도 남긴다.

        자리를 비운 사이에 끝났으면 알림은 이미 지나갔다. 돌아왔을 때 무엇이
        어떻게 됐는지 알 길이 여기밖에 없다.
      */}
      {!running && summary && (
        <p
          className={`mt-1.5 text-[11.5px] leading-relaxed ${
            summary.tone === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'
          }`}
        >
          {summary.text}
        </p>
      )}
    </div>
  );
}
