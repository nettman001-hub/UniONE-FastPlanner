/**
 * UniAI 화면 생성을 컴포넌트 밖에서 순차 실행한다.
 * 화면을 옮겨도 계속되며, 성공 결과는 즉시 플랜에 저장한다.
 */

import { uinAiScreenHref } from '@/lib/design/uinai';
import { usePlannerStore } from '@/lib/store';
import type { Plan, UinAiScreen } from '@/lib/types';
import { refreshCredits } from '@/lib/useCredits';
import { recordCompletedTask } from '@/lib/tasks';

export type UinAiScreenState =
  | { state: 'waiting' }
  | { state: 'running' }
  | { state: 'done'; url: string }
  | { state: 'failed'; message: string };

export interface UinAiRunSession {
  running: boolean;
  stopRequested: boolean;
  progress: Record<string, UinAiScreenState>;
  currentPageIds: string[];
  options: Pick<StartUinAiOptions, 'engine' | 'emphasis' | 'skill' | 'device'> | null;
  summary: { text: string; tone: 'ok' | 'warn'; at: number } | null;
}

const EMPTY_SESSION: UinAiRunSession = {
  running: false,
  stopRequested: false,
  progress: {},
  currentPageIds: [],
  options: null,
  summary: null,
};

const sessions = new Map<string, UinAiRunSession>();
const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<() => void>>();
const everyone = new Set<() => void>();

function get(planId: string): UinAiRunSession {
  return sessions.get(planId) ?? EMPTY_SESSION;
}

function patch(planId: string, next: Partial<UinAiRunSession>): void {
  sessions.set(planId, { ...get(planId), ...next });
  recount();
  listeners.get(planId)?.forEach((fn) => fn());
  everyone.forEach((fn) => fn());
}

