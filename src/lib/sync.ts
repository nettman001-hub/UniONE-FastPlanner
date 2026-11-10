'use client';

/**
 * 플랜을 서버와 맞춘다.
 *
 * IndexedDB에는 편집 중 작업본을 보관하고, 서버가 저장을 확인한 문서를 동기화 기준으로 삼는다.
 * 편집·생성 결과와 버전은 각각 저장한 뒤 서버로 전송한다.
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
import { adminWorkspace, setAdminWorkspaceOwner, workspaceFetch, workspaceStorageKey } from './admin-workspace';
import { compactPlan } from './plan-transport';
import {
  createPlannerStorage, flushPlannerStorage, preservePlannerRecovery, readPlannerVersion,
} from './planner-storage';

/*
 * 아래 두 키는 `store.ts` 의 저장소 키와 한 묶음이라 **예전 이름 그대로 둔다.**
 * 서비스명이 UniBoard 로 바뀌었다고 여기까지 따라 바꾸면, 이미 저장된 값을 앱이
 * 찾지 못한다. 특히 SYNCED_KEY 를 잃으면 "무엇을 올렸었는지" 를 모르게 되어
 * 다른 기기에서 지운 플랜이 되살아난다.
 */

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
// 탭의 저장 영역은 고정한다. 문맥을 지우고 나가는 순간에도 개인 기록을 건드리지 않는다.
const WORKSPACE = adminWorkspace();
const SYNCED_STORAGE_KEY = workspaceStorageKey(SYNCED_KEY);
const workspaceActive = () => !WORKSPACE || adminWorkspace() === WORKSPACE;
const syncStorage = createPlannerStorage(SYNCED_STORAGE_KEY);
const guestStorage = createPlannerStorage(GUEST_BACKUP_KEY);
const uploadedVersions = new Set<string>();
let retries = 0;

interface SyncSession { owner: string | null; controller: AbortController }
let session: SyncSession = { owner: WORKSPACE?.userId ?? null, controller: new AbortController() };
const currentSession = (captured: SyncSession) => captured === session && workspaceActive();
const ownsSession = (captured: SyncSession) => currentSession(captured) && captured.owner === usePlannerStore.getState().owner;

function beginSession(owner: string | null): SyncSession {
  stop();
  session.controller.abort();
  session = { owner, controller: new AbortController() };
  uploadedVersions.clear();
  return session;
}

function assertSession(captured: SyncSession) {
  if (!ownsSession(captured)) throw new DOMException('동기화 계정이 변경되었습니다.', 'AbortError');
}

const request = (url: string, init?: RequestInit, captured = session) => {
  assertSession(captured);
  return workspaceFetch(url, {
    ...init, signal: AbortSignal.any([captured.controller.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30_000)]),
  });
};

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

async function loadSynced(owner: string): Promise<Map<string, string>> {
  try {
    const raw = await syncStorage.getItem(SYNCED_STORAGE_KEY);
    const envelope = raw ? JSON.parse(raw) as { state?: { owner?: string; syncItems?: Record<string, string> } } : null;
    if (envelope?.state?.owner === owner && envelope.state.syncItems) return new Map(Object.entries(envelope.state.syncItems));
    const legacy = typeof localStorage === 'undefined' ? null : localStorage.getItem(SYNCED_STORAGE_KEY);
    const parsed = legacy ? (JSON.parse(legacy) as { owner: string; items: Record<string, string> }) : null;
    if (!parsed || parsed.owner !== owner) return new Map();
    return new Map(Object.entries(parsed.items ?? {}));
  } catch {
    return new Map();
  }
}

