import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import type { Plan, PlanVersion } from '../../src/lib/types';

const OWNER = 'sync-owner';
const GUEST_KEY = 'unione-fastplaner:guest-backup';
let planner: typeof import('../../src/lib/store');
let sync: typeof import('../../src/lib/sync');
let storage: typeof import('../../src/lib/planner-storage');
let transport: typeof import('../../src/lib/plan-transport');
const originalFetch = globalThis.fetch;
const descriptors = new Map(['localStorage', 'indexedDB', 'IDBKeyRange'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const memory = new Map<string, string>();
const remote = new Map<string, Map<string, Plan>>();
const remoteVersions = new Map<string, PlanVersion>();
const requests: Array<{ owner: string; url: string; method: string; body?: { plan?: Plan; version?: PlanVersion } }> = [];
let actingOwner = OWNER;
let offline = false;
let rejectNextPut: Plan | undefined;

function account(owner = actingOwner): Map<string, Plan> {
  let plans = remote.get(owner);
  if (!plans) { plans = new Map(); remote.set(owner, plans); }
  return plans;
}

before(async () => {
  const local: Storage = {
    get length() { return memory.size; }, clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: (key) => { memory.delete(key); },
  };
  for (const [key, value] of Object.entries({ localStorage: local, indexedDB, IDBKeyRange })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  storage = await import('../../src/lib/planner-storage');
  planner = await import('../../src/lib/store');
  transport = await import('../../src/lib/plan-transport');
  sync = await import('../../src/lib/sync');
  await planner.usePlannerStore.persist.rehydrate();
});

beforeEach(async () => {
  await sync.releaseUser();
  await storage.flushPlannerStorage();
  remote.clear(); remoteVersions.clear(); requests.length = 0;
  actingOwner = OWNER; offline = false; rejectNextPut = undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'https://qa.invalid');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as { plan?: Plan; version?: PlanVersion } : undefined;
    requests.push({ owner: actingOwner, url: `${url.pathname}${url.search}`, method, body });
    if (offline) throw new TypeError('mock offline');
    if (url.pathname === '/api/plans' && method === 'GET') {
      const all = [...account().values()].sort((a, b) => a.id.localeCompare(b.id));
      const cursor = url.searchParams.get('afterId');
      const offset = cursor ? all.findIndex((plan) => plan.id === cursor) + 1 : 0;
      const page = all.slice(offset, offset + 1);
      return Response.json({ plans: page.map(transport.compactPlan), nextCursor: offset + 1 < all.length ? page[0].id : null });
    }
    const match = url.pathname.match(/^\/api\/plans\/([^/]+)(\/versions)?$/);
    assert.ok(match, `unexpected endpoint ${url.pathname}`);
    const id = decodeURIComponent(match[1]);
    if (match[2] && method === 'POST') {
      assert.ok(body?.version?.snapshot, 'separate version upload contains its full snapshot');
      assert.ok(account().has(id), 'plan body must be created before version upload');
      const value = structuredClone(body.version);
      remoteVersions.set(`${actingOwner}:${id}:${value.id}`, value);
      const plan = account().get(id)!;
      const metadata = new Map(plan.versions.map((version) => [version.id, version]));
      metadata.set(value.id, transport.versionSummary(value));
      account().set(id, { ...plan, versions: [...metadata.values()] });
      return Response.json({ saved: true });
    }
    if (method === 'GET') {
      const plan = account().get(id);
      return plan ? Response.json({ plan: transport.compactPlan(plan) }) : Response.json({ error: 'missing' }, { status: 404 });
    }
    if (method === 'DELETE') { account().delete(id); return Response.json({ deleted: true }); }
    assert.equal(method, 'PUT');
    assert.equal(body?.plan?.id, id);
    assert.ok(body.plan.versions.every((version) => version.snapshot === undefined), 'plan PUT must not contain version snapshots');
    if (rejectNextPut) {
      account().set(id, rejectNextPut);
      rejectNextPut = undefined;
      return Response.json({ applied: false });
    }
    account().set(id, structuredClone(body.plan));
    return Response.json({ applied: true });
  };
});

afterEach(async () => { await sync.releaseUser(); await storage.flushPlannerStorage(); });
after(async () => {
  await storage.flushPlannerStorage();
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function plan(id: string, title = id, timestamp = '2000-01-01T00:00:00.000Z'): Plan {
  return { ...planner.createEmptyPlan({ title, oneLiner: '', idea: '동기화 검증', targetUser: '', purpose: '', platform: 'web' }), id, updatedAt: timestamp };
}
function version(id: string, content = id): PlanVersion {
  const documents = plan(`version-${id}`);
  return { id, label: id, createdAt: '2000-01-01T00:00:00.000Z', snapshot: { ...documents, prd: { ...documents.prd, overview: content } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await delay(5);
  }
  assert.fail('mocked account transition did not complete');
}

test('normal account pulls pages independently and uploads full histories outside the plan body', async () => {
  account().set('page-a', plan('page-a'));
  account().set('page-b', plan('page-b'));
  const local = plan('upload-split');
  local.versions = [version('split-version', '원문'.repeat(100_000))];
  planner.usePlannerStore.getState().setPlans([local], OWNER);
  await sync.adoptUser(OWNER);
  assert.equal(await sync.flushPlanSync(), true);
  const pages = requests.filter((request) => request.method === 'GET' && request.url.startsWith('/api/plans?'));
  assert.deepEqual(pages.map((request) => request.url), ['/api/plans?pageSize=1', '/api/plans?pageSize=1&afterId=page-a']);
  const body = requests.find((request) => request.method === 'PUT' && request.body?.plan?.id === local.id)!;
  assert.ok(JSON.stringify(body.body).length < 10_000);
  const posted = requests.find((request) => request.url.endsWith('/versions'))!;
  assert.deepEqual(posted.body?.version?.snapshot, local.versions[0].snapshot);
  assert.deepEqual(remoteVersions.get(`${OWNER}:${local.id}:split-version`)?.snapshot, local.versions[0].snapshot);
  assert.equal(sync.syncSnapshot().state, 'saved');
});

test('a newly saved version is POSTed once and known server histories are not resent', async () => {
  const initial = plan('new-version');
  const old = version('server-history');
  initial.versions = [transport.versionSummary(old)];
  account().set(initial.id, initial);
  remoteVersions.set(`${OWNER}:${initial.id}:${old.id}`, old);
  planner.usePlannerStore.getState().setPlans([], OWNER);
  await sync.adoptUser(OWNER);
  planner.usePlannerStore.getState().saveVersion(initial.id, '새 이력');
  const created = planner.usePlannerStore.getState().getPlan(initial.id)!.versions.find((row) => row.id !== old.id)!;
  assert.equal(await sync.flushPlanSync(), true);
  assert.equal(await sync.flushPlanSync(), true);
  const posts = requests.filter((request) => request.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body?.version?.id, created.id);
  assert.deepEqual(remoteVersions.get(`${OWNER}:${initial.id}:${old.id}`), old);
});

test('offline save failure keeps the working copy and history for retry then flush', async () => {
  const initial = plan('offline-retry');
  account().set(initial.id, initial);
  planner.usePlannerStore.getState().setPlans([], OWNER);
  await sync.adoptUser(OWNER);
  planner.usePlannerStore.getState().renamePlan(initial.id, '오프라인 수정본');
  planner.usePlannerStore.getState().saveVersion(initial.id, '오프라인 버전');
  const local = structuredClone(planner.usePlannerStore.getState().getPlan(initial.id)!);
  offline = true;
  assert.equal(await sync.flushPlanSync(), false);
  assert.equal(sync.syncSnapshot().state, 'error');
  assert.equal(planner.usePlannerStore.getState().getPlan(initial.id)!.brief.title, '오프라인 수정본');
  offline = false;
  assert.equal(await sync.flushPlanSync(), true);
  assert.equal(account().get(initial.id)!.brief.title, '오프라인 수정본');
  assert.deepEqual(remoteVersions.get(`${OWNER}:${initial.id}:${local.versions[0].id}`)?.snapshot, local.versions[0].snapshot);
  assert.equal(sync.syncSnapshot().state, 'saved');
});

test('a server conflict backs up the full local working copy and preserves original history snapshots', async () => {
  const initial = plan('conflict-backup');
  const old = version('existing-history', '기존 버전 원문');
  initial.versions = [transport.versionSummary(old)];
  account().set(initial.id, initial);
  remoteVersions.set(`${OWNER}:${initial.id}:${old.id}`, old);
  const local = { ...initial, brief: { ...initial.brief, title: '충돌 전 로컬 수정본' }, updatedAt: '2020-01-01T00:00:00.000Z', versions: [old, version('local-unsent-history', '미전송 버전 원문')] };
  planner.usePlannerStore.getState().setPlans([local], OWNER);
  await storage.flushPlannerStorage();
  // Rehydrated work contains only summaries; full history is retained in IndexedDB.
  planner.usePlannerStore.getState().setPlans([transport.compactPlan(local)], OWNER);
  rejectNextPut = { ...initial, brief: { ...initial.brief, title: '다른 기기의 최신 문서' }, updatedAt: '2099-01-01T00:00:00.000Z' };
  await sync.adoptUser(OWNER);
  assert.equal(await sync.flushPlanSync(), true);
  await storage.flushPlannerStorage();
  assert.equal(planner.usePlannerStore.getState().getPlan(initial.id)!.brief.title, '다른 기기의 최신 문서');
  assert.deepEqual((await storage.readPlannerVersion(initial.id, old.id))?.snapshot, old.snapshot);
  assert.deepEqual(remoteVersions.get(`${OWNER}:${initial.id}:local-unsent-history`)?.snapshot, local.versions[1].snapshot);
  const recovery = await storage.exportPlannerRecovery() as { recoveries: Array<{ plan: Plan }> };
  const backup = recovery.recoveries.find((row) => row.plan.id === initial.id)!.plan;
  assert.equal(backup.brief.title, '충돌 전 로컬 수정본');
  assert.deepEqual(backup.versions.find((row) => row.id === old.id)?.snapshot, old.snapshot);
});

test('the same plan and version IDs under another owner upload that owner snapshot separately', async () => {
  const id = 'same-owner-id';
  const first = plan(id, '첫 계정'); first.versions = [version('same-version-id', '첫 계정 원문')];
  planner.usePlannerStore.getState().setPlans([first], OWNER);
  await sync.adoptUser(OWNER);
  assert.equal(await sync.flushPlanSync(), true);
  await sync.releaseUser();
  await storage.flushPlannerStorage();
  actingOwner = 'other-owner';
  const other = plan(id, '두 번째 계정'); other.versions = [version('same-version-id', '두 번째 계정 원문')];
  planner.usePlannerStore.getState().setPlans([other], actingOwner);
  await sync.adoptUser(actingOwner);
  assert.equal(await sync.flushPlanSync(), true);
  assert.equal(account(OWNER).get(id)!.brief.title, '첫 계정');
  assert.equal(account(actingOwner).get(id)!.brief.title, '두 번째 계정');
  assert.deepEqual(remoteVersions.get(`${OWNER}:${id}:same-version-id`)?.snapshot, first.versions[0].snapshot);
  assert.deepEqual(remoteVersions.get(`${actingOwner}:${id}:same-version-id`)?.snapshot, other.versions[0].snapshot);
});

test('initial pull keeps a newer server document while uploading a local-only version even when timestamps then match', async () => {
  const id = 'initial-pull-history';
  const local = plan(id, '이전 로컬 문서', '2020-01-01T00:00:00.000Z');
  const history = version('initial-local-only', '아직 서버에 없는 이력');
  local.versions = [history];
  const server = plan(id, '최신 서버 문서', '2099-01-01T00:00:00.000Z');
  account().set(id, server);
  planner.usePlannerStore.getState().setPlans([local], OWNER);
  await storage.flushPlannerStorage();
  await sync.adoptUser(OWNER);
  assert.equal(await sync.flushPlanSync(), true);
  await storage.flushPlannerStorage();
  assert.equal(planner.usePlannerStore.getState().getPlan(id)!.brief.title, server.brief.title);
  assert.equal(planner.usePlannerStore.getState().getPlan(id)!.updatedAt, server.updatedAt);
  assert.deepEqual(remoteVersions.get(`${OWNER}:${id}:${history.id}`)?.snapshot, history.snapshot);
  assert.equal(requests.filter((request) => request.method === 'POST' && request.body?.version?.id === history.id).length, 1);
  const recovery = await storage.exportPlannerRecovery() as { recoveries: Array<{ plan: Plan }> };
  assert.equal(recovery.recoveries.find((row) => row.plan.id === id)?.plan.brief.title, local.brief.title);
});

test('guest migration uploads snapshots from the guest namespace before clearing the backup', async () => {
  const guest = plan('guest-snapshot'); guest.versions = [version('guest-version', '게스트 버전 원문')];
  await storage.createPlannerStorage(GUEST_KEY).setItem(GUEST_KEY, JSON.stringify({ state: { plans: [guest], owner: null }, version: 3 }));
  await storage.flushPlannerStorage();
  planner.usePlannerStore.getState().setPlans([], OWNER);
  await sync.adoptUser(OWNER);
  assert.equal(await sync.importGuestBackup(), 1);
  assert.deepEqual(remoteVersions.get(`${OWNER}:${guest.id}:guest-version`)?.snapshot, guest.versions[0].snapshot);
  assert.deepEqual(await sync.readGuestBackup(), []);
});

test('a delayed previous-account collection cannot replace the next account or upload its private plans', async () => {
  const otherOwner = 'next-account';
  const privateFirst = plan('first-private-plan', '첫 계정 비공개');
  const privateNext = plan('next-private-plan', '다음 계정 비공개');
  account(OWNER).set(privateFirst.id, privateFirst);
  account(otherOwner).set(privateNext.id, privateNext);
  const started = deferred<void>();
  const response = deferred<Response>();
  const normalFetch = globalThis.fetch;
  let first = true;
  let previousSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (input, init) => {
    if (first && String(input).startsWith('/api/plans?')) {
      first = false;
      previousSignal = init?.signal;
      started.resolve();
      // 응답을 무시하지 않는 네트워크 어댑터를 흉내 내 세대 검사도 직접 검증한다.
      return response.promise;
    }
    return normalFetch(input, init);
  };
  planner.usePlannerStore.getState().setPlans([], OWNER);
  const previous = sync.adoptUser(OWNER);
  await started.promise;
  actingOwner = otherOwner;
  const next = sync.adoptUser(otherOwner);
  await until(() => planner.usePlannerStore.getState().owner === otherOwner);
  assert.equal(previousSignal?.aborted, true, '계정 전환은 기존 네트워크도 취소한다.');
  response.resolve(Response.json({ plans: [privateFirst], nextCursor: null }));
  await Promise.all([previous, next]);
  assert.equal(await sync.flushPlanSync(), true);
  assert.equal(planner.usePlannerStore.getState().owner, otherOwner);
  assert.deepEqual(planner.usePlannerStore.getState().plans.map((row) => row.id), [privateNext.id]);
  assert.equal(account(otherOwner).has(privateFirst.id), false);
  assert.ok(!requests.some((request) => request.owner === otherOwner && request.body?.plan?.id === privateFirst.id));
});

test('logout invalidates a collection whose headers arrived but response JSON is still pending', async () => {
  const privatePlan = plan('logout-private');
  const reading = deferred<void>();
  const body = deferred<{ plans: Plan[]; nextCursor: null }>();
  const normalFetch = globalThis.fetch;
  let intercepted = false;
  globalThis.fetch = async (input, init) => {
    if (!intercepted && String(input).startsWith('/api/plans?')) {
      intercepted = true;
      return { ok: true, status: 200, json: async () => { reading.resolve(); return body.promise; } } as Response;
    }
    return normalFetch(input, init);
  };
  planner.usePlannerStore.getState().setPlans([], OWNER);
  const previous = sync.adoptUser(OWNER);
  await reading.promise;
  await sync.releaseUser();
  body.resolve({ plans: [privatePlan], nextCursor: null });
  await previous;
  await delay(20);
  assert.equal(planner.usePlannerStore.getState().owner, null);
  assert.deepEqual(planner.usePlannerStore.getState().plans, []);
  assert.equal(sync.syncSnapshot().state, 'idle');
  assert.equal(requests.length, 0, '만료된 pull은 저장 루프를 다시 시작하지 않는다.');
});

test('account change during guest import preserves the guest archive and prevents cross-account version upload', async () => {
  const guest = plan('switching-guest');
  guest.versions = [version('switching-guest-history')];
  await storage.createPlannerStorage(GUEST_KEY).setItem(GUEST_KEY, JSON.stringify({ state: { plans: [guest], owner: null }, version: 3 }));
  planner.usePlannerStore.getState().setPlans([], OWNER);
  await sync.adoptUser(OWNER);
  const normalFetch = globalThis.fetch;
  const started = deferred<void>();
  const finish = deferred<Response>();
  globalThis.fetch = async (input, init) => {
    const response = await normalFetch(input, init);
    if (String(input) === `/api/plans/${guest.id}` && init?.method === 'PUT' && actingOwner === OWNER) {
      started.resolve();
      return finish.promise;
    }
    return response;
  };
  const importing = sync.importGuestBackup().then(() => null, (error: unknown) => error);
  await started.promise;
  actingOwner = 'guest-import-next-owner';
  const next = sync.adoptUser(actingOwner);
  finish.resolve(Response.json({ applied: true }));
  const error = await importing;
  await next;
  assert.ok(error instanceof DOMException && error.name === 'AbortError');
  assert.equal(account(actingOwner).has(guest.id), false);
  assert.equal(remoteVersions.has(`${actingOwner}:${guest.id}:${guest.versions[0].id}`), false);
  assert.ok((await sync.readGuestBackup()).some((row) => row.id === guest.id), '취소된 가져오기는 원래 보관함을 지우지 않는다.');
  assert.equal(planner.usePlannerStore.getState().owner, actingOwner);
});
