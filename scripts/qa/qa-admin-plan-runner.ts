import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Plan } from '../../src/lib/types';

let planner: typeof import('../../src/lib/store');
let agent: typeof import('../../src/lib/agent/runner');
let generation: typeof import('../../src/lib/jobs/runner');
let credits: typeof import('../../src/lib/useCredits');
let engines: typeof import('../../src/lib/useEngine');
let workspace: typeof import('../../src/lib/admin-workspace');
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const requests: Array<{ url: string; headers: Headers; init?: RequestInit }> = [];
let chatReply: Record<string, unknown>;
let generationReply = '';

function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() { return rows.size; },
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value); },
    removeItem: (key) => { rows.delete(key); },
    key: (index) => [...rows.keys()][index] ?? null,
    clear: () => rows.clear(),
  };
}

before(async () => {
  const storage = memoryStorage();
  const browser = {
    location: new URL('https://planner.test/plans/plan-selected?adminUserId=owner-target&adminActorId=admin-actor'),
    sessionStorage: memoryStorage(),
    localStorage: storage,
  };
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  workspace = await import('../../src/lib/admin-workspace');
  planner = await import('../../src/lib/store');
  agent = await import('../../src/lib/agent/runner');
  generation = await import('../../src/lib/jobs/runner');
  credits = await import('../../src/lib/useCredits');
  engines = await import('../../src/lib/useEngine');
});

beforeEach(() => {
  requests.length = 0;
  planner.usePlannerStore.setState({ plans: [], agentBusy: null, activeRun: null, interrupted: null });
  credits.resetCredits();
  engines.resetEngine();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers), init });
    if (url === '/api/chat') return Response.json(chatReply);
    if (url === '/api/generate') return new Response(generationReply, { headers: { 'content-type': 'application/x-ndjson' } });
    if (url === '/api/credits') return Response.json({ remaining: 75, used: 25, limit: 100 });
    if (url === '/api/settings') return Response.json({ settings: { agentEngine: 'advanced', engines: { fs: 'advanced' } } });
    return Response.json({ ok: true });
  };
});

after(async () => {
  await credits.refreshCredits();
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function fixture(): Plan {
  const plan = planner.createEmptyPlan({
    title: '사용자 장비 대여', oneLiner: '', idea: '장비 대여', targetUser: '', purpose: '', platform: 'web',
  });
  plan.id = 'plan-selected';
  plan.features = [{
    id: 'FN-018', requirementId: 'REQ-001', name: '반납 확정', description: '기존 설명',
    priority: 'P0', status: '작성중', order: 0,
  }];
  plan.reviewNotes = [{
    id: 'note-selected', targetId: 'FN-018', kind: '모순', text: '비활성 장비 재노출', suggestion: '활성만 노출',
  }];
  const unrelated = { ...structuredClone(plan), id: 'plan-unrelated' };
  planner.usePlannerStore.setState({ plans: [plan, unrelated] });
  return plan;
}

function scoped(path: string) {
  const request = requests.find((entry) => entry.url === path);
  assert.ok(request, `expected ${path} to be requested`);
  assert.equal(request.headers.get('x-admin-user-id'), 'owner-target');
  assert.equal(request.headers.get('x-admin-plan-id'), 'plan-selected');
  return request;
}

test('AI agent sends owner scope and applies the verified fix only to the selected user plan', async () => {
  const plan = fixture();
  chatReply = {
    reply: '수정 후 해소 확인', changes: ['반납 확정 조건 수정'], credits: 1,
    patch: { features: [{ ...plan.features[0], description: 'ACTIVE 장비만 노출' }], reviewNotes: [] },
  };
  assert.equal(await agent.askAgent(plan.id, '이 문제를 수정', { reviewNoteIds: ['note-selected'] }), 'ok');
  const request = scoped('/api/chat');
  assert.equal(request.headers.get('content-type'), 'application/json');
  const body = JSON.parse(String(request.init?.body));
  assert.equal(body.plan.id, 'plan-selected');
  assert.deepEqual(body.reviewNoteIds, ['note-selected']);
  const plans = planner.usePlannerStore.getState().plans;
  assert.equal(plans.find((item) => item.id === plan.id)?.features[0].description, 'ACTIVE 장비만 노출');
  assert.deepEqual(plans.find((item) => item.id === plan.id)?.reviewNotes, []);
  assert.equal(plans.find((item) => item.id === 'plan-unrelated')?.features[0].description, '기존 설명');
  await credits.refreshCredits();
  scoped('/api/credits');
});

test('generation forwards owner scope and applies streamed documents to the selected plan', async () => {
  const plan = fixture();
  generationReply = [
    { type: 'start', artifact: 'prd' },
    { type: 'step', artifact: 'prd', patch: { prd: { ...plan.prd, overview: '사용자 플랜의 새 개요' } } },
    { type: 'done' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
  const notices: string[] = [];
  assert.equal(await generation.runGeneration(plan.id, ['prd'], {}, (message) => notices.push(message)), true);
  const request = scoped('/api/generate');
  assert.equal(JSON.parse(String(request.init?.body)).plan.id, plan.id);
  assert.equal(planner.usePlannerStore.getState().getPlan(plan.id)?.prd.overview, '사용자 플랜의 새 개요');
  assert.equal(planner.usePlannerStore.getState().getPlan(plan.id)?.generated.prd, true);
  assert.equal(planner.usePlannerStore.getState().getPlan('plan-unrelated')?.prd.overview, '');
  assert.ok(notices.length > 0);
  await credits.refreshCredits();
  scoped('/api/credits');
});

test('credit balance and engine settings are read with the selected owner scope', async () => {
  await credits.refreshCredits();
  await engines.refreshEngine();
  scoped('/api/credits');
  scoped('/api/settings');
  assert.equal(credits.creditSnapshot().remaining, 75);
  assert.equal(engines.engineSnapshot(), 'advanced');
  assert.equal(engines.engineSnapshotFor('fs'), 'advanced');
  await workspace.workspaceFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ agentEngine: 'basic' }) });
  const update = requests.find((entry) => entry.url === '/api/settings' && entry.init?.method === 'PATCH');
  assert.equal(update?.headers.get('x-admin-user-id'), 'owner-target');
});

