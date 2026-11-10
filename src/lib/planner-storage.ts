'use client';

import type { StateStorage } from 'zustand/middleware';
import type { Plan, PlanVersion } from './types';

export const PLANNER_DATABASE = 'uniboard-planner-v1';
const LEGACY_PLANNER_KEY = 'unione-fastplaner:v1';
const LEGACY_GUEST_KEY = 'unione-fastplaner:guest-backup';
const LEGACY_SYNC_KEY = 'unione-fastplaner:synced:v1';
type JsonObject = Record<string, unknown>;
type Envelope = JsonObject & { state: JsonObject & { plans: JsonObject[] } };
interface WorkspaceRow { namespace: string; envelope: JsonObject; planIds: string[] }
interface PlanRow { namespace: string; id: string; body: JsonObject; versionIds?: string[]; versionMetadata?: JsonObject[] }
interface VersionRow { namespace: string; planId: string; id: string; body: JsonObject }
interface LegacyRow { namespace: string; id: string; owner: string | null; raw: string; migratedAt: string }
interface RecoveryRow { namespace: string; id: string; owner: string | null; reason: string; plan: Plan; createdAt: string }
interface StoredWorkspace { value: Envelope | null; plans: PlanRow[]; versions: VersionRow[] }

export interface PlannerStorageStatus {
  state: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
}

let status: PlannerStorageStatus = { state: 'idle', error: null };
const listeners = new Set<() => void>();
const failures = new Map<string, string>();
const latest = new Map<string, string>();
const memoryRecovery: RecoveryRow[] = [];
const written = new Map<string, string>();
const revisions = new Map<string, number>();
let primaryNamespace = LEGACY_PLANNER_KEY;
let database: Promise<IDBDatabase> | undefined;
let migration: Promise<void> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let savedOnce = false;

export const plannerStorageSnapshot = (): PlannerStorageStatus => status;
export function subscribePlannerStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish() {
  const message = failures.size ? [...failures.values()][0] : null;
  const next: PlannerStorageStatus = {
    state: message ? 'error' : pending > 0 ? 'saving' : savedOnce ? 'saved' : 'idle',
    error: message,
  };
  if (next.state === status.state && next.error === status.error) return;
  status = next;
  listeners.forEach((listener) => listener());
}

