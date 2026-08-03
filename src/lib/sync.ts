'use client';

/**
 * 플랜을 서버와 맞춘다.
 *
 * 설계 원칙: **브라우저 저장소가 계속 정본(working copy)이다.** 편집·생성은 예전과
 * 똑같이 localStorage 에 먼저 쓰고, 그 결과를 뒤에서 서버로 밀어 올린다.
 * 이렇게 하면
 *
 * - 생성 파이프라인·되돌리기 같은 기존 동작을 하나도 안 건드린다.
 * - 네트워크가 끊겨도 앱이 멈추지 않는다.
 * - 밀어 올리기가 실패해도 내용이 사라지지 않는다 — 다음에 들어올 때 다시 올린다.
 *
 * 충돌은 `updatedAt` 이 최신인 쪽이 이긴다. 서버도 같은 규칙으로 한 번 더 거른다.
 */

import { usePlannerStore } from './store';
import type { Plan } from './types';

/** 로그인하기 전에 이 브라우저에 만들어 둔 플랜을 잠시 넣어 두는 곳. */
const GUEST_BACKUP_KEY = 'unione-fastplaner:guest-backup';

/**
 * 서버에 올려 둔 플랜의 목록(ID → 시각).
 *
 * **저장해야 한다.** 이게 없으면 새로고침한 뒤 "서버에 없는 플랜" 이
 *
 * - 다른 기기에서 지운 것인지 (→ 여기서도 지워야 한다)
 * - 연결이 끊긴 채로 새로 만든 것인지 (→ 올려야 한다)
 *
 * 구분되지 않는다. 구분하지 못하면 둘 중 하나는 반드시 틀린다. 실제로 검증 중에
 * 한쪽 기기에서 지운 플랜이 다른 기기에서 되살아나 다시 올라가는 것을 확인했다.
 */
const SYNCED_KEY = 'unione-fastplaner:synced:v1';

export type SyncState = 'idle' | 'syncing' | 'saved' | 'error';

/**
 * 화면에 보여 줄 상태.
 *
 * `useSyncExternalStore` 가 매번 같은 참조를 받아야 하므로 바뀔 때만 새로 만든다.
 * 부를 때마다 새 객체를 돌려주면 리액트가 무한히 다시 그린다.
 */
let snapshot: { state: SyncState; error: string | null } = { state: 'idle', error: null };
const listeners = new Set<() => void>();

/** 서버에 올려 둔 각 플랜의 시각. 이게 현재 값과 같으면 보낼 것이 없다. */
let synced = new Map<string, string>();

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * 받아 오기와 올리기가 겹치지 않게 한 줄로 세운다.
 *
 * 겹치면 올리기가 붙잡고 있던 옛 목록을 기준으로 삭제를 판단해, 방금 받아 온
 * 플랜을 지워 버린다. 검증 중에 실제로 저장한 플랜이 잠깐 사라졌다.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

function loadSynced(owner: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(SYNCED_KEY);
    const parsed = raw ? (JSON.parse(raw) as { owner: string; items: Record<string, string> }) : null;
    if (!parsed || parsed.owner !== owner) return new Map();
    return new Map(Object.entries(parsed.items ?? {}));
  } catch {
    return new Map();
  }
}

function storeSynced(owner: string | null): void {
  try {
    if (!owner) localStorage.removeItem(SYNCED_KEY);
    else localStorage.setItem(
      SYNCED_KEY,
      JSON.stringify({ owner, items: Object.fromEntries(synced) }),
    );
  } catch {
    /* 용량이 모자라면 다음 기회에 */
  }
}

function emit(next: SyncState, error: string | null = null) {
  if (snapshot.state === next && snapshot.error === error) return;
  snapshot = { state: next, error };
  for (const listener of listeners) listener();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function syncSnapshot(): { state: SyncState; error: string | null } {
  return snapshot;
}

/* 보관함 ------------------------------------------------------------- */

export function readGuestBackup(): Plan[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(GUEST_BACKUP_KEY);
    const parsed = raw ? (JSON.parse(raw) as Plan[]) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p?.id) : [];
  } catch {
    return [];
  }
}

function writeGuestBackup(plans: Plan[]) {
  try {
    if (plans.length === 0) localStorage.removeItem(GUEST_BACKUP_KEY);
    else localStorage.setItem(GUEST_BACKUP_KEY, JSON.stringify(plans));
  } catch {
    // 용량이 모자라면 어쩔 수 없다. 원본은 아직 store 에 있다.
  }
}

export function clearGuestBackup() {
  try {
    localStorage.removeItem(GUEST_BACKUP_KEY);
  } catch {
    /* 무시 */
  }
}

/** 보관해 둔 플랜을 계정으로 올린다. 성공한 개수를 돌려준다. */
export async function importGuestBackup(): Promise<number> {
  const plans = readGuestBackup();
  if (plans.length === 0) return 0;

  const res = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plans }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? '가져오기에 실패했습니다.');
  }

  clearGuestBackup();
  const store = usePlannerStore.getState();
  // 이미 화면에 있는 것과 합쳐서 다시 그린다.
  const merged = mergeByUpdatedAt(store.plans, plans);
  store.setPlans(merged, store.owner);
  for (const plan of merged) synced.set(plan.id, plan.updatedAt);
  storeSynced(store.owner);
  return plans.length;
}

