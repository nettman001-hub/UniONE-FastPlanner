/**
 * 스티치에 만드는 일을 **화면 밖에서** 돈다.
 *
 * ## 왜 밖으로 뺐나
 *
 * 사장님이 겪은 일: 만드는 중에 홈에 다녀오면 진행이 통째로 사라졌다.
 *
 * 반복문이 컴포넌트 안에 있었기 때문이다. 화면을 떠나면 컴포넌트가 사라지고,
 * 정리하느라 걸어 둔 `abort()` 가 돌던 요청까지 끊었다. 다시 들어오면 빈 판이
 * 나온다 — 만들던 것도 멈추고, 이미 만든 것의 기록도 없다.
 *
 * 스무 개를 걸면 십오 분이 걸리는 일이다. **그동안 다른 화면을 못 보게 하는 것은
 * 말이 안 된다.** 그래서 진행 상태를 모듈에 두고, 컴포넌트는 구독만 한다.
 * 다녀와도 돌던 것이 그대로 보이고, 자리를 비운 사이에도 계속 만들어진다.
 *
 * ## 못 하는 것
 *
 * **새로고침하거나 창을 닫으면 멈춘다.** 브라우저가 자바스크립트를 통째로
 * 버리기 때문이고, 여기서 어찌할 수 없다. 대신 떠나기 전에 한 번 묻는다.
 *
 * 그때까지 만들어진 화면은 스티치에 그대로 남는다. 어느 프로젝트에 만들었는지도
 * 기억해 두므로(아래 `PROJECT_KEY`), 새로고침 뒤에도 `스티치에서 열기` 는 산다.
 */

import type { Plan } from '@/lib/types';

export type ScreenState =
  | { state: 'waiting' }
  | { state: 'running' }
  | { state: 'done'; url: string; imageUrl: string | null }
  | { state: 'failed'; message: string };

/**
 * 플랜마다 어느 스티치 프로젝트에 만들고 있는지 기억한다.
 *
 * 이걸 안 하면 **다시 만들 때마다 새 프로젝트가 생긴다.** 실패한 화면 두어 개만
 * 다시 걸었더니 `스티치에서 열기` 가 방금 만든 빈 프로젝트를 가리켜, 앞서 만든
 * 것들이 사라진 것처럼 보였다. 실제로 지워진 것은 아니지만 사용자에게는 같은
 * 일이다 — 찾을 수 없으면 없는 것이다.
 *
 * 플랜 데이터가 아니라 이 브라우저에만 둔다. 스티치 프로젝트는 연결한 계정에
 * 딸린 것이라 플랜을 남에게 넘길 때 따라가면 안 된다.
 */
const PROJECT_KEY = 'unione-fastplaner:stitch-projects';

export interface Remembered {
  projectId: string;
  designSystemId?: string;
}

function loadProject(planId: string): Remembered | null {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}') as Record<string, Remembered>;
    const found = all[planId];
    return found?.projectId ? found : null;
  } catch {
    return null;
  }
}

function saveProject(planId: string, value: Remembered | null): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}') as Record<string, Remembered>;
    if (value) all[planId] = value;
    else delete all[planId];
    localStorage.setItem(PROJECT_KEY, JSON.stringify(all));
  } catch {
    /* 저장 못 해도 이번 회차는 이어 만든다. */
  }
}

/**
 * 결과를 열어 볼 주소.
 *
 * 서버에도 같은 것이 있다(`stitch.ts` 의 `projectUrl`). 그쪽은 자격증명을 다루는
 * 모듈이라 브라우저로 끌어오지 않는다. 대신 기억해 둔 것을 되살릴 때는 번호밖에
 * 없어서 여기서도 주소를 만들 줄 알아야 한다.
 */
export function projectUrlOf(projectId: string): string {
  return `https://stitch.withgoogle.com/projects/${encodeURIComponent(projectId)}`;
}

/* ------------------------------------------------------------------ */
/* 상태                                                                 */
/* ------------------------------------------------------------------ */

export interface RunSession {
  running: boolean;
  progress: Record<string, ScreenState>;
  project: Remembered | null;
  /**
   * 끝난 뒤 한 줄.
   *
   * 자리를 비운 사이에 끝났으면 알림이 뜰 화면이 없다. 그래서 결과를 남겨 두고
   * 돌아왔을 때 보여 준다. `at` 은 같은 결과를 두 번 알리지 않으려는 표식이다.
   */
  summary: { text: string; tone: 'ok' | 'warn'; at: number } | null;
  /** 스티치가 자격증명을 거절했다 — 화면이 연결 상태를 되돌려야 한다. */
  disconnected: boolean;
}

export const EMPTY_SESSION: RunSession = {
  running: false,
  progress: {},
  project: null,
  summary: null,
  disconnected: false,
};