async function storeSynced(owner: string | null): Promise<void> {
  await syncStorage.setItem(SYNCED_STORAGE_KEY,
    JSON.stringify({ state: { plans: [], owner, syncItems: Object.fromEntries(synced) }, version: 3 }));
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

export async function readGuestBackup(): Promise<Plan[]> {
  if (WORKSPACE) return [];
  try {
    const raw = await guestStorage.getItem(GUEST_BACKUP_KEY);
    const parsed = raw ? JSON.parse(raw) as { state?: { plans?: Plan[] } } : null;
    const plans = Array.isArray(parsed?.state?.plans) ? parsed.state.plans.filter((p) => p?.id) : [];
    for (const plan of plans) {
      for (let index = 0; index < plan.versions.length; index += 1) {
        const version = plan.versions[index];
        if (!version.snapshot) {
          const stored = await readPlannerVersion(plan.id, version.id, GUEST_BACKUP_KEY);
          if (stored?.snapshot) plan.versions[index] = stored;
        }
      }
    }
    return plans;
  } catch {
    return [];
  }
}

async function writeGuestBackup(plans: Plan[]): Promise<boolean> {
  const previous = await readGuestBackup();
  await guestStorage.setItem(GUEST_BACKUP_KEY, JSON.stringify({ state: { plans: mergeByUpdatedAt(previous, plans), owner: null }, version: 3 }));
  return flushPlannerStorage();
}

export async function clearGuestBackup() {
  if (WORKSPACE) return;
  try {
    await guestStorage.removeItem(GUEST_BACKUP_KEY);
  } catch {
    /* 무시 */
  }
}

/** 보관해 둔 플랜을 계정으로 올린다. 성공한 개수를 돌려준다. */
export async function importGuestBackup(): Promise<number> {
  if (WORKSPACE) return 0;
  const captured = session;
  assertSession(captured);
  if (!captured.owner) throw new Error('로그인 후 가져와 주세요.');
  const plans = await readGuestBackup();
  assertSession(captured);
  if (plans.length === 0) return 0;
  const accepted = new Set<string>();

  for (const plan of plans) {
    const res = await request(`/api/plans/${encodeURIComponent(plan.id)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: compactPlan(plan) }),
    }, captured);
    if (!res.ok) throw new Error(await describe(res));
    const result = await res.json() as { applied?: boolean };
    assertSession(captured);
    if (result.applied === false && !(await preservePlannerRecovery(plan, '게스트 가져오기 중 서버와 충돌한 원본'))) {
      throw new Error('게스트 원본을 보관하지 못했습니다. 보관함을 유지합니다.');
    }
    if (result.applied !== false) accepted.add(plan.id);
    assertSession(captured);
    await uploadVersions(plan, captured.owner, captured);
  }

  assertSession(captured);
  const store = usePlannerStore.getState();
  // 이미 화면에 있는 것과 합쳐서 다시 그린다.
  const merged = mergeByUpdatedAt(store.plans, plans);
  store.setPlans(merged, store.owner);
  if (!(await flushPlannerStorage())) throw new Error('가져온 플랜의 임시 저장을 완료하지 못했습니다. 원래 보관함을 유지합니다.');
  assertSession(captured);
  await clearGuestBackup();
  assertSession(captured);
  for (const plan of plans) {
    if (accepted.has(plan.id) && merged.some((item) => item.id === plan.id && item.updatedAt === plan.updatedAt)) synced.set(plan.id, plan.updatedAt);
  }
  await storeSynced(store.owner);
  return plans.length;
}

/* 합치기 ------------------------------------------------------------- */

/** 두 목록을 ID 기준으로 합치고, 같은 ID 는 `updatedAt` 이 최신인 쪽을 남긴다. */
function mergeByUpdatedAt(a: Plan[], b: Plan[]): Plan[] {
  const map = new Map<string, Plan>();
  for (const plan of [...a, ...b]) {
    const kept = map.get(plan.id);
    if (!kept) { map.set(plan.id, plan); continue; }
    const selected = Date.parse(plan.updatedAt) > Date.parse(kept.updatedAt) ? plan : kept;
    const versions = new Map(kept.versions.map((version) => [version.id, version]));
    for (const version of plan.versions) {
      const previous = versions.get(version.id);
      versions.set(version.id, previous?.snapshot && !version.snapshot ? previous : version);
    }
    map.set(plan.id, { ...selected, versions: [...versions.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt)) });
  }
  return [...map.values()].sort(
    (x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
  );
}

function rememberVersions(plan: Plan, owner: string) {
  for (const version of plan.versions) uploadedVersions.add(`${owner}:${plan.id}:${version.id}`);
}

function hasPendingVersions(plan: Plan, owner: string): boolean {
  return plan.versions.some((version) => !uploadedVersions.has(`${owner}:${plan.id}:${version.id}`));
}

async function uploadVersions(plan: Plan, owner: string, captured: SyncSession): Promise<void> {
  for (const metadata of plan.versions) {
    assertSession(captured);
    const key = `${owner}:${plan.id}:${metadata.id}`;
    if (uploadedVersions.has(key)) continue;
    const version = metadata.snapshot ? metadata : await readPlannerVersion(plan.id, metadata.id);
    assertSession(captured);
    if (!version?.snapshot) throw new Error(`버전 '${metadata.label}'의 본문을 찾지 못했습니다. 복구 파일을 받아 보관해 주세요.`);
    const response = await request(`/api/plans/${encodeURIComponent(plan.id)}/versions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }),
    }, captured);
    assertSession(captured);
    if (response.status === 404) {
      const check = await request(`/api/plans/${encodeURIComponent(plan.id)}`, { cache: 'no-store' }, captured);
      if (check.ok) {
        const remote = await check.json() as { plan?: Plan };
        assertSession(captured);
        if (remote.plan && !remote.plan.versions.some((row) => row.id === metadata.id)) {
          if (!(await preservePlannerRecovery(plan, '다른 기기에서 삭제된 버전의 로컬 복구본'))) {
            throw new Error('삭제된 버전의 복구본을 보관하지 못했습니다. 복구 파일을 받아 주세요.');
          }
          assertSession(captured);
          usePlannerStore.getState().removeVersion(plan.id, metadata.id);
          uploadedVersions.add(key);
          continue;
        }
      }
    }
    if (!response.ok) throw new Error(await describe(response));
    uploadedVersions.add(key);
  }
}