function storageFailure(namespace: string, error: unknown) {
  const name = error instanceof Error ? error.name : 'StorageError';
  failures.set(namespace, `브라우저에 작업을 저장하지 못했습니다. (${name}) 저장 재시도 또는 복구 파일 내보내기를 이용해 주세요.`);
  publish();
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB request failed'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
  // 개별 요청이 먼저 실패해도 트랜잭션의 후속 오류가 처리되지 않은 거절로 새지 않게 한다.
  void result.catch(() => undefined);
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const opening = indexedDB.open(PLANNER_DATABASE, 1);
    let settled = false;
    const timer = setTimeout(() => fail(new Error('IndexedDB open timed out')), 10_000);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore('workspaces', { keyPath: 'namespace' });
      const plans = db.createObjectStore('plans', { keyPath: ['namespace', 'id'] });
      plans.createIndex('namespace', 'namespace');
      const versions = db.createObjectStore('versions', { keyPath: ['namespace', 'planId', 'id'] });
      versions.createIndex('namespace', 'namespace');
      for (const name of ['legacy', 'recovery']) {
        const store = db.createObjectStore(name, { keyPath: ['namespace', 'id'] });
        store.createIndex('namespace', 'namespace');
      }
    };
    opening.onerror = () => fail(opening.error ?? new Error('IndexedDB open failed'));
    opening.onblocked = () => fail(new Error('IndexedDB upgrade is blocked by another tab'));
    opening.onsuccess = () => {
      const db = opening.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  }).catch((error: unknown) => { database = undefined; throw error; });
  return database;
}

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseEnvelope(raw: string, namespace: string): Envelope {
  let value: unknown = JSON.parse(raw);
  if (namespace === LEGACY_GUEST_KEY && Array.isArray(value)) {
    value = { state: { plans: value, owner: null, interrupted: null, agentOpen: false }, version: 3 };
  }
  if ((namespace === LEGACY_SYNC_KEY || namespace.startsWith(`${LEGACY_SYNC_KEY}:admin:`)) && object(value) && !object(value.state)) {
    value = { state: { ...value, plans: [], owner: value.owner ?? null, syncItems: value.items ?? {} }, version: 3 };
  }
  if (!object(value) || !object(value.state) || !Array.isArray(value.state.plans)) {
    throw new Error('Invalid planner storage envelope');
  }
  const ids = new Set<string>();
  for (const plan of value.state.plans) {
    if (!object(plan) || typeof plan.id !== 'string' || !plan.id || ids.has(plan.id)) throw new Error('Invalid planner identity');
    ids.add(plan.id);
  }
  return value as Envelope;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!object(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
}

function ownerOf(value: Envelope | null): string | null {
  return typeof value?.state.owner === 'string' ? value.state.owner : null;
}

async function readWorkspace(namespace: string, includeSnapshots = true): Promise<StoredWorkspace> {
  const db = await openDatabase();
  const transaction = db.transaction(includeSnapshots ? ['workspaces', 'plans', 'versions'] : ['workspaces', 'plans'], 'readonly');
  const done = complete(transaction);
  const [metadata, plans, versions] = await Promise.all([
    request(transaction.objectStore('workspaces').get(namespace) as IDBRequest<WorkspaceRow | undefined>),
    request(transaction.objectStore('plans').index('namespace').getAll(namespace) as IDBRequest<PlanRow[]>),
    includeSnapshots ? request(transaction.objectStore('versions').index('namespace').getAll(namespace) as IDBRequest<VersionRow[]>) : Promise.resolve([] as VersionRow[]),
  ]);
  await done;
  if (!metadata) return { value: null, plans, versions };
  const byPlan = new Map(plans.map((plan) => [plan.id, plan]));
  const byVersion = new Map(versions.map((version) => [`${version.planId}\0${version.id}`, version.body]));
  const reconstructed = metadata.planIds.map((id) => {
    const row = byPlan.get(id);
    if (!row) throw new Error('Planner record is incomplete');
    if (!row.versionIds) return row.body;
    return {
      ...row.body,
      versions: row.versionIds.map((versionId) => {
        if (!includeSnapshots) return row.versionMetadata?.find((version) => version.id === versionId) ?? { id: versionId };
        const version = byVersion.get(`${id}\0${versionId}`);
        if (!version) throw new Error('Version record is incomplete');
        return version;
      }),
    };
  });
  const value = { ...metadata.envelope, state: { ...(metadata.envelope.state as JsonObject), plans: reconstructed } } as Envelope;
  return { value, plans, versions };
}

/** 문서와 버전은 각각 비교한다. 패널·진행 상태 변경으로 긴 본문을 다시 쓰지 않는다. */
async function writeWorkspace(namespace: string, value: Envelope, archive?: LegacyRow | LegacyRow[]): Promise<void> {
  const archives = archive ? (Array.isArray(archive) ? archive : [archive]) : [];
  const old = await readWorkspace(namespace);
  const sameOwner = !old.value || ownerOf(old.value) === ownerOf(value);
  if (!sameOwner && old.value?.state.plans.length) {
    const raw = JSON.stringify(old.value);
    if (!archives.some((row) => row.owner === ownerOf(old.value) && canonical(JSON.parse(row.raw)) === canonical(old.value))) {
      archives.push({ namespace, id: crypto.randomUUID(), owner: ownerOf(old.value), raw, migratedAt: new Date().toISOString() });
    }
  }
  const previousPlans = new Map(old.plans.map((row) => [row.id, row]));
  const previousVersions = new Map(old.versions.map((row) => [`${row.planId}\0${row.id}`, row]));
  const planRows: PlanRow[] = [];
  const versionRows: VersionRow[] = [];
  for (const plan of value.state.plans) {
    const { versions, ...body } = plan;
    const id = plan.id as string;
    if (!Array.isArray(versions)) {
      planRows.push({ namespace, id, body: plan });
      continue;
    }
    const versionIds: string[] = [];
    for (const version of versions) {
      if (!object(version) || typeof version.id !== 'string' || versionIds.includes(version.id)) throw new Error('Invalid version identity');
      versionIds.push(version.id);
      const previous = sameOwner ? previousVersions.get(`${id}\0${version.id}`)?.body : undefined;
      // 서버가 본문 대신 메타데이터만 보냈어도 이미 보관한 스냅샷은 잃지 않는다.
      const preserved = version.snapshot === undefined && previous?.snapshot !== undefined
        ? { ...version, snapshot: previous.snapshot }
        : version;
      versionRows.push({ namespace, planId: id, id: version.id, body: preserved });
    }
    const versionMetadata = versionRows.filter((row) => row.planId === id).map((row) =>
      Object.fromEntries(Object.entries(row.body).filter(([key]) => key !== 'snapshot')),
    );
    planRows.push({ namespace, id, body, versionIds, versionMetadata });
  }
  const stateMetadata = Object.fromEntries(Object.entries(value.state).filter(([key]) => key !== 'plans'));
  const metadata: WorkspaceRow = {
    namespace,
    envelope: { ...value, state: stateMetadata },
    planIds: planRows.map((row) => row.id),
  };
  const oldMetadata = old.value ? {
    namespace,
    envelope: { ...old.value, state: Object.fromEntries(Object.entries(old.value.state).filter(([key]) => key !== 'plans')) },
    planIds: old.value.state.plans.map((plan) => plan.id),
  } : undefined;
  const db = await openDatabase();
  const transaction = db.transaction(['workspaces', 'plans', 'versions', 'legacy'], 'readwrite');
  const done = complete(transaction);
  try {
    if (canonical(oldMetadata) !== canonical(metadata)) transaction.objectStore('workspaces').put(metadata);
    const nextPlans = new Set(planRows.map((row) => row.id));
    const nextVersions = new Set(versionRows.map((row) => `${row.planId}\0${row.id}`));
    for (const row of planRows) {
      if (canonical(previousPlans.get(row.id)) !== canonical(row)) transaction.objectStore('plans').put(row);
    }
    for (const row of versionRows) {
      if (canonical(previousVersions.get(`${row.planId}\0${row.id}`)) !== canonical(row)) transaction.objectStore('versions').put(row);
    }
    for (const row of old.plans) if (!nextPlans.has(row.id)) transaction.objectStore('plans').delete([namespace, row.id]);
    for (const row of old.versions) if (!nextVersions.has(`${row.planId}\0${row.id}`)) transaction.objectStore('versions').delete([namespace, row.planId, row.id]);
    for (const row of archives) transaction.objectStore('legacy').put(row);
  } catch (error) {
    transaction.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
  // 읽기 전용 트랜잭션으로 완료된 자료를 다시 확인한 뒤에만 원본을 정리한다.
  const verified = await readWorkspace(namespace);
  const expectedVersions = new Map(versionRows.map((row) => [`${row.planId}\0${row.id}`, row.body]));
  const expected = {
    ...value,
    state: {
      ...value.state,
      plans: value.state.plans.map((plan) => Array.isArray(plan.versions)
        ? { ...plan, versions: plan.versions.map((version) => expectedVersions.get(`${plan.id}\0${(version as JsonObject).id}`)) }
        : plan),
    },
  };
  if (canonical(verified.value) !== canonical(expected)) throw new Error('Planner storage verification failed');
  for (const archive of archives) {
    const transaction = db.transaction('legacy', 'readonly');
    const checked = complete(transaction);
    const stored = await request(transaction.objectStore('legacy').get([namespace, archive.id]) as IDBRequest<LegacyRow | undefined>);
    await checked;
    if (stored?.raw !== archive.raw) throw new Error('Legacy backup verification failed');
  }
  written.set(namespace, canonical(value));
}

function enqueue(namespace: string, operation: () => Promise<void>): Promise<boolean> {
  pending += 1;
  publish();
  const task = queue.then(async () => {
    try {
      await operation();
      failures.delete(namespace);
      savedOnce = true;
      return true;
    } catch (error) {
      storageFailure(namespace, error);
      return false;
    } finally {
      pending -= 1;
      publish();
    }
  });
  queue = task;
  return task;
}

function mergeLegacy(legacy: Envelope, current: Envelope | null): Envelope {
  if (!current) return legacy;
  // 같은 브라우저 이름 공간을 여러 계정이 썼더라도 한 계정의 작업본으로 합치지 않는다.
  if (ownerOf(legacy) !== ownerOf(current)) return current;
  const plans = new Map(current.state.plans.map((plan) => [plan.id, plan]));
  for (const incoming of legacy.state.plans) {
    const existing = plans.get(incoming.id);
    if (!existing) { plans.set(incoming.id, incoming); continue; }
    const incomingTime = Date.parse(String(incoming.updatedAt ?? '')) || 0;
    const existingTime = Date.parse(String(existing.updatedAt ?? '')) || 0;
    const winner = incomingTime > existingTime ? incoming : existing;
    const histories = new Map<string, JsonObject>();
    for (const row of [...(Array.isArray(incoming.versions) ? incoming.versions : []), ...(Array.isArray(existing.versions) ? existing.versions : [])]) {
      if (object(row) && typeof row.id === 'string') {
        const previous = histories.get(row.id);
        histories.set(row.id, row.snapshot === undefined && previous?.snapshot !== undefined ? { ...row, snapshot: previous.snapshot } : row);
      }
    }
    plans.set(incoming.id, Array.isArray(winner.versions) || histories.size
      ? { ...winner, versions: [...histories.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) }
      : winner);
  }
  return { ...legacy, ...current, state: { ...legacy.state, ...current.state, plans: [...plans.values()] } };
}

function legacySource(namespace: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(namespace);
}

function withoutSnapshots(value: Envelope): Envelope {
  return {
    ...value,
    state: {
      ...value.state,
      plans: value.state.plans.map((plan) => Array.isArray(plan.versions)
        ? { ...plan, versions: plan.versions.map((version) => object(version)
          ? Object.fromEntries(Object.entries(version).filter(([key]) => key !== 'snapshot'))
          : version) }
        : plan),
    },
  };
}

function preservePendingSnapshots(namespace: string, value: Envelope): Envelope {
  const raw = latest.get(namespace);
  if (!raw) return value;
  const prior = parseEnvelope(raw, namespace);
  if (ownerOf(prior) !== ownerOf(value)) return value;
  const plans = new Map(prior.state.plans.map((plan) => [plan.id, plan]));
  return {
    ...value,
    state: {
      ...value.state,
      plans: value.state.plans.map((plan) => {
        const old = plans.get(plan.id);
        if (!Array.isArray(plan.versions) || !Array.isArray(old?.versions)) return plan;
        const snapshots = new Map(old.versions.filter(object).map((version) => [version.id, version.snapshot]));
        return {
          ...plan,
          versions: plan.versions.map((version) => object(version) && version.snapshot === undefined && snapshots.get(version.id) !== undefined
            ? { ...version, snapshot: snapshots.get(version.id) }
            : version),
        };
      }),
    },
  };
}

/** 기존 개인·관리자 작업본과 게스트 보관함만 옮긴다. 동기화 표식 등은 건드리지 않는다. */
export function migrateLegacyPlannerStorage(): Promise<void> {
  if (migration) return migration;
  migration = (async () => {
    const sources: Array<[string, string]> = [];
    try {
      if (typeof localStorage === 'undefined') return;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || (key !== LEGACY_PLANNER_KEY && key !== LEGACY_GUEST_KEY && key !== LEGACY_SYNC_KEY &&
          !key.startsWith(`${LEGACY_PLANNER_KEY}:admin:`) && !key.startsWith(`${LEGACY_SYNC_KEY}:admin:`))) continue;
        const raw = localStorage.getItem(key);
        if (raw !== null) sources.push([key, raw]);
      }
    } catch (error) {
      storageFailure(primaryNamespace, error);
      return;
    }
    for (const [namespace, raw] of sources) {
      await enqueue(namespace, async () => {
        const revision = revisions.get(namespace) ?? 0;
        const pendingRaw = latest.get(namespace);
        const keepPending = !!pendingRaw && (failures.has(namespace) || written.get(namespace) !== canonical(parseEnvelope(pendingRaw, namespace)));
        const source = parseEnvelope(raw, namespace);
        const existing = await readWorkspace(namespace);
        const merged = mergeLegacy(source, existing.value);
        const archives: LegacyRow[] = [{ namespace, id: crypto.randomUUID(), owner: ownerOf(source), raw, migratedAt: new Date().toISOString() }];
        if (existing.value && ownerOf(source) !== ownerOf(existing.value)) {
          archives.push({ namespace, id: crypto.randomUUID(), owner: ownerOf(existing.value), raw: JSON.stringify(existing.value), migratedAt: new Date().toISOString() });
        }
        await writeWorkspace(namespace, merged, archives);
        if ((revisions.get(namespace) ?? 0) === revision && !keepPending) latest.set(namespace, JSON.stringify(merged));
        // 다른 구버전 탭에서 그 사이 내용을 바꿨으면 새 원본은 지우지 않는다.
        if (legacySource(namespace) === raw) localStorage.removeItem(namespace);
      });
    }
  })();
  return migration;
}

