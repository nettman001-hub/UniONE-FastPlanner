'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Package,
  Sparkles,
  X,
} from 'lucide-react';

import { Spinner, useToast } from './ui';
import { ENGINE_LABEL, ENGINE_TIERS, ENGINE_WHAT, type EngineTier } from '@/lib/ai/engines';
import { costWithEngine } from '@/lib/credits';
import { DESIGN_SKILLS, findSkill, skillSummary } from '@/lib/design/skills';
import {
  startUinAi,
  stopUinAi,
  subscribeUinAi,
  uinAiServerSnapshot,
  uinAiSnapshot,
} from '@/lib/design/uinai-runner';
import {
  UINAI_AGENT_PROMPT,
  uinAiScreenHref,
  uinAiSourceSignature,
} from '@/lib/design/uinai';
import type { PromptEmphasis } from '@/lib/design-handoff';
import { download, toAgentBundle } from '@/lib/export';
import { UINAI_CREDIT_COST, type Plan } from '@/lib/types';
import { useCredits } from '@/lib/useCredits';

const CONFIRM_OVER = 10;
const SECONDS_EACH = 55;

const EMPHASIS_UI: Array<{ key: PromptEmphasis; name: string; what: string }> = [
  { key: 'strict', name: '그대로', what: '적어 둔 항목과 순서를 그대로 씁니다.' },
  { key: 'balanced', name: '균형', what: '내용은 지키고 여백·정렬은 알아서 다듬습니다.' },
  { key: 'free', name: '자유롭게', what: '내용만 지키고 배치는 더 나은 쪽으로 바꿉니다.' },
];