async function preserveReplacedPlans(local: Plan[], server: Plan[], captured: SyncSession) {
  for (const previous of local) {
    assertSession(captured);
    const next = server.find((plan) => plan.id === previous.id);
    if (next && Date.parse(next.updatedAt) > Date.parse(previous.updatedAt) && synced.get(previous.id) !== previous.updatedAt) {
      const preserved = await preservePlannerRecovery(previous, '서버의 최신 문서를 적용하기 전 로컬 수정본');
      assertSession(captured);
      if (!preserved) {
        throw new Error('로컬 복구본을 저장하지 못해 최신 서버본으로 덮어쓰지 않았습니다. 임시 저장본을 내보낸 뒤 다시 시도해 주세요.');
      }
    }
  }
}

/* 로그인 / 로그아웃 --------------------------------------------------- */

/**
 * 로그인 직후 한 번 부른다.
 *
 * 지금 브라우저에 있는 플랜이 이 계정 것이 아니면 **먼저 보관함으로 옮기고 비운다.**
 * 한 컴퓨터를 여러 명이 돌려 쓸 때 남의 플랜이 딸려 올라가는 것을 막는다.
 */
export async function adoptUser(userId: string): Promise<void> {
  const captured = beginSession(WORKSPACE?.userId ?? userId);
  const store = usePlannerStore.getState();

  if (WORKSPACE) {
    if (!workspaceActive() || userId !== WORKSPACE.actorId) {
      await releaseUser();
      return;
    }
    // 지원 탭에는 선택한 사용자 원본 하나만 둔다. 개인·게스트 플랜을 가져오지 않는다.
    if (store.owner !== WORKSPACE.userId) {
      store.setPlans([], WORKSPACE.userId);
      synced = new Map();
      await storeSynced(WORKSPACE.userId);
      if (!currentSession(captured)) return;
    } else {
      store.setPlans(store.plans.filter((plan) => plan.id === WORKSPACE.planId), WORKSPACE.userId);
      const loaded = await loadSynced(WORKSPACE.userId);
      if (!ownsSession(captured)) return;
      synced = loaded;
    }
    await pullWorkspace(captured);
    if (ownsSession(captured)) start(captured);
    return;
  }

  if (store.owner !== userId) {
    if (store.owner === null && store.plans.length > 0) {
      // 로그인 전에 만든 것 — 버리지 않고 보관해 둔 뒤 물어본다.
      if (!(await writeGuestBackup(store.plans))) {
        if (!currentSession(captured)) return;
        emit('error', '로그인 전 작업본을 보관하지 못해 계정 문서로 전환하지 않았습니다. 임시 저장본을 내보내 주세요.');
        return;
      }
      if (!currentSession(captured)) return;
    } else if (store.owner && store.plans.length > 0) {
      // 다른 계정으로 전환하기 전, 아직 서버에 오르지 않은 원본을 남긴다.
      for (const plan of store.plans) {
        if (synced.get(plan.id) !== plan.updatedAt || hasPendingVersions(plan, store.owner)) {
          const preserved = await preservePlannerRecovery(plan, '계정 전환 전 미동기화 작업본');
          if (!currentSession(captured)) return;
          if (!preserved) {
            emit('error', '미동기화 작업본을 보관하지 못했습니다. 먼저 임시 저장본을 내보내 주세요.');
            return;
          }
        }
        if (!currentSession(captured)) return;
      }
    }
    store.setPlans([], userId);
    synced = new Map();
    await storeSynced(userId);
    if (!ownsSession(captured)) return;
  } else {
    // 같은 계정으로 돌아왔다. 무엇을 올려 뒀었는지 기억을 되살린다.
    const loaded = await loadSynced(userId);
    if (!ownsSession(captured)) return;
    synced = loaded;
  }

  await pull(userId, captured);
  if (ownsSession(captured)) start(captured);
}