/* 합치기 ------------------------------------------------------------- */

/** 두 목록을 ID 기준으로 합치고, 같은 ID 는 `updatedAt` 이 최신인 쪽을 남긴다. */
function mergeByUpdatedAt(a: Plan[], b: Plan[]): Plan[] {
  const map = new Map<string, Plan>();
  for (const plan of [...a, ...b]) {
    const kept = map.get(plan.id);
    if (!kept || new Date(plan.updatedAt).getTime() > new Date(kept.updatedAt).getTime()) {
      map.set(plan.id, plan);
    }
  }
  return [...map.values()].sort(
    (x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
  );
}

/* 로그인 / 로그아웃 --------------------------------------------------- */

/**
 * 로그인 직후 한 번 부른다.
 *
 * 지금 브라우저에 있는 플랜이 이 계정 것이 아니면 **먼저 보관함으로 옮기고 비운다.**
 * 한 컴퓨터를 여러 명이 돌려 쓸 때 남의 플랜이 딸려 올라가는 것을 막는다.
 */
export async function adoptUser(userId: string): Promise<void> {
  const store = usePlannerStore.getState();

  if (store.owner !== userId) {
    if (store.owner === null && store.plans.length > 0) {
      // 로그인 전에 만든 것 — 버리지 않고 보관해 둔 뒤 물어본다.
      writeGuestBackup(store.plans);
    }
    store.setPlans([], userId);
    synced = new Map();
    storeSynced(userId);
  } else {
    // 같은 계정으로 돌아왔다. 무엇을 올려 뒀었는지 기억을 되살린다.
    synced = loadSynced(userId);
  }

  await pull(userId);
  start();
}

/** 로그아웃. 플랜은 서버에 있으므로 이 브라우저에서는 지운다. */
export function releaseUser(): void {
  stop();
  synced = new Map();
  storeSynced(null);
  const store = usePlannerStore.getState();
  if (store.owner !== null) store.setPlans([], null);
  emit('idle');
}

async function pull(userId: string): Promise<void> {
  await serialize(async () => {
    emit('syncing');
    try {
      const res = await fetch('/api/plans', { cache: 'no-store' });
      if (!res.ok) throw new Error(await describe(res));
      const { plans: server } = (await res.json()) as { plans: Plan[] };
      const onServer = new Set(server.map((plan) => plan.id));

      const local = usePlannerStore.getState().plans;
      /*
       * 서버에 없는 로컬 플랜은 둘 중 하나다.
       *   - 올린 적이 있다  → 다른 기기에서 지웠다. 여기서도 지운다.
       *   - 올린 적이 없다  → 연결이 끊긴 채 새로 만든 것. 살려서 올린다.
       */
      const kept = local.filter((plan) => onServer.has(plan.id) || !synced.has(plan.id));
      const merged = mergeByUpdatedAt(kept, server);
      usePlannerStore.getState().setPlans(merged, userId);

      // 서버에 있던 그대로인 것만 "올려 둔 것" 으로 표시한다.
      // 로컬이 이긴 플랜은 표시하지 않으므로 곧바로 밀어 올려진다.
      synced = new Map();
      for (const plan of server) {
        if (merged.some((m) => m.id === plan.id && m.updatedAt === plan.updatedAt)) {
          synced.set(plan.id, plan.updatedAt);
        }
      }
      storeSynced(userId);
      emit('saved');
    } catch (error) {
      emit('error', error instanceof Error ? error.message : '동기화에 실패했습니다.');
    }
  });
  schedule(0);
}

/* 밀어 올리기 --------------------------------------------------------- */

function start() {
  unsubscribe ??= usePlannerStore.subscribe(() => schedule());
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * 잠깐 모았다가 보낸다.
 *
 * 타자 한 번마다 보내면 요청이 폭주한다. 1.2초는 "손을 멈추면 곧 저장된다" 로
 * 느껴지면서 요청은 충분히 줄어드는 지점이다. 이 사이에 창이 닫혀도 내용은
 * localStorage 에 남아 있고, 다음에 들어올 때 서버보다 최신이라 다시 올라간다.
 */
function schedule(delay = 1200) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void serialize(push), delay);
}

async function push(): Promise<void> {
  const store = usePlannerStore.getState();
  const owner = store.owner;
  if (!owner) return;

  emit('syncing');
  try {
    // 지운 것 먼저 — 다시 만들어진 플랜을 지우지 않도록 순서가 중요하다.
    for (const id of [...synced.keys()]) {
      if (store.plans.some((plan) => plan.id === id)) continue;
      const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await describe(res));
      synced.delete(id);
      storeSynced(owner);
    }

    for (const plan of store.plans) {
      if (synced.get(plan.id) === plan.updatedAt) continue;
      const res = await fetch(`/api/plans/${encodeURIComponent(plan.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error(await describe(res));
      synced.set(plan.id, plan.updatedAt);
      storeSynced(owner);
    }

    // 보내는 사이에 로그아웃했거나 계정이 바뀌었으면 결과를 반영하지 않는다.
    if (usePlannerStore.getState().owner !== owner) return;
    emit('saved');
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '저장에 실패했습니다.');
  }
}

async function describe(res: Response): Promise<string> {
  if (res.status === 401) return '로그인이 풀렸습니다. 다시 로그인해 주세요.';
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `서버 오류 (${res.status})`;
}
