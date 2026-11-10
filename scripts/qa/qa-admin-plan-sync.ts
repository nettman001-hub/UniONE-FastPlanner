import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plan } from '../../src/lib/types';

const ACTOR = 'admin-actor';
const OWNER = 'selected-owner';
const PLAN = 'shared-plan-id';
const PLANNER_KEY = 'unione-fastplaner:v1';
const SYNC_KEY = 'unione-fastplaner:synced:v1';
const GUEST_KEY = 'unione-fastplaner:guest-backup';
const memory = new Map<string, string>();
const session = new Map<string, string>();
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
let planner: typeof import('../../src/lib/store');
let sync: typeof import('../../src/lib/sync');
let workspace: typeof import('../../src/lib/admin-workspace');
let serverPlan: Plan;
let respond: (url: string, init?: RequestInit) => Promise<Response>;
const requests: Array<{ url: string; method: string; headers: Headers; body?: { plan?: Plan } }> = [];

function storage(values: Map<string, string>): Storage {
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

function fixture(title: string, timestamp = '2026-11-10T11:00:00.000Z'): Plan {
  return {
    ...planner.createEmptyPlan({ title, oneLiner: '', idea: '', targetUser: '', purpose: '', platform: 'web' }),
    id: PLAN,
    updatedAt: timestamp,
  };
}

async function until(check: () => boolean) {
  for (let tries = 0; tries < 100; tries += 1) {
    if (check()) return;
    await delay(5);
  }
  assert.fail('expected mocked synchronization did not finish');
}

function assertScopedRequests() {
  for (const request of requests) {
    assert.equal(request.url, `/api/plans/${PLAN}`);
    assert.equal(request.headers.get('x-admin-user-id'), OWNER);
    assert.equal(request.headers.get('x-admin-plan-id'), PLAN);
    assert.ok(['GET', 'PUT'].includes(request.method), 'support sync must not bulk import or infer deletions');
    if (request.body?.plan) assert.equal(request.body.plan.id, PLAN);
  }
}

before(async () => {
  globalThis.localStorage = storage(memory);
  globalThis.window = {
    location: new URL(`https://uniboard.cloud/plans/${PLAN}?adminUserId=${OWNER}&adminActorId=${ACTOR}`),
    sessionStorage: storage(session),
  } as unknown as Window & typeof globalThis;
  // The same ID may exist under two users. Opening support must never read or overwrite this copy.
  memory.set(PLANNER_KEY, JSON.stringify({ state: { owner: ACTOR, plans: [{ id: PLAN, title: 'personal copy' }] }, version: 3 }));
  memory.set(SYNC_KEY, JSON.stringify({ owner: ACTOR, items: { [PLAN]: 'personal-timestamp' } }));
  memory.set(GUEST_KEY, JSON.stringify([{ id: 'private-guest-plan' }]));
  workspace = await import('../../src/lib/admin-workspace');
  planner = await import('../../src/lib/store');
  sync = await import('../../src/lib/sync');
});

beforeEach(() => {
  sync.releaseUser();
  requests.length = 0;
  serverPlan = fixture('사용자 원본');
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) as { plan?: Plan } : undefined,
    });
    return respond(url, init);
  };
  respond = async (_url, init) => init?.method === 'PUT'
    ? Response.json({ applied: true })
    : Response.json({ plan: serverPlan });
});

afterEach(() => { sync.releaseUser(); });
after(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) globalThis.window = originalWindow;
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalStorage) globalThis.localStorage = originalStorage;
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('support loads only the selected original; personal colliding ID and storage remain isolated', async () => {
  const personal = memory.get(PLANNER_KEY);
  const ownSynced = memory.get(SYNC_KEY);
  await sync.adoptUser(ACTOR);
  await delay(20);
  assert.equal(requests.length, 1);
  assertScopedRequests();
  assert.equal(planner.usePlannerStore.getState().owner, OWNER);
  assert.deepEqual(planner.usePlannerStore.getState().plans.map((plan) => plan.brief.title), ['사용자 원본']);
  assert.equal(memory.get(PLANNER_KEY), personal);
  assert.equal(memory.get(SYNC_KEY), ownSynced);
  const supportKey = workspace.workspaceStorageKey(PLANNER_KEY);
  assert.notEqual(supportKey, PLANNER_KEY);
  assert.match(supportKey, /admin-actor:selected-owner:shared-plan-id$/);
  const persisted = JSON.parse(memory.get(supportKey)!) as { state: { owner: string; plans: Plan[] } };
  assert.equal(persisted.state.owner, OWNER);
  assert.equal(persisted.state.plans[0].brief.title, '사용자 원본');
});