export function subscribeUinAi(planId: string, fn: () => void): () => void {
  let set = listeners.get(planId);
  if (!set) {
    set = new Set();
    listeners.set(planId, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function uinAiSnapshot(planId: string): UinAiRunSession {
  return get(planId);
}

export function uinAiServerSnapshot(): UinAiRunSession {
  return EMPTY_SESSION;
}

export interface UinAiJob {
  planId: string;
  done: number;
  total: number;
}

let runningCache: UinAiJob[] = [];

function recount(): void {
  runningCache = [...sessions.entries()]
    .filter(([, session]) => session.running)
    .map(([planId, session]) => ({
      planId,
      done: session.currentPageIds.filter((id) => {
        const state = session.progress[id];
        return state?.state === 'done' || state?.state === 'failed';
      }).length,
      total: session.currentPageIds.length,
    }));
}

export function subscribeAllUinAi(fn: () => void): () => void {
  everyone.add(fn);
  return () => everyone.delete(fn);
}

export function runningUinAiJobs(): UinAiJob[] {
  return runningCache;
}

const NO_JOBS: UinAiJob[] = [];
export function noUinAiJobs(): UinAiJob[] {
  return NO_JOBS;
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (![...sessions.values()].some((session) => session.running)) return;
  event.preventDefault();
}

function guardUnload(on: boolean): void {
  if (typeof window === 'undefined') return;
  if (on) window.addEventListener('beforeunload', beforeUnload);
  else window.removeEventListener('beforeunload', beforeUnload);
}

export interface StartUinAiOptions {
  plan: Plan;
  pageIds: string[];
  engine: 'basic' | 'advanced';
  emphasis: 'strict' | 'balanced' | 'free';
  skill: string;
  device?: 'mobile' | 'desktop' | 'both';
}

export async function startUinAi(planId: string, options: StartUinAiOptions): Promise<void> {
  if (get(planId).running || options.pageIds.length === 0) return;

  const controller = new AbortController();
  controllers.set(planId, controller);
  guardUnload(true);

  const deviceList: Array<'mobile' | 'desktop'> =
    options.device === 'both'
      ? ['mobile', 'desktop']
      : options.device === 'mobile'
        ? ['mobile']
        : ['desktop'];

  patch(planId, {
    running: true,
    stopRequested: false,
    currentPageIds: options.pageIds,
    options: {
      engine: options.engine,
      emphasis: options.emphasis,
      skill: options.skill,
      device: options.device ?? 'both',
    },
    summary: null,
    progress: {
      ...get(planId).progress,
      ...Object.fromEntries(
        options.pageIds.map((pageId) => [pageId, { state: 'waiting' } as UinAiScreenState]),
      ),
    },
  });

  const mark = (pageId: string, state: UinAiScreenState) =>
    patch(planId, { progress: { ...get(planId).progress, [pageId]: state } });
  // 이전 UniAI 결과는 서버 프롬프트에 필요 없고 요청 크기만 키운다.
  const requestPlan: Plan = {
    ...options.plan,
    chat: [],
    comments: [],
    versions: [],
    uinAiScreens: undefined,
  };
  let made = 0;
  let stopped = false;
  let firstFailure = '';

  const taskList: Array<{ pageId: string; device: 'mobile' | 'desktop' }> = [];
  for (const pageId of options.pageIds) {
    for (const dev of deviceList) {
      taskList.push({ pageId, device: dev });
    }
  }

  try {
    for (const [index, task] of taskList.entries()) {
      const { pageId, device } = task;
      if (get(planId).stopRequested || controller.signal.aborted) {
        stopped = true;
        break;
      }
      const livePlan = usePlannerStore.getState().getPlan(planId);
      if (!livePlan || !livePlan.iaPages.some((page) => page.type === 'page' && page.id === pageId)) {
        patch(planId, {
          summary: {
            text: '플랜이나 화면이 삭제되어 남은 작업을 멈췄습니다.',
            tone: 'warn',
            at: Date.now(),
          },
        });
        stopped = true;
        break;
      }
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      if (get(planId).stopRequested || controller.signal.aborted) {
        stopped = true;
        break;
      }
      mark(pageId, { state: 'running' });
      const requestId = crypto.randomUUID();

      let response: Response;
      try {
        response = await fetch('/api/design/uinai/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: requestPlan,
            pageId,
            requestId,
            engine: options.engine,
            emphasis: options.emphasis,
            skill: options.skill,
            device,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          mark(pageId, { state: 'waiting' });
          stopped = true;
          break;
        }
        // 응답만 끊긴 경우 서버에는 결과가 먼저 저장돼 있을 수 있다. 같은 요청 ID를
        // 찾아 복구해, 유료 결과를 실패로 오인하고 다시 생성하지 않게 한다.
        try {
          const recoveredResponse = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
            cache: 'no-store',
          });
          if (recoveredResponse.ok) {
            const recoveredBody = (await recoveredResponse.json()) as { plan?: Plan };
            const recovered = recoveredBody.plan?.uinAiScreens?.find(
              (screen) => screen.id === `uinai-${requestId}`,
            );
            if (recovered) {
              usePlannerStore.getState().upsertUinAiScreen(planId, recovered);
              void refreshCredits();
              made += 1;
              mark(pageId, { state: 'done', url: uinAiScreenHref(planId, pageId) });
              continue;
            }
          }
        } catch {
          /* 아직 오프라인이면 다음 동기화에서 서버 저장 결과를 되찾는다. */
        }
        mark(pageId, { state: 'failed', message: '연결이 끊겼습니다.' });
        continue;
      }

      const data = (await response.json().catch(() => ({}))) as {
        screen?: UinAiScreen;
        error?: string;
        code?: string;
      };
      if (!response.ok || !data.screen) {
        const message = data.error ?? '화면을 만들지 못했습니다.';
        if (!firstFailure) firstFailure = message;
        mark(pageId, { state: 'failed', message });
        // 뒤 화면도 같은 이유로 막히는 상태라면 여기서 멈춘다.
        if (
          [401, 402, 403, 409, 413, 429, 502, 503].includes(response.status) ||
          data.code === 'too-long' ||
          data.code === 'format' ||
          data.code === 'config'
        ) {
          patch(planId, { summary: { text: message, tone: 'warn', at: Date.now() } });
          stopped = true;
          break;
        }
        continue;
      }

      usePlannerStore.getState().upsertUinAiScreen(planId, data.screen);
      void refreshCredits();
      made += 1;
      mark(pageId, { state: 'done', url: uinAiScreenHref(planId, pageId) });
      if (get(planId).stopRequested) {
        stopped = true;
        patch(planId, {
          summary: {
            text: `현재 화면까지 ${made}개를 만들고 멈췄습니다.`,
            tone: 'warn',
            at: Date.now(),
          },
        });
        break;
      }
    }

    if (stopped && !get(planId).summary) {
      patch(planId, {
        summary: {
          text: `완성된 화면 ${made}개를 저장하고 멈췄습니다.`,
          tone: 'warn',
          at: Date.now(),
        },
      });
    }
    if (!stopped) {
      const all = made === options.pageIds.length;
      patch(planId, {
        summary: {
          text: all
            ? `화면 ${made}개를 UniAI로 만들었습니다.`
            : `${options.pageIds.length}개 중 ${made}개만 만들었습니다. ${firstFailure || '실패한 화면만 다시 골라 주세요.'}`,
          tone: all ? 'ok' : 'warn',
          at: Date.now(),
        },
      });
    }
    if (made > 0) {
      recordCompletedTask({
        planId,
        type: 'uinai',
        title: `UniAI 화면 ${made}개 생성 완료`,
        href: `/plans/${planId}/export?design=uinai`,
        targetPath: `/plans/${planId}/export`,
      });
    }
  } finally {
    patch(planId, { running: false, stopRequested: false });
    controllers.delete(planId);
    if (![...sessions.values()].some((session) => session.running)) guardUnload(false);
  }
}

export function stopUinAi(planId: string): void {
  if (get(planId).running) patch(planId, { stopRequested: true });
}