test('editor APIs and the selected plan recovery endpoint receive scope headers', async () => {
  const paths = [
    '/api/place', '/api/skills?planId=plan-selected', '/api/design/stitch',
    '/api/design/stitch/models', '/api/design/stitch/run', '/api/design/uinai/run', '/api/plans/plan-selected',
  ];
  for (const path of paths) {
    await workspace.workspaceFetch(path);
    scoped(path);
  }
});

test('scope headers are not attached to auth, admin, or external requests', async () => {
  const paths = [
    '/api/auth/me', '/api/admin',
    'https://external.test/api/chat',
  ];
  for (const path of paths) {
    await workspace.workspaceFetch(path, { headers: { 'x-example': 'preserved' } });
    const request = requests.find((entry) => entry.url === path)!;
    assert.equal(request.headers.get('x-admin-user-id'), null);
    assert.equal(request.headers.get('x-admin-plan-id'), null);
    assert.equal(request.headers.get('x-example'), 'preserved');
  }
});

test('bulk and other-plan API requests are rejected before reaching the network', async () => {
  for (const path of ['/api/plans', '/api/plans/plan-unrelated']) {
    await assert.rejects(workspace.workspaceFetch(path), /선택한 사용자 플랜만/);
  }
  assert.equal(requests.length, 0);
});

test('Stitch project restore and removal use the support namespace for a colliding plan ID', async () => {
  const stitch = await import('../../src/lib/design/stitch-runner');
  const personalKey = 'unione-fastplaner:stitch-projects';
  const supportKey = workspace.workspaceStorageKey(personalKey);
  assert.notEqual(supportKey, personalKey);
  const personal = { 'plan-selected': { projectId: 'admin-personal-project' } };
  const supported = { 'plan-selected': { projectId: 'owner-support-project', screens: { 'PG-001': { at: 1 } } } };
  localStorage.setItem(personalKey, JSON.stringify(personal));
  localStorage.setItem(supportKey, JSON.stringify(supported));
  stitch.restore('plan-selected');
  assert.equal(stitch.snapshot('plan-selected').project?.projectId, 'owner-support-project');
  assert.equal(stitch.snapshot('plan-selected').progress['PG-001'].state, 'done');
  stitch.forgetProject('plan-selected');
  assert.deepEqual(JSON.parse(localStorage.getItem(supportKey)!), {});
  assert.deepEqual(JSON.parse(localStorage.getItem(personalKey)!), personal);
});