/** Zustand는 저장 오류 때문에 편집 동작 자체가 중단되지 않도록 비동기 오류를 상태로 받는다. */
export function createPlannerStorage(namespace: string): StateStorage {
  if (namespace === LEGACY_PLANNER_KEY || namespace.startsWith(`${LEGACY_PLANNER_KEY}:admin:`)) primaryNamespace = namespace;
  return {
    async getItem() {
      const revision = revisions.get(namespace) ?? 0;
      await migrateLegacyPlannerStorage();
      await queue;
      try {
        const current = await readWorkspace(namespace, false);
        if ((revisions.get(namespace) ?? 0) !== revision && latest.has(namespace)) {
          return JSON.stringify(withoutSnapshots(parseEnvelope(latest.get(namespace)!, namespace)));
        }
        let value = current.value;
        const legacy = legacySource(namespace);
        if (legacy !== null) value = mergeLegacy(parseEnvelope(legacy, namespace), value);
        const pendingRaw = failures.has(namespace) ? latest.get(namespace) : undefined;
        if (pendingRaw) value = mergeLegacy(value ?? parseEnvelope(pendingRaw, namespace), parseEnvelope(pendingRaw, namespace));
        if (value) {
          const raw = JSON.stringify(value);
          latest.set(namespace, raw);
          const light = withoutSnapshots(value);
          if (!failures.has(namespace)) written.set(namespace, canonical(light));
          return JSON.stringify(light);
        }
      } catch (error) { storageFailure(namespace, error); }
      try {
        const raw = latest.get(namespace) ?? legacySource(namespace);
        if (raw !== null && raw !== undefined) {
          const normalized = JSON.stringify(parseEnvelope(raw, namespace));
          latest.set(namespace, normalized);
          return JSON.stringify(withoutSnapshots(parseEnvelope(normalized, namespace)));
        }
      } catch (error) { storageFailure(namespace, error); }
      return null;
    },
    setItem(_name, raw) {
      let value: Envelope;
      let preserved: Envelope;
      try {
        value = parseEnvelope(raw, namespace);
        preserved = preservePendingSnapshots(namespace, value);
        latest.set(namespace, JSON.stringify(preserved));
        revisions.set(namespace, (revisions.get(namespace) ?? 0) + 1);
      } catch (error) {
        storageFailure(namespace, error);
        return Promise.resolve();
      }
      return enqueue(namespace, async () => {
        if (written.get(namespace) !== canonical(value)) {
          await writeWorkspace(namespace, preserved);
          written.set(namespace, canonical(value));
        }
      }).then(() => undefined);
    },
    removeItem() {
      latest.delete(namespace);
      revisions.set(namespace, (revisions.get(namespace) ?? 0) + 1);
      written.delete(namespace);
      return enqueue(namespace, async () => {
        const old = await readWorkspace(namespace);
        const db = await openDatabase();
        const transaction = db.transaction(['workspaces', 'plans', 'versions'], 'readwrite');
        const done = complete(transaction);
        transaction.objectStore('workspaces').delete(namespace);
        for (const row of old.plans) transaction.objectStore('plans').delete([namespace, row.id]);
        for (const row of old.versions) transaction.objectStore('versions').delete([namespace, row.planId, row.id]);
        await done;
      }).then(() => undefined);
    },
  };
}