/** 로그아웃. 플랜은 서버에 있으므로 이 브라우저에서는 지운다. */
export async function releaseUser(): Promise<void> {
  const captured = beginSession(null);
  const store = usePlannerStore.getState();
  for (const plan of store.plans) {
    if (synced.get(plan.id) !== plan.updatedAt || hasPendingVersions(plan, store.owner ?? 'guest')) {
      const preserved = await preservePlannerRecovery(plan, '로그아웃 전 미동기화 작업본');
      if (!currentSession(captured)) return;
      if (!preserved) {
        emit('error', '작업본의 안전한 보관을 완료하지 못했습니다. 로그인 후 저장을 다시 시도해 주세요.');
        return;
      }
    }
    if (!currentSession(captured)) return;
  }
  synced = new Map();
  await storeSynced(null);
  if (!currentSession(captured)) return;
  if (store.owner !== null) store.setPlans([], null);
  emit('idle');
}

async function pull(userId: string, captured: SyncSession): Promise<void> {
  await serialize(async () => {
    if (!ownsSession(captured)) return;
    emit('syncing');
    try {
      const server: Plan[] = [];
      let cursor: string | null = null;
      do {
        const res = await request(`/api/plans?pageSize=1${cursor ? `&afterId=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' }, captured);
        if (!res.ok) throw new Error(await describe(res));
        const page = await res.json() as { plans: Plan[]; nextCursor?: string | null };
        assertSession(captured);
        server.push(...page.plans);
        cursor = page.nextCursor ?? null;
      } while (cursor);
      const onServer = new Set(server.map((plan) => plan.id));

      const local = usePlannerStore.getState().plans;
      await preserveReplacedPlans(local, server, captured);
      assertSession(captured);
      for (const plan of server) rememberVersions(plan, userId);
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
      await storeSynced(userId);
      assertSession(captured);
      emit('saved');
    } catch (error) {
      if (!ownsSession(captured)) return;
      emit('error', error instanceof Error ? error.message : '동기화에 실패했습니다.');
    }
  });
  if (ownsSession(captured)) schedule(0, captured);
}

/** 사용자 지원 탭은 전체 목록이 아니라 선택한 플랜만 읽는다. */
async function pullWorkspace(captured: SyncSession): Promise<void> {
  if (!WORKSPACE || !ownsSession(captured)) return;
  const scope = WORKSPACE;
  await serialize(async () => {
    if (!ownsSession(captured)) return;
    emit('syncing');
    try {
      const res = await request(`/api/plans/${encodeURIComponent(scope.planId)}`, { cache: 'no-store' }, captured);
      if (!res.ok) throw new Error(await describe(res));
      const { plan: server, owner } = (await res.json()) as { plan: Plan; owner?: { id: string; name?: string; email?: string } };
      if (!server || server.id !== scope.planId) throw new Error('선택한 사용자 플랜을 불러오지 못했습니다.');
      if (!ownsSession(captured)) return;
      if (owner) setAdminWorkspaceOwner(owner);
      const local = usePlannerStore.getState().plans.filter((plan) => plan.id === scope.planId);
      await preserveReplacedPlans(local, [server], captured);
      assertSession(captured);
      rememberVersions(server, scope.userId);
      const merged = mergeByUpdatedAt(local, [server]);
      usePlannerStore.getState().setPlans(merged, scope.userId);
      // 오프라인 수정본이 더 최신이면 보존한 뒤 원래 사용자의 플랜으로 저장한다.
      synced = new Map(merged[0]?.updatedAt === server.updatedAt ? [[server.id, server.updatedAt]] : []);
      await storeSynced(scope.userId);
      assertSession(captured);
      emit('saved');
    } catch (error) {
      if (ownsSession(captured)) emit('error', error instanceof Error ? error.message : '사용자 플랜을 불러오지 못했습니다.');
    }
  });
  if (ownsSession(captured)) schedule(0, captured);
}

/* 밀어 올리기 --------------------------------------------------------- */

function start(captured: SyncSession) {
  if (!ownsSession(captured)) return;
  unsubscribe ??= usePlannerStore.subscribe((next, previous) => {
    if (ownsSession(captured) && (next.plans !== previous.plans || next.owner !== previous.owner)) {
      emit('syncing');
      schedule();
    }
  });
  if (typeof window !== 'undefined') window.addEventListener?.('online', online);
}

function online() { retries = 0; schedule(0); }

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (typeof window !== 'undefined') window.removeEventListener?.('online', online);
}

