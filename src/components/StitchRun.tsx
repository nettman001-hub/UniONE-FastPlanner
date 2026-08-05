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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { Plan } from '@/lib/types';

/** 한 번에 만들 수 있는 최대 — 서버와 같은 값이어야 한다. */
const MAX_SCREENS = 8;

interface Status {
  connected: boolean;
  label: string;
}

type ScreenState =
  | { state: 'waiting' }
  | { state: 'running' }
  | { state: 'done'; url: string; imageUrl: string | null }
  | { state: 'failed'; message: string };

export function StitchRun({ plan }: { plan: Plan }) {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, ScreenState>>({});
  const [projectUrl, setProjectUrl] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const pages = useMemo(() => (plan.iaPages ?? []).filter((p) => p.type === 'page'), [plan.iaPages]);
  const withWireframe = useMemo(
    () => new Set((plan.wireframes ?? []).map((w) => w.pageId)),
    [plan.wireframes],
  );

  /* 처음 열 때 그림이 있는 화면을 미리 골라 둔다 — 결과가 가장 정확한 것들이다. */
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size > 0) return prev;
      return new Set(
        pages
          .filter((p) => withWireframe.has(p.id))
          .slice(0, MAX_SCREENS)
          .map((p) => p.id),
      );
    });
  }, [pages, withWireframe]);

  useEffect(() => {
    let alive = true;
    fetch('/api/design/stitch')
      .then((r) => r.json())
      .then((d: Status) => alive && setStatus({ connected: Boolean(d.connected), label: d.label ?? '' }))
      .catch(() => alive && setStatus({ connected: false, label: '' }));
    return () => {
      alive = false;
    };
  }, []);

  /* 화면을 떠나면 돌던 요청을 정리한다. */
  useEffect(() => () => abort.current?.abort(), []);

  const connect = useCallback(async () => {
    const value = secret.trim();
    if (!value) return;
    setSaving(true);
    try {
      const res = await fetch('/api/design/stitch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: value }),
      });
      const data = (await res.json()) as Status & { error?: string };
      if (!res.ok) {
        toast(data.error ?? '연결하지 못했습니다.', 'warn');
        return;
      }
      setStatus({ connected: true, label: data.label ?? '' });
      setSecret('');
      toast('스티치를 연결했습니다.', 'ok');
    } catch {
      toast('연결하지 못했습니다.', 'warn');
    } finally {
      setSaving(false);
    }
  }, [secret, toast]);

  const disconnect = useCallback(async () => {
    try {
      await fetch('/api/design/stitch', { method: 'DELETE' });
    } catch {
      /* 못 지워도 화면에서는 끊어진 것으로 본다. */
    }
    setStatus({ connected: false, label: '' });
    setProgress({});
    setProjectUrl(null);
  }, []);

  /**
   * 화면을 하나씩 순서대로 만든다.
   *
   * 반복을 브라우저가 도는 이유는, 서버 함수에 제한시간이 있어서다. 8개를 한
   * 요청에 몰면 그 안에 못 끝내고 통째로 끊긴다. 끊기면 어디까지 됐는지 알 수
   * 없다. 하나씩 부르면 매 화면의 결과가 그때그때 확정된다.
   */
  const run = useCallback(async () => {
    const pageIds = pages.filter((p) => picked.has(p.id)).map((p) => p.id);
    if (pageIds.length === 0) {
      toast('만들 화면을 골라 주세요.', 'warn');
      return;
    }

    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setProjectUrl(null);
    setProgress(Object.fromEntries(pageIds.map((id) => [id, { state: 'waiting' } as ScreenState])));

    let projectId = '';
    let made = 0;
    let stopped = false;

    try {
      for (const [index, pageId] of pageIds.entries()) {
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }
        setProgress((p) => ({ ...p, [pageId]: { state: 'running' } }));

        let res: Response;
        try {
          res = await fetch('/api/design/stitch/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan, pageId, projectId, first: index === 0 }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            // 멈춘 화면은 실패가 아니다. 아직 안 만든 것으로 되돌린다.
            setProgress((p) => ({ ...p, [pageId]: { state: 'waiting' } }));
            stopped = true;
            break;
          }
          setProgress((p) => ({
            ...p,
            [pageId]: { state: 'failed', message: '연결이 끊겼습니다.' },
          }));
          continue;
        }

        const data = (await res.json().catch(() => ({}))) as {
          projectId?: string;
          url?: string;
          imageUrl?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setProgress((p) => ({
            ...p,
            [pageId]: { state: 'failed', message: data.error ?? '만들지 못했습니다.' },
          }));
          // 자격증명 문제라면 남은 화면도 전부 같은 이유로 실패한다. 여기서 멈춘다.
          if (res.status === 409) {
            toast(data.error ?? '스티치 연결을 다시 해 주세요.', 'warn');
            setStatus({ connected: false, label: '' });
            stopped = true;
            break;
          }
          continue;
        }

        if (data.projectId && !projectId) {
          projectId = data.projectId;
          setProjectUrl(data.url ?? '');
        }
        made += 1;
        setProgress((p) => ({
          ...p,
          [pageId]: {
            state: 'done',
            url: data.url ?? '',
            imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
          },
        }));
      }

      if (!stopped) {
        // 일부만 됐으면 성공으로 보이면 안 된다 — 나머지를 다시 시도해야 한다.
        toast(
          made === pageIds.length
            ? `화면 ${made}개를 스티치에 만들었습니다.`
            : `${pageIds.length}개 중 ${made}개만 만들었습니다. 실패한 화면만 다시 고르면 이어서 만듭니다.`,
          made === pageIds.length ? 'ok' : 'warn',
        );
      }
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }, [pages, picked, plan, toast]);

  const stop = useCallback(() => {
    abort.current?.abort();
    toast('멈췄습니다. 그때까지 만들어진 화면은 스티치에 남아 있습니다.', 'warn');
  }, [toast]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SCREENS) next.add(id);
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
              if (e.key === 'Enter') void connect();
            }}
          />
          <button
            className={`btn btn-primary btn-sm shrink-0${saving ? ' is-busy' : ''}`}
            disabled={saving || secret.trim().length === 0}
            onClick={() => void connect()}
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
        <button className="btn btn-sm" disabled={running} onClick={() => void disconnect()}>
          <Unlink size={12} />
          연결 해제
        </button>
      </div>

      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
        만들 화면을 고르세요. 한 번에 {MAX_SCREENS}개까지 됩니다. 화면 하나에 수십 초 걸립니다.
      </p>

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
                disabled={running || (!on && picked.size >= MAX_SCREENS)}
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
          onClick={() => void run()}
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
    </div>
  );
}