/** 버전 본문은 복원·내보내기를 누른 시점에 한 건씩 읽는다. */
export async function readPlannerVersion(planId: string, versionId: string, namespace = primaryNamespace): Promise<PlanVersion | null> {
  const raw = latest.get(namespace);
  if (raw) {
    const plan = parseEnvelope(raw, namespace).state.plans.find((row) => row.id === planId);
    const version = Array.isArray(plan?.versions)
      ? plan.versions.find((row): row is JsonObject => object(row) && row.id === versionId && row.snapshot !== undefined)
      : undefined;
    if (version) return version as unknown as PlanVersion;
  }
  try {
    const db = await openDatabase();
    const transaction = db.transaction('versions', 'readonly');
    const done = complete(transaction);
    const version = await request(transaction.objectStore('versions').get([namespace, planId, versionId]) as IDBRequest<VersionRow | undefined>);
    await done;
    return version?.body.snapshot ? version.body as unknown as PlanVersion : null;
  } catch (error) {
    storageFailure(namespace, error);
    return null;
  }
}

async function withLocalVersionBodies(plan: Plan, namespace: string): Promise<Plan> {
  if (!Array.isArray(plan.versions)) return plan;
  const versions = await Promise.all(plan.versions.map(async (version) => {
    if (version.snapshot) return version;
    const stored = await readPlannerVersion(plan.id, version.id, namespace);
    return stored?.snapshot ? { ...stored, ...version, snapshot: stored.snapshot } : version;
  }));
  return { ...plan, versions };
}