export function UinAiRun({ plan }: { plan: Plan }) {
  const toast = useToast();
  const { remaining: credits } = useCredits();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<EngineTier>('basic');
  const [emphasis, setEmphasis] = useState<PromptEmphasis>('strict');
  const [skill, setSkill] = useState('clean');
  const [skillOpen, setSkillOpen] = useState(false);

  const session = useSyncExternalStore(
    useCallback((fn) => subscribeUinAi(plan.id, fn), [plan.id]),
    useCallback(() => uinAiSnapshot(plan.id), [plan.id]),
    uinAiServerSnapshot,
  );
  const { running, stopRequested, progress, summary } = session;

  const pages = useMemo(() => plan.iaPages.filter((page) => page.type === 'page'), [plan.iaPages]);
  const withWireframe = useMemo(
    () => new Set(plan.wireframes.map((wireframe) => wireframe.pageId)),
    [plan.wireframes],
  );
  const generated = useMemo(
    () => new Map((plan.uinAiScreens ?? []).map((screen) => [screen.pageId, screen])),
    [plan.uinAiScreens],
  );
  const made = useMemo(() => new Set(generated.keys()), [generated]);

  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (initializedFor.current === plan.id) return;
    initializedFor.current = plan.id;
    setPicked(
      new Set(
        pages
          .filter((page) => withWireframe.has(page.id) && !made.has(page.id))
          .map((page) => page.id),
      ),
    );
  }, [made, pages, plan.id, withWireframe]);

  // 내보내기를 떠났다가 돌아와도 실제로 실행 중인 옵션을 그대로 보여 준다.
  useEffect(() => {
    if (!running || !session.options) return;
    setEngine(session.options.engine);
    setEmphasis(session.options.emphasis);
    setSkill(session.options.skill);
  }, [running, session.options]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      const completed = new Set(
        session.currentPageIds.filter((pageId) => progress[pageId]?.state === 'done'),
      );
      setPicked((previous) => new Set([...previous].filter((pageId) => !completed.has(pageId))));
    }
    wasRunning.current = running;
  }, [progress, running, session.currentPageIds]);

  const seenSummary = useRef<number | null>(null);
  useEffect(() => {
    const at = summary?.at ?? 0;
    if (seenSummary.current === null) {
      seenSummary.current = at;
      return;
    }
    if (!summary || seenSummary.current === at) return;
    seenSummary.current = at;
    toast(summary.text, summary.tone);
  }, [summary, toast]);

  const picks = pages.filter((page) => picked.has(page.id));
  const costEach = costWithEngine(UINAI_CREDIT_COST, engine);
  const totalCost = picks.length * costEach;
  const estimateMinutes = Math.round((picks.length * SECONDS_EACH) / 60);
  const estimate = estimateMinutes < 1 ? '1분 미만' : `${estimateMinutes}분`;
  const chosenSkill = findSkill(skill);
  const latest = useMemo(
    () =>
      [...(plan.uinAiScreens ?? [])].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      )[0],
    [plan.uinAiScreens],
  );

  const toggle = (pageId: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  const run = useCallback(() => {
    const pageIds = pages.filter((page) => picked.has(page.id)).map((page) => page.id);
    if (pageIds.length === 0) {
      toast('만들 화면을 골라 주세요.', 'warn');
      return;
    }
    const required = pageIds.length * costWithEngine(UINAI_CREDIT_COST, engine);
    if (credits < required) {
      toast(`크레딧이 ${required - credits} 부족합니다. 화면 수를 줄이거나 기본 엔진을 골라 주세요.`, 'warn');
      return;
    }
    if (pageIds.length > CONFIRM_OVER) {
      const mins = Math.max(1, Math.round((pageIds.length * SECONDS_EACH) / 60));
      const ok = window.confirm(
        `화면 ${pageIds.length}개를 만듭니다. 약 ${mins}분, ${required}크레딧이 듭니다.\n\n계속할까요?`,
      );
      if (!ok) return;
    }
    void startUinAi(plan.id, { plan, pageIds, engine, emphasis, skill });
  }, [credits, emphasis, engine, pages, picked, plan, skill, toast]);

  const stop = useCallback(() => {
    stopUinAi(plan.id);
    toast('현재 화면을 저장한 뒤 멈춥니다.', 'warn');
  }, [plan.id, toast]);

  const downloadAgentBundle = () => {
    download('plan-bundle.json', toAgentBundle(plan), 'application/json;charset=utf-8');
    toast(`UniAI 화면 ${made.size}개가 포함된 에이전트 번들을 받았습니다.`, 'ok');
  };

  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(UINAI_AGENT_PROMPT);
      toast('코딩 에이전트용 지시문을 복사했습니다.', 'ok');
    } catch {
      toast('복사하지 못했습니다. 번들만 내려받아도 사용할 수 있습니다.', 'warn');
    }
  };

  if (pages.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-bold">
          UniAI로 바로 만들기
          <span className="ml-1.5 font-normal text-[11.5px] text-[var(--fg-muted)]">
            이미지가 아닌 HTML·CSS·JavaScript 코드로 생성·보관
          </span>
        </p>
        {latest && (
          <Link className="btn btn-sm" href={uinAiScreenHref(plan.id, latest.pageId)}>
            <ExternalLink size={12} />
            UniBoard에서 열기
          </Link>
        )}
        {made.size > 0 && (
          <>
            <button className="btn btn-sm" disabled={running} onClick={downloadAgentBundle}>
              <Package size={12} />
              코딩 에이전트에 넘기기
            </button>
            <button className="btn btn-sm" disabled={running} onClick={() => void copyAgentPrompt()}>
              <Copy size={12} />
              지시문 복사
            </button>
          </>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
          만들 화면을 고르세요. {picks.length > 0 && <>고른 {picks.length}개에 약 {estimate}, <b>{totalCost}크레딧</b>이 듭니다.</>}
          {made.size > 0 && <> 이미 만든 화면 <b>{made.size}개</b>는 빼 두었습니다.</>}
        </p>
        <button className="btn btn-sm" disabled={running} onClick={() => setPicked(new Set(pages.map((page) => page.id)))}>
          전체 선택
        </button>
        <button className="btn btn-sm" disabled={running} onClick={() => setPicked(new Set())}>
          선택 해제
        </button>
      </div>

      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">디자인</span>
          {DESIGN_SKILLS.map((item) => (
            <button
              key={item.key}
              className={skill === item.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              aria-pressed={skill === item.key}
              disabled={running}
              onClick={() => setSkill(item.key)}
              title={item.what}
            >
              <span
                className="size-2.5 shrink-0 rounded-full border border-black/10"
                style={{ background: item.color }}
              />
              {item.name}
            </button>
          ))}
          <button
            className={skill === 'none' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            aria-pressed={skill === 'none'}
            disabled={running}
            onClick={() => setSkill('none')}
            title="별도 디자인 지침 없이 UniAI에 맡깁니다."
          >
            안 고름
          </button>
        </div>
        {chosenSkill && (
          <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
                {chosenSkill.what}
              </p>
              <button className="btn btn-sm shrink-0" onClick={() => setSkillOpen((open) => !open)}>
                {skillOpen ? '접기' : '무엇이 정해지나'}
              </button>
            </div>
            {skillOpen && (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {skillSummary(chosenSkill).map((line) => (
                  <li key={line} className="text-[11px] leading-relaxed text-[var(--fg-subtle)]">· {line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">모델</span>
        {ENGINE_TIERS.map((tier) => (
          <button
            key={tier}
            className={engine === tier ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            aria-pressed={engine === tier}
            disabled={running}
            onClick={() => setEngine(tier)}
          >
            {ENGINE_LABEL[tier]}
          </button>
        ))}
        <span className="text-[11px] text-[var(--fg-subtle)]">
          {ENGINE_WHAT[engine]} 화면당 {costEach}크레딧입니다.
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">와이어프레임</span>
        {EMPHASIS_UI.map((item) => (
          <button
            key={item.key}
            className={emphasis === item.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            aria-pressed={emphasis === item.key}
            disabled={running}
            onClick={() => setEmphasis(item.key)}
          >
            {item.name}
          </button>
        ))}
        <span className="text-[11px] text-[var(--fg-subtle)]">
          {EMPHASIS_UI.find((item) => item.key === emphasis)?.what}
        </span>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {pages.map((page) => {
          const state = progress[page.id];
          const saved = generated.get(page.id);
          const stale = saved && saved.sourceSignature !== uinAiSourceSignature(plan, page.id);
          return (
            <li key={page.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-[var(--primary)]"
                checked={picked.has(page.id)}
                aria-label={`${page.name} 선택`}
                disabled={running}
                onChange={() => toggle(page.id)}
              />
              <span className="id-tag shrink-0">{page.id}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{page.name}</span>
              {!withWireframe.has(page.id) && <span className="chip">그림 없음</span>}
              {stale && <span className="chip chip-warn">업데이트 필요</span>}
              {state?.state === 'waiting' && running && (
                <span className="text-[11px] text-[var(--fg-subtle)]">대기 중</span>
              )}
              {state?.state === 'running' && (
                <span className="flex items-center gap-1 text-[11px] text-[var(--fg-muted)]">
                  <Loader2 size={11} className="spin" /> 만드는 중
                </span>
              )}
              {state?.state === 'failed' && (
                <span className="flex max-w-full items-start gap-1 text-[11px] font-semibold text-[var(--warn)] sm:max-w-[440px]" title={state.message}>
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span className="break-words">실패 · {state.message}</span>
                </span>
              )}
              {(state?.state === 'done' || saved) && state?.state !== 'running' && (
                <Link className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ok)]" href={uinAiScreenHref(plan.id, page.id)}>
                  <Check size={11} /> UniBoard에서 열기
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          className={`btn btn-primary btn-sm${running ? ' is-busy' : ''}`}
          disabled={running || picks.length === 0 || totalCost > credits}
          onClick={run}
        >
          {running ? <Spinner size={13} /> : <Sparkles size={13} />}
          {running ? '만드는 중' : `UniAI로 ${picks.length}개 만들기`}
        </button>
        {running && (
          <button className="btn btn-sm" disabled={stopRequested} onClick={stop}>
            <X size={12} /> {stopRequested ? '멈추는 중' : '현재 화면 후 멈추기'}
          </button>
        )}
      </div>

      {running && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
          다른 화면에 다녀오셔도 <b>계속 만듭니다.</b> 다만 새로고침하거나 창을 닫으면 멈춥니다.
        </p>
      )}
      {!running && summary && (
        <p aria-live="polite" className={`mt-1.5 text-[11.5px] leading-relaxed ${summary.tone === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
          {summary.text}
        </p>
      )}
      {!running && picks.length > 0 && totalCost > credits && (
        <p className="mt-1.5 text-[11.5px] text-[var(--warn)]">
          선택한 화면을 모두 만들려면 {totalCost - credits}크레딧이 더 필요합니다.
        </p>
      )}
    </div>
  );
}