/**
 * 잠깐 모았다가 보낸다.
 *
 * 타자 한 번마다 보내면 요청이 폭주한다. 1.2초는 "손을 멈추면 곧 저장된다" 로
 * 느껴지면서 요청은 충분히 줄어드는 지점이다. 이 사이에 창이 닫혀도 내용은
 * localStorage 에 남아 있고, 다음에 들어올 때 서버보다 최신이라 다시 올라간다.
 */
function schedule(delay = 1200, captured = session) {
  if (!ownsSession(captured)) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void serialize(() => push(captured)), delay);
}

/** 지원 탭을 닫기 전에 방금 입력한 내용까지 서버에 반영한다. 실패하면 탭 문맥을 유지한다. */
export async function flushPlanSync(): Promise<boolean> {
  const captured = session;
  if (timer) clearTimeout(timer);
  timer = null;
  if (!workspaceActive()) return false;
  await serialize(() => push(captured));
  if (!ownsSession(captured)) return false;
  const state = usePlannerStore.getState();
  if (WORKSPACE) {
    if (!workspaceActive() || state.owner !== WORKSPACE.userId) return false;
    const plan = state.plans.find((item) => item.id === WORKSPACE.planId);
    // 최초 조회 실패로 작업본이 없거나 마지막 저장본과 같다면 잃을 수정이 없다.
    // 오래된 조회 오류가 관리 목록으로 돌아가는 길을 막지 않도록 한다.
    return !plan || (synced.get(plan.id) === plan.updatedAt && !hasPendingVersions(plan, state.owner));
  }
  if (snapshot.state === 'error') return false;
  return !!state.owner && state.plans.every((plan) => synced.get(plan.id) === plan.updatedAt && !hasPendingVersions(plan, state.owner!));
}