export async function flushPlannerStorage(): Promise<boolean> {
  await migration;
  await queue;
  return failures.size === 0;
}

export async function retryPlannerStorage(): Promise<boolean> {
  await migration;
  await queue;
  migration = undefined;
  await migrateLegacyPlannerStorage();
  for (const namespace of [...latest.keys()]) {
    await enqueue(namespace, async () => {
      const raw = latest.get(namespace);
      if (raw !== undefined) await writeWorkspace(namespace, parseEnvelope(raw, namespace));
    });
  }
  for (const row of [...memoryRecovery]) {
    if (await saveRecovery(row)) memoryRecovery.splice(memoryRecovery.indexOf(row), 1);
  }
  return flushPlannerStorage();
}

async function saveRecovery(row: RecoveryRow): Promise<boolean> {
  return enqueue(`${row.namespace}:recovery`, async () => {
    const db = await openDatabase();
    const transaction = db.transaction('recovery', 'readwrite');
    const done = complete(transaction);
    transaction.objectStore('recovery').put(row);
    await done;
    const check = db.transaction('recovery', 'readonly');
    const checked = complete(check);
    const result = await request(check.objectStore('recovery').get([row.namespace, row.id]) as IDBRequest<RecoveryRow | undefined>);
    await checked;
    if (canonical(result) !== canonical(row)) throw new Error('Recovery storage verification failed');
  });
}