const sessions = new Map<string, RunSession>();
const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<() => void>>();

function get(planId: string): RunSession {
  return sessions.get(planId) ?? EMPTY_SESSION;
}

/** 항상 새 객체로 갈아 끼운다 — `useSyncExternalStore` 가 참조로 비교한다. */
function patch(planId: string, next: Partial<RunSession>): void {
  sessions.set(planId, { ...get(planId), ...next });
  recount();
  listeners.get(planId)?.forEach((fn) => fn());
  everyone.forEach((fn) => fn());
}

/* ------------------------------------------------------------------ */
/* 어디서든 "지금 만드는 중" 을 알 수 있게                                 */
/* ------------------------------------------------------------------ */

/**
 * 어느 플랜을 만들고 있는지 밖에서도 본다.
 *
 * 이제 화면을 떠나도 계속 만들어진다. 그러면 **떠난 사람이 그 사실을 알 길이
 * 있어야 한다.** 홈에 있든 다른 플랜에 있든 "○○ 만드는 중" 이 보이게, 여기서
 * 돌고 있는 것들을 내준다.
 */
export interface StitchJob {
  planId: string;
  /** 끝난 화면 수 */
  done: number;
  /** 이번에 걸린 화면 수 */
  total: number;
}

const everyone = new Set<() => void>();
/** `useSyncExternalStore` 는 같은 참조를 돌려주어야 한다. patch 때만 새로 만든다. */
let runningCache: StitchJob[] = [];

function recount(): void {
  const next: StitchJob[] = [];
  for (const [planId, s] of sessions) {
    if (!s.running) continue;
    const states = Object.values(s.progress);
    next.push({
      planId,
      done: states.filter((v) => v.state === 'done' || v.state === 'failed').length,
      total: states.length,
    });
  }
  runningCache = next;
}

export function subscribeAll(fn: () => void): () => void {
  everyone.add(fn);
  return () => {
    everyone.delete(fn);
  };
}

export function runningJobs(): StitchJob[] {
  return runningCache;
}

/** 서버에서 그릴 때는 아무것도 돌고 있지 않다. 매번 같은 빈 배열이어야 한다. */
const NONE: StitchJob[] = [];
export function noJobs(): StitchJob[] {
  return NONE;
}

