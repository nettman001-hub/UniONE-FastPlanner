import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { indexedDB, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import type { Plan, PlanVersion } from '../../src/lib/types';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PERSONAL = 'unione-fastplaner:v1';
const ADMIN = `${PERSONAL}:admin:actor:target:shared-plan`;
const GUEST = 'unione-fastplaner:guest-backup';
const values = new Map<string, string>();
const removed: string[] = [];
const savedGlobals = { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, localStorage: globalThis.localStorage };
let storage: typeof import('../../src/lib/planner-storage');
const originalPut = IDBObjectStore.prototype.put;
const originalGet = IDBObjectStore.prototype.get;
const originalGetAll = IDBObjectStore.prototype.getAll;
const writes: Record<string, number> = {};

function version(id: string, marker: string): PlanVersion {
  return {
    id, label: marker, createdAt: '2026-11-10T10:00:00.000Z',
    snapshot: { prd: { overview: marker }, features: [], requirements: [], specifications: [], iaPages: [], flows: [], wireframes: [] } as unknown as PlanVersion['snapshot'],
  };
}

function plan(marker: string, updatedAt = '2026-11-10T10:00:00.000Z'): Plan {
  return {
    id: 'shared-plan', brief: { title: marker }, updatedAt,
    requirements: [], features: [], specifications: [], iaPages: [], flows: [], wireframes: [],
    chat: [], comments: [], versions: [version('v1', marker)],
    generated: { prd: true, fs: false, ia: false, flow: false, wireframe: false },
    prd: { overview: marker }, createdAt: updatedAt,
  } as unknown as Plan;
}

function envelope(plans: Plan[], owner = 'personal-owner', extra: Record<string, unknown> = {}) {
  return { state: { plans, owner, interrupted: null, agentOpen: false, ...extra }, version: 3 };
}

async function readStore(name: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(storage.PLANNER_DATABASE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const transaction = db.transaction(name, 'readonly');
    const request = transaction.objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

before(async () => {
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.localStorage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: () => { throw new DOMException('localStorage is full', 'QuotaExceededError'); },
    removeItem: (key) => { removed.push(key); values.delete(key); },
    clear: () => values.clear(),
  };
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
    writes[this.name] = (writes[this.name] ?? 0) + 1;
    return originalPut.apply(this, args);
  };
  // Exceed the old 5MB localStorage budget while making writes to that storage impossible.
  const large = plan('본문'.repeat(3_000_000));
  large.versions = Array.from({ length: 24 }, (_, index) => version(`legacy-${index}`, `보존할 버전 ${index}`));
  values.set(PERSONAL, JSON.stringify(envelope([large])));
  values.set(ADMIN, JSON.stringify(envelope([plan('대상 사용자 원본')], 'target')));
  values.set(GUEST, JSON.stringify([plan('로그인 전 플랜')]));
  values.set('unione-fastplaner:synced:v1', JSON.stringify({ owner: 'personal-owner', items: { 'shared-plan': '2026-11-10T10:00:00.000Z' } }));
  values.set('unione-fastplaner:unrelated-marker', 'unrelated marker');
  storage = await import('../../src/lib/planner-storage');
});

after(async () => {
  await storage.flushPlannerStorage();
  IDBObjectStore.prototype.put = originalPut;
  IDBObjectStore.prototype.get = originalGet;
  IDBObjectStore.prototype.getAll = originalGetAll;
  globalThis.indexedDB = savedGlobals.indexedDB;
  globalThis.IDBKeyRange = savedGlobals.IDBKeyRange;
  if (savedGlobals.localStorage) globalThis.localStorage = savedGlobals.localStorage;
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('full localStorage migrates >5MB personal, isolated admin and guest sources with every version preserved', async () => {
  const adapter = storage.createPlannerStorage(PERSONAL);
  const raw = await adapter.getItem(PERSONAL);
  const hydrated = JSON.parse(raw!) as ReturnType<typeof envelope>;
  assert.equal(hydrated.state.plans[0].brief.title.length, 6_000_000);
  assert.equal(hydrated.state.plans[0].versions.length, 24);
  assert.equal(hydrated.state.plans[0].versions[0].snapshot, undefined, 'hydration must not pull every old body into memory');
  assert.equal(await storage.flushPlannerStorage(), true);
  assert.equal(values.has(PERSONAL), false);
  assert.equal(values.has(ADMIN), false);
  assert.equal(values.has(GUEST), false);
  assert.equal(values.has('unione-fastplaner:synced:v1'), false);
  assert.equal(values.get('unione-fastplaner:unrelated-marker'), 'unrelated marker');
  const archives = await readStore('legacy') as Array<{ namespace: string; raw: string }>;
  assert.equal(archives.length, 4);
  assert.equal(JSON.parse(archives.find((row) => row.namespace === PERSONAL)!.raw).state.plans[0].versions.length, 24);
  const histories = await readStore('versions') as Array<{ namespace: string }>;
  assert.equal(histories.filter((row) => row.namespace === PERSONAL).length, 24);
  assert.equal((await storage.readPlannerVersion('shared-plan', 'legacy-23'))?.snapshot?.prd.overview, '보존할 버전 23');
  const admin = JSON.parse((await storage.createPlannerStorage(ADMIN).getItem(ADMIN))!);
  assert.equal(admin.state.owner, 'target');
  assert.equal(admin.state.plans[0].brief.title, '대상 사용자 원본');
  const guest = JSON.parse((await storage.createPlannerStorage(GUEST).getItem(GUEST))!);
  assert.equal(guest.state.owner, null);
  assert.equal(guest.state.plans[0].brief.title, '로그인 전 플랜');
  assert.equal(guest.state.plans[0].versions[0].snapshot, undefined);
  assert.equal((await storage.readPlannerVersion('shared-plan', 'v1', GUEST))?.snapshot?.prd.overview, '로그인 전 플랜');
  const sync = JSON.parse((await storage.createPlannerStorage('unione-fastplaner:synced:v1').getItem('unione-fastplaner:synced:v1'))!);
  assert.equal(sync.state.owner, 'personal-owner');
  assert.equal(sync.state.syncItems['shared-plan'], '2026-11-10T10:00:00.000Z');
});

test('only metadata changes for agent panel updates and identical busy-only payloads write no document records', async () => {
  const namespace = `${PERSONAL}:admin:noop:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  const original = envelope([plan('문서')], 'owner');
  await adapter.setItem(namespace, JSON.stringify(original));
  for (const key of Object.keys(writes)) writes[key] = 0;
  const opened = { ...original, state: { ...original.state, agentOpen: true } };
  await adapter.setItem(namespace, JSON.stringify(opened));
  assert.equal(writes.workspaces, 1);
  assert.equal(writes.plans ?? 0, 0);
  assert.equal(writes.versions ?? 0, 0);
  await adapter.setItem(namespace, JSON.stringify(opened));
  assert.equal(writes.workspaces, 1);
  assert.equal(writes.plans ?? 0, 0);
  assert.equal(writes.versions ?? 0, 0);
});

test('rapid changes commit in order and a new adapter hydrates the final state with lazy version bodies', async () => {
  const namespace = `${PERSONAL}:admin:ordering:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  const first = envelope([plan('첫 변경')], 'owner');
  const second = envelope([plan('마지막 변경', '2026-11-10T11:00:00.000Z')], 'owner');
  await Promise.all([
    adapter.setItem(namespace, JSON.stringify(first)),
    adapter.setItem(namespace, JSON.stringify(second)),
  ]);
  let loadedVersionCollections = 0;
  IDBObjectStore.prototype.getAll = function (...args: Parameters<typeof originalGetAll>) {
    if (this.name === 'versions') loadedVersionCollections += 1;
    return originalGetAll.apply(this, args);
  };
  const restarted = storage.createPlannerStorage(namespace);
  const hydrated = JSON.parse((await restarted.getItem(namespace))!);
  IDBObjectStore.prototype.getAll = originalGetAll;
  assert.equal(loadedVersionCollections, 0);
  assert.equal(hydrated.state.plans[0].brief.title, '마지막 변경');
  assert.equal(hydrated.state.plans[0].versions[0].snapshot, undefined);
  assert.equal((await storage.readPlannerVersion('shared-plan', 'v1'))?.snapshot?.prd.overview, '마지막 변경');
});

test('transaction failure retains the exact legacy source and pending work, then explicit retry verifies and removes it', async () => {
  const namespace = `${PERSONAL}:admin:failure:owner:shared-plan`;
  const raw = JSON.stringify(envelope([plan('반드시 남겨야 할 원본')], 'owner'));
  values.set(namespace, raw);
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
    if (this.name === 'versions') throw new DOMException('mock quota failure', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  assert.equal(await storage.retryPlannerStorage(), false);
  const adapter = storage.createPlannerStorage(namespace);
  const fallback = JSON.parse((await adapter.getItem(namespace))!);
  assert.equal(fallback.state.plans[0].brief.title, '반드시 남겨야 할 원본');
  assert.equal(values.get(namespace), raw);
  assert.equal(storage.plannerStorageSnapshot().state, 'error');
  await assert.doesNotReject(Promise.resolve(adapter.setItem(namespace, JSON.stringify(envelope([plan('실패 중에도 가능한 편집')], 'owner')))));
  assert.equal(await storage.flushPlannerStorage(), false);
  const recovery = await storage.exportPlannerRecovery() as { current: ReturnType<typeof envelope> };
  assert.equal(recovery.current.state.plans[0].brief.title, '실패 중에도 가능한 편집');
  IDBObjectStore.prototype.put = originalPut;
  assert.equal(await storage.retryPlannerStorage(), true);
  assert.equal(values.has(namespace), false);
  const restored = JSON.parse((await adapter.getItem(namespace))!);
  assert.equal(restored.state.plans[0].brief.title, '실패 중에도 가능한 편집');
  const archive = (await readStore('legacy') as Array<{ namespace: string; raw: string }>).find((row) => row.namespace === namespace);
  assert.equal(archive?.raw, raw);
});

test('fire-and-forget editing immediately followed by retry cannot restore an older failed payload', async () => {
  const namespace = `${PERSONAL}:admin:retry-race:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  await adapter.setItem(namespace, JSON.stringify(envelope([plan('기존 문서')], 'owner')));
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
    if (this.name === 'plans') throw new DOMException('mock write failure', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  await adapter.setItem(namespace, JSON.stringify(envelope([plan('먼저 실패한 문서')], 'owner')));
  assert.equal(await storage.flushPlannerStorage(), false);
  IDBObjectStore.prototype.put = originalPut;
  const pendingWrite = adapter.setItem(namespace, JSON.stringify(envelope([plan('가장 마지막에 편집한 문서')], 'owner')));
  const retry = storage.retryPlannerStorage();
  await pendingWrite;
  assert.equal(await retry, true);
  const durable = JSON.parse((await adapter.getItem(namespace))!);
  assert.equal(durable.state.plans[0].brief.title, '가장 마지막에 편집한 문서');
});

test('a committed migration is not allowed to delete its source when readback verification fails', async () => {
  const namespace = `${PERSONAL}:admin:readback:owner:shared-plan`;
  const source = JSON.stringify(envelope([plan('검증 전에는 지우지 않을 원본')], 'owner'));
  values.set(namespace, source);
  IDBObjectStore.prototype.get = function (...args: Parameters<typeof originalGet>) {
    if (this.name === 'legacy') throw new Error('mock readback failure');
    return originalGet.apply(this, args);
  };
  assert.equal(await storage.retryPlannerStorage(), false);
  assert.equal(values.get(namespace), source);
  assert.equal(removed.includes(namespace), false);
  IDBObjectStore.prototype.get = originalGet;
  assert.equal(await storage.retryPlannerStorage(), true);
  assert.equal(values.has(namespace), false);
});

test('migration preserves newer IndexedDB documents, older legacy versions and the complete original archive', async () => {
  const namespace = `${PERSONAL}:admin:newer:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  const newer = plan('이미 저장된 최신 문서', '2026-11-10T13:00:00.000Z');
  newer.versions = [version('new-v', '최신 버전')];
  await adapter.setItem(namespace, JSON.stringify(envelope([newer], 'owner')));
  const older = plan('이전 localStorage 문서', '2026-11-10T10:00:00.000Z');
  older.versions = [version('old-v', '옛 버전도 보존')];
  const source = JSON.stringify(envelope([older], 'owner'));
  values.set(namespace, source);
  assert.equal(await storage.retryPlannerStorage(), true);
  const hydrated = JSON.parse((await adapter.getItem(namespace))!);
  assert.equal(hydrated.state.plans[0].brief.title, newer.brief.title);
  assert.deepEqual(new Set(hydrated.state.plans[0].versions.map((row: PlanVersion) => row.id)), new Set(['new-v', 'old-v']));
  assert.equal((await storage.readPlannerVersion('shared-plan', 'old-v'))?.snapshot?.prd.overview, '옛 버전도 보존');
  const archives = await readStore('legacy') as Array<{ namespace: string; raw: string }>;
  assert.equal(archives.find((row) => row.namespace === namespace)?.raw, source);
});

for (const oldOwner of ['previous-account', null]) {
  test(`migration isolates ${oldOwner ?? 'guest'} source from the already stored current account`, async () => {
    const namespace = `${PERSONAL}:admin:owner-isolation-${oldOwner ?? 'guest'}:selected:shared-plan`;
    const adapter = storage.createPlannerStorage(namespace);
    const selected = plan('선택 계정의 비공개 원본');
    await adapter.setItem(namespace, JSON.stringify(envelope([selected], 'current-account')));
    const foreign = { ...plan('이전 계정의 비공개 원본'), id: 'foreign-only-plan' };
    const legacy = JSON.stringify(envelope([plan('충돌하는 이전 계정 플랜'), foreign], oldOwner as unknown as string));
    values.set(namespace, legacy);
    assert.equal(await storage.retryPlannerStorage(), true);
    const hydrated = JSON.parse((await adapter.getItem(namespace))!);
    assert.equal(hydrated.state.owner, 'current-account');
    assert.deepEqual(hydrated.state.plans.map((row: Plan) => row.brief.title), ['선택 계정의 비공개 원본']);
    const allArchives = (await readStore('legacy') as Array<{ namespace: string; owner: string | null; raw: string }>).filter((row) => row.namespace === namespace);
    assert.equal(allArchives.find((row) => row.owner === oldOwner)?.raw, legacy);
    assert.ok(allArchives.some((row) => row.owner === 'current-account'), 'both originals must remain archived under their own owners');
    const exported = await storage.exportPlannerRecovery('current-account');
    assert.equal(JSON.stringify(exported).includes('이전 계정'), false);
    assert.equal(JSON.stringify(exported).includes('선택 계정의 비공개 원본'), true);
    const wrongAccount = await storage.exportPlannerRecovery('not-the-current-account') as { current: unknown; archives: unknown[]; recoveries: unknown[] };
    assert.equal(wrongAccount.current, null);
    assert.deepEqual(wrongAccount.archives, []);
    assert.deepEqual(wrongAccount.recoveries, []);
  });
}

test('changing accounts cannot attach the previous owner snapshot to a colliding lightweight version ID', async () => {
  const namespace = `${PERSONAL}:admin:owner-switch:current:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  await adapter.setItem(namespace, JSON.stringify(envelope([plan('이전 계정 전용 스냅샷')], 'previous-account')));
  const selected = plan('현재 계정 문서');
  selected.versions = [{ id: 'v1', label: '현재 계정의 서버 버전', createdAt: '2026-11-10T10:00:00.000Z' }];
  await adapter.setItem(namespace, JSON.stringify(envelope([selected], 'current-account')));
  assert.equal(await storage.readPlannerVersion('shared-plan', 'v1'), null);
  const archives = await readStore('legacy') as Array<{ namespace: string; owner: string | null; raw: string }>;
  assert.ok(archives.some((row) => row.namespace === namespace && row.owner === 'previous-account' && row.raw.includes('이전 계정 전용 스냅샷')));
  const selectedExport = await storage.exportPlannerRecovery('current-account');
  assert.equal(JSON.stringify(selectedExport).includes('이전 계정 전용 스냅샷'), false);
});

test('lightweight version metadata never overwrites a previously saved full snapshot', async () => {
  const namespace = `${PERSONAL}:admin:metadata:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  const original = plan('복원 가능한 버전');
  await adapter.setItem(namespace, JSON.stringify(envelope([original], 'owner')));
  const hydrated = JSON.parse((await adapter.getItem(namespace))!);
  hydrated.state.agentOpen = true;
  await adapter.setItem(namespace, JSON.stringify(hydrated));
  assert.equal((await storage.readPlannerVersion('shared-plan', 'v1'))?.snapshot?.prd.overview, '복원 가능한 버전');
});

test('recovery snapshots and export remain scoped to the active workspace', async () => {
  const namespace = `${PERSONAL}:admin:recovery:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  await adapter.setItem(namespace, JSON.stringify(envelope([plan('충돌 직전 현재본')], 'owner')));
  assert.equal(await storage.preservePlannerRecovery(plan('보존한 충돌본'), '서버 충돌'), true);
  const exported = await storage.exportPlannerRecovery() as { namespace: string; recoveries: Array<{ plan: Plan }>; current: ReturnType<typeof envelope> };
  assert.equal(exported.namespace, namespace);
  assert.equal(exported.current.state.plans[0].brief.title, '충돌 직전 현재본');
  assert.equal(exported.recoveries[0].plan.brief.title, '보존한 충돌본');
  storage.createPlannerStorage(ADMIN);
  const other = await storage.exportPlannerRecovery() as { namespace: string; recoveries: unknown[] };
  assert.equal(other.namespace, ADMIN);
  assert.deepEqual(other.recoveries, []);
});

test('metadata-only recovery resolves every available local history snapshot before export', async () => {
  const namespace = `${PERSONAL}:admin:recovery-history:owner:shared-plan`;
  const adapter = storage.createPlannerStorage(namespace);
  await adapter.setItem(namespace, JSON.stringify(envelope([plan('보존할 원본과 버전')], 'owner')));
  const hydrated = JSON.parse((await adapter.getItem(namespace))!);
  assert.equal(hydrated.state.plans[0].versions[0].snapshot, undefined);
  assert.equal(await storage.preservePlannerRecovery(hydrated.state.plans[0], '메타데이터만 있던 상태의 충돌'), true);
  const exported = await storage.exportPlannerRecovery('owner') as { current: ReturnType<typeof envelope>; recoveries: Array<{ plan: Plan }> };
  assert.equal(exported.current.state.plans[0].versions[0].snapshot?.prd.overview, '보존할 원본과 버전');
  assert.equal(exported.recoveries[0].plan.versions[0].snapshot?.prd.overview, '보존할 원본과 버전');
});

test('an IndexedDB open timeout retains legacy data and completes Zustand hydration with a visible error', () => {
  const moduleUrl = pathToFileURL(resolve('src/lib/planner-storage.ts')).href;
  const storeUrl = pathToFileURL(resolve('src/lib/store.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    const source = ${JSON.stringify(JSON.stringify(envelope([plan('차단되어도 보존할 문서')])))};
    const values = new Map([['${PERSONAL}', source]]);
    globalThis.localStorage = {
      get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key),
      setItem: () => { throw new Error('must not rewrite localStorage'); },
    };
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => realTimeout(callback, delay === 10000 ? 1 : delay, ...args);
    globalThis.indexedDB = { open: () => ({}) };
    const helper = await import(${JSON.stringify(moduleUrl)});
    const adapter = helper.createPlannerStorage('${PERSONAL}');
    const loaded = JSON.parse(await adapter.getItem('${PERSONAL}'));
    assert.equal(loaded.state.plans[0].brief.title, '차단되어도 보존할 문서');
    assert.equal(values.get('${PERSONAL}'), source);
    assert.equal(helper.plannerStorageSnapshot().state, 'error');
    const { usePlannerStore } = await import(${JSON.stringify(storeUrl)});
    for (let step = 0; step < 100 && !usePlannerStore.getState().hydrated; step++) await new Promise((done) => realTimeout(done, 2));
    assert.equal(usePlannerStore.getState().hydrated, true);
    assert.equal(usePlannerStore.getState().plans[0].brief.title, '차단되어도 보존할 문서');
    assert.doesNotThrow(() => usePlannerStore.getState().renamePlan('shared-plan', '저장 실패 중 메모리 편집'));
    await helper.flushPlannerStorage();
    const backup = await helper.exportPlannerRecovery('personal-owner');
    assert.equal(backup.current.state.plans[0].brief.title, '저장 실패 중 메모리 편집');
    assert.equal(values.get('${PERSONAL}'), source);
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
});

test('the actual Zustand store keeps all legacy versions when adding a new snapshot and busy state rewrites no records', async () => {
  const { usePlannerStore } = await import('../../src/lib/store');
  for (let step = 0; step < 100 && !usePlannerStore.getState().hydrated; step += 1) {
    await new Promise((done) => setTimeout(done, 2));
  }
  assert.equal(usePlannerStore.getState().hydrated, true);
  const original = usePlannerStore.getState().plans.find((row) => row.id === 'shared-plan')!;
  assert.equal(original.versions.length, 24);
  assert.doesNotThrow(() => usePlannerStore.getState().saveVersion(original.id, '한도 때문에 지우지 않는 새 버전'));
  assert.equal(usePlannerStore.getState().getPlan(original.id)!.versions.length, 25);
  assert.equal(await storage.flushPlannerStorage(), true);
  const retained = (await readStore('versions') as Array<{ namespace: string }>).filter((row) => row.namespace === PERSONAL);
  assert.equal(retained.length, 25);
  for (const key of Object.keys(writes)) writes[key] = 0;
  usePlannerStore.getState().setAgentBusy(original.id);
  usePlannerStore.getState().setAgentBusy(null);
  assert.equal(await storage.flushPlannerStorage(), true);
  assert.equal(writes.workspaces ?? 0, 0);
  assert.equal(writes.plans ?? 0, 0);
  assert.equal(writes.versions ?? 0, 0);
});