test('dirty offline support work is preserved and saved to the selected user only', async () => {
  const dirty = fixture('오프라인에서 수정한 사용자 원본', '2026-11-10T12:00:00.000Z');
  const unrelated = { ...fixture('다른 플랜'), id: 'other-plan' };
  planner.usePlannerStore.getState().setPlans([dirty, unrelated], OWNER);
  await sync.adoptUser(ACTOR);
  await until(() => requests.some((request) => request.method === 'PUT'));
  const write = requests.find((request) => request.method === 'PUT')!;
  assert.equal(write.body?.plan?.brief.title, dirty.brief.title);
  assert.deepEqual(planner.usePlannerStore.getState().plans.map((plan) => plan.id), [PLAN]);
  assertScopedRequests();
  assert.equal(JSON.parse(memory.get(PLANNER_KEY)!).state.owner, ACTOR);
});

test('a newer user edit wins a rejected support write and is fetched from the same owner', async () => {
  const dirty = fixture('관리자 오프라인 수정', '2026-11-10T12:00:00.000Z');
  const latest = fixture('사용자가 다른 기기에서 더 늦게 수정', '2026-11-10T13:00:00.000Z');
  planner.usePlannerStore.getState().setPlans([dirty], OWNER);
  let reads = 0;
  respond = async (_url, init) => {
    if (init?.method === 'PUT') return Response.json({ applied: false });
    reads += 1;
    return Response.json({ plan: reads === 1 ? serverPlan : latest });
  };
  await sync.adoptUser(ACTOR);
  await until(() => planner.usePlannerStore.getState().plans[0]?.brief.title === latest.brief.title);
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT', 'GET']);
  assertScopedRequests();
});

test('support mode never imports guest plans or infers deleting the selected plan', async () => {
  const guest = memory.get(GUEST_KEY);
  assert.deepEqual(sync.readGuestBackup(), []);
  assert.equal(await sync.importGuestBackup(), 0);
  sync.clearGuestBackup();
  assert.equal(memory.get(GUEST_KEY), guest);
  await sync.adoptUser(ACTOR);
  planner.usePlannerStore.getState().deletePlan(PLAN);
  await delay(1250);
  assert.equal(requests.length, 1);
  assertScopedRequests();
});

test('support requests cannot silently fall back to personal bulk or other-plan operations', async () => {
  await assert.rejects(workspace.workspaceFetch('/api/plans'), /선택한 사용자 플랜/);
  await assert.rejects(workspace.workspaceFetch('/api/plans/another-plan', { method: 'PUT' }), /선택한 사용자 플랜/);
  assert.equal(requests.length, 0);
});

test('the workspace banner receives only the verified selected owner label', async () => {
  respond = async () => Response.json({ plan: serverPlan, owner: { id: OWNER, name: '지원 대상', email: 'owner@example.com' } });
  await sync.adoptUser(ACTOR);
  assert.equal(workspace.adminWorkspaceOwner()?.name, '지원 대상');
  workspace.setAdminWorkspaceOwner({ id: 'unrelated-user', name: '다른 사람' });
  assert.equal(workspace.adminWorkspaceOwner()?.id, OWNER);
  assert.equal(workspace.adminWorkspaceOwner()?.name, '지원 대상');
});

test('another signed-in actor cannot adopt the cached support workspace', async () => {
  planner.usePlannerStore.getState().setPlans([fixture('이전 지원 작업본')], OWNER);
  await sync.adoptUser('different-actor');
  assert.deepEqual(planner.usePlannerStore.getState().plans, []);
  assert.equal(planner.usePlannerStore.getState().owner, null);
  assert.equal(requests.length, 0);
  assert.equal(JSON.parse(memory.get(PLANNER_KEY)!).state.owner, ACTOR);
});