async function push(captured: SyncSession): Promise<void> {
  if (!ownsSession(captured)) return;
  if (WORKSPACE) return pushWorkspace(captured);
  const store = usePlannerStore.getState();
  const owner = store.owner;
  if (!owner) return;

  emit('syncing');
  try {
    // 지운 것 먼저 — 다시 만들어진 플랜을 지우지 않도록 순서가 중요하다.
    for (const id of [...synced.keys()]) {
      if (store.plans.some((plan) => plan.id === id)) continue;
      const res = await request(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE' }, captured);
      assertSession(captured);
      if (!res.ok) throw new Error(await describe(res));
      synced.delete(id);
      await storeSynced(owner);
      assertSession(captured);
    }

    for (const plan of store.plans) {
      if (synced.get(plan.id) === plan.updatedAt && !hasPendingVersions(plan, owner)) continue;
      if (!ownsSession(captured)) return;
      await saveOnePlan(plan, owner, captured);
    }

    // 보내는 사이에 로그아웃했거나 계정이 바뀌었으면 결과를 반영하지 않는다.
    if (!ownsSession(captured)) return;
    retries = 0;
    if (usePlannerStore.getState().plans.some((plan) => synced.get(plan.id) !== plan.updatedAt || hasPendingVersions(plan, owner))) {
      emit('syncing'); schedule(0);
    } else emit('saved');
  } catch (error) {
    if (!ownsSession(captured)) return;
    emit('error', error instanceof Error ? error.message : '저장에 실패했습니다.');
    retryLater();
  }
}

/** 선택한 플랜 외의 생성·가져오기·삭제를 지원 동기화로 추론하지 않는다. */
async function pushWorkspace(captured: SyncSession): Promise<void> {
  if (!WORKSPACE || !ownsSession(captured)) return;
  const scope = WORKSPACE;
  const store = usePlannerStore.getState();
  if (store.owner !== scope.userId) return;
  const plan = store.plans.find((item) => item.id === scope.planId);
  // 선택한 플랜이 사라져도 다른 플랜을 지우거나 개인 계정에 새로 만들지 않는다.
  if (!plan || (synced.get(plan.id) === plan.updatedAt && !hasPendingVersions(plan, scope.userId))) {
    if (snapshot.state !== 'error') emit('saved');
    return;
  }
  emit('syncing');
  try {
    await saveOnePlan(plan, scope.userId, captured);
    if (!ownsSession(captured)) return;
    retries = 0;
    const current = usePlannerStore.getState().getPlan(plan.id);
    if (current && synced.get(plan.id) === current.updatedAt && !hasPendingVersions(current, scope.userId)) emit('saved');
    else { emit('syncing'); schedule(0); }
  } catch (error) {
    if (!ownsSession(captured)) return;
    if (workspaceActive()) emit('error', error instanceof Error ? error.message : '사용자 플랜을 저장하지 못했습니다.');
    retryLater();
  }
}

function retryLater() {
  if (!workspaceActive() || !usePlannerStore.getState().owner) return;
  retries += 1;
  schedule(Math.min(60_000, 1500 * 2 ** Math.min(retries, 5)));
}

/** 본문과 새 이력을 각각 작은 요청으로 저장한다. 서버 확인 전에는 동기화 완료로 표시하지 않는다. */
async function saveOnePlan(plan: Plan, owner: string, captured: SyncSession): Promise<void> {
  const url = `/api/plans/${encodeURIComponent(plan.id)}`;
  const response = await request(url, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: compactPlan(plan) }),
  }, captured);
  if (!response.ok) throw new Error(await describe(response));
  const result = await response.json() as { applied?: boolean };
  assertSession(captured);
  await uploadVersions(plan, owner, captured);
  if (!ownsSession(captured)) return;
  if (result.applied === false) {
    // 서버가 이겨도 전송 전 작업본은 복구함에 남긴다. 저장 실패 시 덮어쓰지 않는다.
    if (!(await preservePlannerRecovery(plan, '서버와 충돌한 로컬 작업본'))) {
      throw new Error('충돌한 작업본을 보관하지 못해 서버 문서로 덮어쓰지 않았습니다. 임시 저장본을 내보내 주세요.');
    }
    assertSession(captured);
    const latest = await request(url, { cache: 'no-store' }, captured);
    if (!latest.ok) throw new Error(await describe(latest));
    const { plan: server } = await latest.json() as { plan: Plan };
    if (!server || server.id !== plan.id) throw new Error('최신 플랜을 불러오지 못했습니다.');
    if (!ownsSession(captured)) return;
    const current = usePlannerStore.getState();
    const local = current.getPlan(plan.id);
    if (local && local.updatedAt !== plan.updatedAt) await preserveReplacedPlans([local], [server], captured);
    assertSession(captured);
    const merged = mergeByUpdatedAt(local?.updatedAt !== plan.updatedAt && local ? [local] : [], [server]);
    current.setPlans(current.plans.map((item) => item.id === plan.id ? merged[0] : item), owner);
    rememberVersions(server, owner);
    synced.set(plan.id, server.updatedAt);
  } else {
    synced.set(plan.id, plan.updatedAt);
  }
  await storeSynced(owner);
}

async function describe(res: Response): Promise<string> {
  if (res.status === 401) return '로그인이 풀렸습니다. 다시 로그인해 주세요.';
  if (res.status === 413) return '전송 데이터가 서버 한도를 초과했습니다. 작업본은 유지됩니다. 임시 저장본을 내려받아 보관해 주세요.';
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `서버 오류 (${res.status})`;
}
