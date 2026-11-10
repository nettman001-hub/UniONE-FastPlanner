import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { indexedDB, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import type { Plan } from '../../src/lib/types';

let planner: typeof import('../../src/lib/store');
let runner: typeof import('../../src/lib/agent/runner');
let credits: typeof import('../../src/lib/useCredits');
let storage: typeof import('../../src/lib/planner-storage');
const originals = new Map(['localStorage', 'indexedDB', 'IDBKeyRange'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch;
const originalClone = globalThis.structuredClone;
const rows = new Map<string, string>();
let requests: Array<{ plan: Plan }> = [];
let reply: () => Promise<Response>;

before(async () => {
  const memory: Storage = {
    get length() { return rows.size; }, clear: () => rows.clear(),
    key: (index) => [...rows.keys()][index] ?? null,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value); },
    removeItem: (key) => { rows.delete(key); },
  };
  for (const [key, value] of Object.entries({ localStorage: memory, indexedDB, IDBKeyRange })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  storage = await import('../../src/lib/planner-storage');
  planner = await import('../../src/lib/store');
  runner = await import('../../src/lib/agent/runner');
  credits = await import('../../src/lib/useCredits');
  await planner.usePlannerStore.persist.rehydrate();
});

beforeEach(async () => {
  await storage.flushPlannerStorage();
  requests = [];
  credits.resetCredits();
  planner.usePlannerStore.setState({ plans: [], agentBusy: null });
  reply = async () => Response.json({ reply: '응답 완료', changes: [], credits: 0 });
  globalThis.fetch = async (url, init) => {
    if (url === '/api/credits') return Response.json({ remaining: 100, used: 0, limit: 100 });
    assert.equal(url, '/api/chat', 'test must not call a real service');
    requests.push(JSON.parse(String(init?.body)) as { plan: Plan });
    return reply();
  };
});

after(async () => {
  await storage.flushPlannerStorage();
  await credits.refreshCredits();
  globalThis.fetch = originalFetch;
  globalThis.structuredClone = originalClone;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function fixture(): Promise<Plan> {
  const plan = planner.createEmptyPlan({ title: '복구 검증', oneLiner: '', idea: '장비 대여', targetUser: '', purpose: '', platform: 'web' });
  plan.features = [{ id: 'FN-018', requirementId: 'REQ-001', name: '반납 확정', description: '기존 설명', priority: 'P0', status: '작성중', order: 0 }];
  planner.usePlannerStore.setState({ plans: [plan] });
  await storage.flushPlannerStorage();
  return plan;
}

function current(id: string): Plan { return planner.usePlannerStore.getState().getPlan(id)!; }
function unlocked(id: string) {
  assert.equal(planner.usePlannerStore.getState().agentBusy, null);
  assert.equal(runner.canCancel(id), false);
}

test('an actual IndexedDB quota failure retains the response in memory and releases busy', async () => {
  const plan = await fixture();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('disk full', 'QuotaExceededError'); };
  try {
    reply = async () => Response.json({ reply: '문서 반영', changes: ['설명 수정'], patch: { features: [{ ...plan.features[0], description: '수정한 설명' }] }, credits: 1 });
    assert.equal(await runner.askAgent(plan.id, '수정'), 'ok');
    assert.equal(await storage.flushPlannerStorage(), false);
    assert.equal(storage.plannerStorageSnapshot().state, 'error');
    assert.match(storage.plannerStorageSnapshot().error!, /QuotaExceededError/);
    assert.equal(current(plan.id).features[0].description, '수정한 설명');
    assert.equal(current(plan.id).chat.at(-1)?.content, '문서 반영');
    unlocked(plan.id);
  } finally {
    IDBObjectStore.prototype.put = put;
    assert.equal(await storage.retryPlannerStorage(), true);
  }
});

test('localStorage quota does not block an AI response when IndexedDB works', async () => {
  const plan = await fixture();
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new DOMException('localStorage is full', 'QuotaExceededError'); };
  try {
    reply = async () => Response.json({ reply: '정상 응답', changes: ['설명 수정'], credits: 1,
      patch: { features: [{ ...plan.features[0], description: 'IDB에 보관할 설명' }] } });
    assert.equal(await runner.askAgent(plan.id, '수정'), 'ok');
    assert.equal(await storage.flushPlannerStorage(), true);
    assert.equal(current(plan.id).features[0].description, 'IDB에 보관할 설명');
    unlocked(plan.id);
  } finally { localStorage.setItem = setItem; }
});

test('structuredClone setup failure clears the handle and never starts a request', async () => {
  const plan = await fixture();
  globalThis.structuredClone = () => { throw new DOMException('cannot clone', 'DataCloneError'); };
  try {
    assert.equal(await runner.askAgent(plan.id, '수정'), 'failed');
    assert.equal(requests.length, 0);
    unlocked(plan.id);
    assert.match(current(plan.id).chat.at(-1)!.content, /요청을 준비하지 못/);
  } finally { globalThis.structuredClone = originalClone; }
});

test('a synchronous appendChat quota exception is contained and releases busy', async () => {
  const plan = await fixture();
  const append = planner.usePlannerStore.getState().appendChat;
  planner.usePlannerStore.setState({ appendChat: (id, message) => {
    if (message.role === 'user') throw new DOMException('quota', 'QuotaExceededError');
    append(id, message);
  } });
  try {
    assert.equal(await runner.askAgent(plan.id, '수정'), 'failed');
    unlocked(plan.id);
    assert.equal(requests.length, 0);
    assert.match(current(plan.id).chat.at(-1)!.content, /저장 공간/);
  } finally { planner.usePlannerStore.setState({ appendChat: append }); }
});

test('a busy setter failure after setting state is always unwound', async () => {
  const plan = await fixture();
  const setBusy = planner.usePlannerStore.getState().setAgentBusy;
  planner.usePlannerStore.setState({ setAgentBusy: (id) => {
    setBusy(id);
    if (id) throw new Error('setup persistence failure');
  } });
  try {
    assert.equal(await runner.askAgent(plan.id, '수정'), 'failed');
    unlocked(plan.id);
    assert.equal(requests.length, 0);
  } finally { planner.usePlannerStore.setState({ setAgentBusy: setBusy }); }
});

test('hung fetch that ignores abort finishes at the injected deadline', { timeout: 2_000 }, async () => {
  const plan = await fixture();
  reply = () => new Promise(() => {});
  assert.equal(await runner.createAgentExecutor({ timeoutMs: 20 })(plan.id, '수정'), 'failed');
  unlocked(plan.id);
  const message = current(plan.id).chat.at(-1)!;
  assert.match(message.content, /제한 시간/);
  assert.doesNotMatch(message.content, /차감되지/);
  assert.equal(message.cancelled, undefined);
});

test('hung response.json is bounded by the same request deadline', { timeout: 2_000 }, async () => {
  const plan = await fixture();
  reply = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response;
  assert.equal(await runner.createAgentExecutor({ timeoutMs: 20 })(plan.id, '수정'), 'failed');
  unlocked(plan.id);
  assert.match(current(plan.id).chat.at(-1)!.content, /제한 시간/);
});

test('manual stop resolves a hung request and a late successful patch is never applied', { timeout: 2_000 }, async () => {
  const plan = await fixture();
  let resolve!: (response: Response) => void;
  reply = () => new Promise((done) => { resolve = done; });
  const request = runner.createAgentExecutor({ timeoutMs: 1_000 })(plan.id, '수정');
  assert.equal(runner.cancelAgent(plan.id), true);
  assert.equal(await request, 'cancelled');
  unlocked(plan.id);
  resolve(Response.json({ reply: '늦은 수정', changes: ['수정'], patch: { features: [{ ...plan.features[0], description: '반영되면 안 됨' }] } }));
  await new Promise((done) => setImmediate(done));
  assert.equal(current(plan.id).features[0].description, '기존 설명');
  assert.equal(current(plan.id).chat.at(-1)?.cancelled, true);
  assert.doesNotMatch(current(plan.id).chat.at(-1)!.content, /차감되지/);
  reply = async () => Response.json({ reply: '재요청 완료', credits: 0 });
  assert.equal(await runner.askAgent(plan.id, '다시 요청'), 'ok');
  unlocked(plan.id);
});

test('manual stop clears an orphan busy flag without an AbortController', async () => {
  const plan = await fixture();
  planner.usePlannerStore.getState().setAgentBusy(plan.id);
  assert.equal(runner.canCancel(plan.id), true);
  assert.equal(runner.cancelAgent(plan.id), true);
  unlocked(plan.id);
  assert.equal(await runner.askAgent(plan.id, '다시 요청'), 'ok');
});

test('a delayed response cannot edit or append chat to another owner with the same plan ID and documents', async () => {
  const plan = await fixture();
  planner.usePlannerStore.getState().setPlans([plan], 'owner-a');
  let resolve!: (response: Response) => void;
  reply = () => new Promise((done) => { resolve = done; });
  const request = runner.askAgent(plan.id, 'A 계정 수정');
  const other = { ...structuredClone(plan), chat: [] };
  planner.usePlannerStore.getState().setPlans([other], 'owner-b');
  assert.equal(planner.usePlannerStore.getState().agentBusy, plan.id, 'the previous request busy flag was inherited');
  resolve(Response.json({ reply: 'A의 늦은 수정', changes: ['설명 수정'], credits: 1,
    patch: { features: [{ ...plan.features[0], description: 'A의 수정안' }] } }));
  assert.equal(await request, 'cancelled');
  assert.equal(current(plan.id).features[0].description, '기존 설명');
  assert.deepEqual(current(plan.id).chat, []);
  assert.equal(current(plan.id).versions.length, 0);
  unlocked(plan.id);
});

test('a late request failure after an owner change cannot append an error to the new owner', async () => {
  const plan = await fixture();
  planner.usePlannerStore.getState().setPlans([plan], 'owner-a');
  let reject!: (error: Error) => void;
  reply = () => new Promise((_resolve, fail) => { reject = fail; });
  const request = runner.askAgent(plan.id, 'A 계정 수정');
  planner.usePlannerStore.getState().setPlans([{ ...structuredClone(plan), chat: [] }], 'owner-b');
  planner.usePlannerStore.getState().setAgentBusy(null);
  reject(new Error('late network failure'));
  assert.equal(await request, 'cancelled');
  assert.deepEqual(current(plan.id).chat, []);
  unlocked(plan.id);
});

test('the new owner can start the same plan while the old request unwinds without clearing the new busy flag', async () => {
  const plan = await fixture();
  planner.usePlannerStore.getState().setPlans([plan], 'owner-a');
  let resolveA!: (response: Response) => void;
  reply = () => new Promise((done) => { resolveA = done; });
  const requestA = runner.askAgent(plan.id, 'A 계정 요청');
  planner.usePlannerStore.getState().setPlans([{ ...structuredClone(plan), chat: [] }], 'owner-b');
  planner.usePlannerStore.getState().setAgentBusy(null);
  let resolveB!: (response: Response) => void;
  reply = () => new Promise((done) => { resolveB = done; });
  const requestB = runner.askAgent(plan.id, 'B 계정 요청');
  assert.equal(await requestA, 'cancelled');
  assert.equal(planner.usePlannerStore.getState().agentBusy, plan.id);
  assert.equal(runner.canCancel(plan.id), true);
  resolveA(Response.json({ reply: 'A의 늦은 답변', changes: ['A 수정'], patch: { features: [] } }));
  await new Promise((done) => setImmediate(done));
  assert.equal(planner.usePlannerStore.getState().agentBusy, plan.id);
  assert.deepEqual(current(plan.id).chat.map((message) => message.content), ['B 계정 요청']);
  resolveB(Response.json({ reply: 'B 계정 답변', credits: 0 }));
  assert.equal(await requestB, 'ok');
  assert.deepEqual(current(plan.id).chat.map((message) => message.content), ['B 계정 요청', 'B 계정 답변']);
  unlocked(plan.id);
});

for (const status of [413, 500]) {
  test(`non-JSON HTTP ${status} reports a server error and clears busy`, async () => {
    const plan = await fixture();
    reply = async () => new Response('<html>proxy error</html>', { status });
    assert.equal(await runner.askAgent(plan.id, '수정'), 'failed');
    unlocked(plan.id);
    const text = current(plan.id).chat.at(-1)!.content;
    assert.match(text, status === 413 ? /허용 크기/ : /HTTP 500/);
    assert.doesNotMatch(text, /연결이 끊|차감되지/);
  });
}

test('AI transport excludes version snapshots, chat history, and screen payloads', async () => {
  const plan = await fixture();
  plan.versions = [{ id: 'large-version', label: '큰 이력', createdAt: plan.createdAt, snapshot: { ...plan, huge: 'x'.repeat(100_000) } } as unknown as Plan['versions'][number]];
  plan.chat = [{ id: 'old-chat', role: 'assistant', createdAt: plan.createdAt, content: 'x'.repeat(100_000) }];
  plan.uinAiScreens = [{
    id: 'large-screen', pageId: 'PG-001', wireframeId: null, name: '큰 화면', route: '/',
    device: 'desktop', engine: 'basic', emphasis: 'strict', skill: 'none', generatedAt: plan.createdAt,
    entryFile: 'index.html', files: [{ path: 'index.html', language: 'html', content: 'x'.repeat(100_000) }],
    summary: '', implementationNotes: [], sourceSignature: 'fixture',
  }];
  planner.usePlannerStore.setState({ plans: [plan] });
  assert.equal(await runner.askAgent(plan.id, '작은 요청'), 'ok');
  assert.deepEqual(requests[0].plan.versions, []);
  assert.deepEqual(requests[0].plan.chat, []);
  assert.deepEqual(requests[0].plan.uinAiScreens, []);
  assert.ok(JSON.stringify(requests[0]).length < 10_000);
  assert.equal(current(plan.id).versions.length, 1);
});