test('malformed support URLs fail closed without selecting or purging personal storage', () => {
  const moduleUrl = pathToFileURL(resolve('src/lib/admin-workspace.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    globalThis.window = {
      location: new URL('https://uniboard.cloud/plans/shared-plan-id?adminUserId=selected-owner'),
      sessionStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    };
    const workspace = await import(${JSON.stringify(moduleUrl)});
    assert.equal(workspace.adminWorkspace(), null);
    assert.equal(workspace.invalidAdminWorkspace(), true);
    assert.equal(workspace.workspaceStorageKey('personal-key'), 'personal-key');
    await assert.rejects(workspace.workspaceFetch('/api/chat'), /지원 주소가 올바르지/);
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('exit flush saves the latest edit immediately rather than waiting for debounce', async () => {
  await sync.adoptUser(ACTOR);
  planner.usePlannerStore.getState().renamePlan(PLAN, '나가기 직전 수정');
  assert.equal(await sync.flushPlanSync(), true);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 1);
  assert.equal(requests.at(-1)?.body?.plan?.brief.title, '나가기 직전 수정');
  assertScopedRequests();
  assert.equal(workspace.adminWorkspace()?.userId, OWNER);
});

test('failed exit flush preserves the support scope and dirty work for an explicit retry', async () => {
  await sync.adoptUser(ACTOR);
  planner.usePlannerStore.getState().renamePlan(PLAN, '저장 실패해도 보존할 수정');
  respond = async () => Response.json({ error: 'mock save failure' }, { status: 503 });
  assert.equal(await sync.flushPlanSync(), false);
  assert.equal(workspace.adminWorkspace()?.userId, OWNER);
  assert.equal(planner.usePlannerStore.getState().plans[0].brief.title, '저장 실패해도 보존할 수정');
  assert.equal(sync.syncSnapshot().state, 'error');
  respond = async () => Response.json({ applied: true });
  assert.equal(await sync.flushPlanSync(), true);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 2);
  assertScopedRequests();
});

test('a failed initial load with no local changes does not trap the administrator in support', async () => {
  respond = async () => Response.json({ error: 'plan not found' }, { status: 404 });
  await sync.adoptUser(ACTOR);
  assert.deepEqual(planner.usePlannerStore.getState().plans, []);
  assert.equal(sync.syncSnapshot().state, 'error');
  assert.equal(await sync.flushPlanSync(), true);
  assert.deepEqual(requests.map((request) => request.method), ['GET']);
  assert.equal(workspace.adminWorkspace()?.userId, OWNER);
});

test('an obsolete load error does not block exit when the cached plan is already fully saved', async () => {
  planner.usePlannerStore.getState().setPlans([serverPlan], OWNER);
  memory.set(workspace.workspaceStorageKey(SYNC_KEY), JSON.stringify({ owner: OWNER, items: { [PLAN]: serverPlan.updatedAt } }));
  respond = async () => Response.json({ error: 'temporary read failure' }, { status: 503 });
  await sync.adoptUser(ACTOR);
  assert.equal(sync.syncSnapshot().state, 'error');
  assert.equal(await sync.flushPlanSync(), true);
  assert.deepEqual(requests.map((request) => request.method), ['GET']);
  assert.equal(planner.usePlannerStore.getState().plans[0].updatedAt, serverPlan.updatedAt);
});

test('clearing support scope stops late writes and cannot promote cached plans to personal storage', async () => {
  const personal = memory.get(PLANNER_KEY);
  const ownSynced = memory.get(SYNC_KEY);
  await sync.adoptUser(ACTOR);
  await delay(20);
  workspace.clearAdminWorkspace();
  planner.usePlannerStore.getState().renamePlan(PLAN, '종료 직후 늦게 도착한 수정');
  await delay(1250);
  assert.equal(requests.length, 1);
  assert.equal(memory.get(PLANNER_KEY), personal);
  assert.equal(memory.get(SYNC_KEY), ownSynced);
  assert.equal(workspace.adminWorkspace(), null);
  await assert.rejects(workspace.workspaceFetch('/api/chat', { method: 'POST' }), /지원 작업이 종료/);
  await assert.rejects(workspace.workspaceFetch('/api/generate', { method: 'POST' }), /지원 작업이 종료/);
  await assert.rejects(workspace.workspaceFetch(`/api/plans/${PLAN}`, { method: 'PUT' }), /지원 작업이 종료/);
  assert.equal(requests.length, 1);
});