export async function preservePlannerRecovery(plan: Plan, reason: string): Promise<boolean> {
  const current = latest.get(primaryNamespace);
  let owner: string | null = null;
  try { owner = current ? ownerOf(parseEnvelope(current, primaryNamespace)) : ownerOf((await readWorkspace(primaryNamespace, false)).value); }
  catch (error) { storageFailure(primaryNamespace, error); }
  const completePlan = await withLocalVersionBodies(plan, primaryNamespace);
  const row: RecoveryRow = { namespace: primaryNamespace, owner, id: crypto.randomUUID(), plan: structuredClone(completePlan), reason, createdAt: new Date().toISOString() };
  memoryRecovery.push(row);
  const saved = await saveRecovery(row);
  if (saved) memoryRecovery.splice(memoryRecovery.indexOf(row), 1);
  return saved;
}

export async function exportPlannerRecovery(expectedOwner?: string | null): Promise<unknown> {
  await queue;
  const namespace = primaryNamespace;
  let persisted: Envelope | null = null;
  let recoveries: RecoveryRow[] = [];
  let archives: LegacyRow[] = [];
  try {
    persisted = (await readWorkspace(namespace)).value;
    const db = await openDatabase();
    const transaction = db.transaction(['recovery', 'legacy'], 'readonly');
    const done = complete(transaction);
    [recoveries, archives] = await Promise.all([
      request(transaction.objectStore('recovery').index('namespace').getAll(namespace) as IDBRequest<RecoveryRow[]>),
      request(transaction.objectStore('legacy').index('namespace').getAll(namespace) as IDBRequest<LegacyRow[]>),
    ]);
    await done;
  } catch { /* IndexedDB 자체가 막혀도 메모리·기존 원본은 내보낸다. */ }
  let legacy: string | null = null;
  try { legacy = legacySource(namespace); } catch { /* 접근이 차단된 저장소는 건드리지 않는다. */ }
  const current = latest.has(namespace)
    ? preservePendingSnapshots(namespace, mergeLegacy(persisted ?? parseEnvelope(latest.get(namespace)!, namespace), parseEnvelope(latest.get(namespace)!, namespace)))
    : persisted;
  const owner = expectedOwner === undefined ? ownerOf(current) : expectedOwner;
  const source = legacy === null ? null : parseEnvelope(legacy, namespace);
  const ownedCurrent = current && ownerOf(current) === owner ? current : null;
  const completeCurrent = ownedCurrent ? {
    ...ownedCurrent,
    state: { ...ownedCurrent.state, plans: await Promise.all(ownedCurrent.state.plans.map((plan) => withLocalVersionBodies(plan as unknown as Plan, namespace))) },
  } : null;
  const ownedRecoveries = [...recoveries, ...memoryRecovery.filter((row) => row.namespace === namespace)].filter((row) => row.owner === owner);
  const completeRecoveries = await Promise.all(ownedRecoveries.map(async (row) => ({ ...row, plan: await withLocalVersionBodies(row.plan, namespace) })));
  return {
    format: 'uniboard-planner-recovery-v1', exportedAt: new Date().toISOString(), namespace,
    owner,
    current: completeCurrent,
    legacy: source && ownerOf(source) === owner ? legacy : null,
    archives: archives.filter((row) => row.owner === owner),
    recoveries: completeRecoveries,
  };
}