export function subscribe(planId: string, fn: () => void): () => void {
  let set = listeners.get(planId);
  if (!set) {
    set = new Set();
    listeners.set(planId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

export function snapshot(planId: string): RunSession {
  return get(planId);
}

/** 서버에서 그릴 때는 아무것도 돌고 있지 않다. */
export function serverSnapshot(): RunSession {
  return EMPTY_SESSION;
}

/**
 * 이 플랜을 어느 프로젝트에 만들어 왔는지 되살린다.
 *
 * 이미 돌고 있으면 손대지 않는다 — 돌던 진행을 저장된 옛 값으로 덮으면 안 된다.
 */
export function restore(planId: string): void {
  if (sessions.has(planId)) return;
  const found = loadProject(planId);
  if (found) patch(planId, { project: found });
}

/** `새 프로젝트로` — 스티치의 프로젝트는 지우지 않는다. 다음 것을 새로 만들 뿐이다. */
export function forgetProject(planId: string): void {
  saveProject(planId, null);
  patch(planId, { project: null, progress: {}, summary: null });
}

/** 연결 해제 — 이 플랜에 대해 기억한 것을 전부 지운다. */
export function reset(planId: string): void {
  controllers.get(planId)?.abort();
  controllers.delete(planId);
  saveProject(planId, null);
  sessions.set(planId, EMPTY_SESSION);
  recount();
  listeners.get(planId)?.forEach((fn) => fn());
  everyone.forEach((fn) => fn());
}

export function stop(planId: string): void {
  controllers.get(planId)?.abort();
}

/* ------------------------------------------------------------------ */
/* 새로고침 막기                                                         */
/* ------------------------------------------------------------------ */

/**
 * 돌고 있을 때 새로고침·닫기를 하면 멈춘다는 것을 미리 알린다.
 *
 * 화면 사이를 오가는 것은 이제 괜찮지만 이것만은 못 살린다. 조용히 멈추게
 * 두는 것보다 한 번 묻는 편이 낫다.
 */
function guardUnload(on: boolean): void {
  if (typeof window === 'undefined') return;
  if (on) window.addEventListener('beforeunload', beforeUnload);
  else window.removeEventListener('beforeunload', beforeUnload);
}

function beforeUnload(event: BeforeUnloadEvent): void {
  // 돌고 있는 플랜이 하나라도 있으면 막는다.
  if (![...sessions.values()].some((s) => s.running)) return;
  event.preventDefault();
}

/* ------------------------------------------------------------------ */
/* 만들기                                                               */
/* ------------------------------------------------------------------ */

export interface RunOptions {
  plan: Plan;
  pageIds: string[];
  modelId: string;
  emphasis: string;
  skill: string;
}

/**
 * 화면을 하나씩 순서대로 만든다.
 *
 * 반복을 브라우저가 도는 이유는 서버 함수에 제한시간이 있어서다. 여덟 개를 한
 * 요청에 몰면 그 안에 못 끝내고 통째로 끊긴다. 끊기면 어디까지 됐는지 알 수
 * 없다. 하나씩 부르면 매 화면의 결과가 그때그때 확정된다.
 */
export async function start(planId: string, options: RunOptions): Promise<void> {
  if (get(planId).running) return;
  const { plan, pageIds, modelId, emphasis, skill } = options;
  if (pageIds.length === 0) return;

  const controller = new AbortController();
  controllers.set(planId, controller);
  guardUnload(true);

  patch(planId, {
    running: true,
    disconnected: false,
    summary: null,
    progress: Object.fromEntries(pageIds.map((id) => [id, { state: 'waiting' } as ScreenState])),
  });

  const mark = (pageId: string, state: ScreenState) =>
    patch(planId, { progress: { ...get(planId).progress, [pageId]: state } });

  // 이어 만든다. 비우면 새 프로젝트가 생겨 앞서 만든 것을 못 찾게 된다.
  const remembered = get(planId).project;
  let projectId = remembered?.projectId ?? '';
  let designSystemId = remembered?.designSystemId ?? '';
  let made = 0;
  let stopped = false;

  try {
    for (const [index, pageId] of pageIds.entries()) {
      if (controller.signal.aborted) {
        stopped = true;
        break;
      }
      /*
       * 화면 사이에 잠깐 쉰다.
       *
       * 스무 개를 연달아 걸면 두어 개가 거절당했다. 같은 화면을 따로 하나만
       * 만들면 잘 되니, 내용이 아니라 몰아친 것이 원인이다. 화면 하나에 수십 초
       * 걸리는 일이라 1초를 더 쉬어도 체감은 거의 없다.
       */
      if (index > 0) await new Promise((r) => setTimeout(r, 1000));
      mark(pageId, { state: 'running' });

      let res: Response;
      try {
        res = await fetch('/api/design/stitch/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan,
            pageId,
            projectId,
            first: index === 0,
            modelId,
            emphasis,
            skill,
            designSystemId,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // 멈춘 화면은 실패가 아니다. 아직 안 만든 것으로 되돌린다.
          mark(pageId, { state: 'waiting' });
          stopped = true;
          break;
        }
        mark(pageId, { state: 'failed', message: '연결이 끊겼습니다.' });
        continue;
      }

      const data = (await res.json().catch(() => ({}))) as {
        projectId?: string;
        designSystemId?: string | null;
        url?: string;
        imageUrl?: string | null;
        error?: string;
      };

      if (!res.ok) {
        mark(pageId, { state: 'failed', message: data.error ?? '만들지 못했습니다.' });
        // 자격증명 문제라면 남은 화면도 전부 같은 이유로 실패한다. 여기서 멈춘다.
        if (res.status === 409) {
          patch(planId, {
            disconnected: true,
            summary: {
              text: data.error ?? '스티치 연결을 다시 해 주세요.',
              tone: 'warn',
              at: Date.now(),
            },
          });
          stopped = true;
          break;
        }
        continue;
      }

      if (data.projectId && !projectId) projectId = data.projectId;
      // 한 번 만든 디자인 시스템을 다음 화면들이 그대로 쓴다.
      if (data.designSystemId && !designSystemId) designSystemId = data.designSystemId;
      if (projectId) {
        const next = { projectId, ...(designSystemId ? { designSystemId } : {}) };
        saveProject(planId, next);
        patch(planId, { project: next });
      }
      made += 1;
      mark(pageId, {
        state: 'done',
        url: data.url ?? '',
        imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
      });
    }

    if (!stopped) {
      // 일부만 됐으면 성공으로 보이면 안 된다 — 나머지를 다시 시도해야 한다.
      const all = made === pageIds.length;
      patch(planId, {
        summary: {
          text: all
            ? `화면 ${made}개를 스티치에 만들었습니다.`
            : `${pageIds.length}개 중 ${made}개만 만들었습니다. 실패한 화면만 다시 고르면 이어서 만듭니다.`,
          tone: all ? 'ok' : 'warn',
          at: Date.now(),
        },
      });
    }
  } finally {
    patch(planId, { running: false });
    controllers.delete(planId);
    if (![...sessions.values()].some((s) => s.running)) guardUnload(false);
  }
}
