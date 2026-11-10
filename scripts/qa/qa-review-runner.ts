import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Plan, ReviewNote } from '../../src/lib/types';

let planner: typeof import('../../src/lib/store');
let runner: typeof import('../../src/lib/agent/runner');
let credits: typeof import('../../src/lib/useCredits');
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const storageValues = new Map<string, string>();
const chatRequests: Record<string, unknown>[] = [];
let reply: (body: Record<string, unknown>) => Promise<Response>;

before(async () => {
  globalThis.localStorage = {
    get length() { return storageValues.size; },
    clear: () => storageValues.clear(),
    key: (index) => [...storageValues.keys()][index] ?? null,
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => { storageValues.set(key, value); },
    removeItem: (key) => { storageValues.delete(key); },
  };
  planner = await import('../../src/lib/store');
  runner = await import('../../src/lib/agent/runner');
  credits = await import('../../src/lib/useCredits');
});

beforeEach(() => {
  chatRequests.length = 0;
  credits.resetCredits();
  planner.usePlannerStore.setState({ plans: [], agentBusy: null });
  globalThis.fetch = async (input, init) => {
    if (input === '/api/credits') return Response.json({ remaining: 100, used: 0, limit: 100 });
    assert.equal(input, '/api/chat', 'the regression must not call a real service');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    chatRequests.push(body);
    return reply(body);
  };
});

after(async () => {
  await credits.refreshCredits();
  globalThis.fetch = originalFetch;
  if (originalStorage) globalThis.localStorage = originalStorage;
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function note(id: string, text = '활성 장비만 재노출하는지 확인'): ReviewNote {
  return { id, kind: '모순', targetId: 'FN-018', text, suggestion: 'ACTIVE 조건을 명시' };
}

function fixture(notes: ReviewNote[] = [note('n1')]): Plan {
  const plan = planner.createEmptyPlan({
    title: '장비 대여', oneLiner: '', idea: '', targetUser: '', purpose: '', platform: 'web',
  });
  plan.features = [{
    id: 'FN-018', requirementId: 'REQ-001', name: '소유자 반납 확정',
    description: '반납하면 장비가 검색에 재노출된다.', priority: 'P0', status: '작성중', order: 0,
  }];
  plan.reviewNotes = notes;
  planner.usePlannerStore.setState({ plans: [plan] });
  return plan;
}

function current(id: string): Plan {
  return planner.usePlannerStore.getState().plans.find((plan) => plan.id === id)!;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  reply = () => promise;
  return resolve;
}

test('a verified fix removes its warning; a stale second click makes no request or charge', async () => {
  const plan = fixture();
  let charged = 0;
  reply = async () => {
    charged += 1;
    return Response.json({
      reply: '수정 후 해소를 확인했습니다.', changes: ['FN-018 설명 수정'], credits: 1,
      patch: {
        features: plan.features.map((feature) => ({ ...feature, description: 'ACTIVE 장비만 재노출된다.' })),
        reviewNotes: [],
      },
    });
  };
  assert.equal(await runner.askAgent(plan.id, '고쳐 주세요', { reviewNoteIds: ['n1'] }), 'ok');
  assert.equal(current(plan.id).features[0].description, 'ACTIVE 장비만 재노출된다.');
  assert.deepEqual(current(plan.id).reviewNotes, []);
  assert.deepEqual(chatRequests[0].reviewNoteIds, ['n1']);
  const chatCount = current(plan.id).chat.length;
  const versionCount = current(plan.id).versions.length;
  credits.resetCredits();
  assert.equal(await runner.askAgent(plan.id, '고쳐 주세요', { reviewNoteIds: ['n1'] }), 'already-resolved');
  assert.equal(chatRequests.length, 1);
  assert.equal(charged, 1);
  assert.equal(current(plan.id).chat.length, chatCount);
  assert.equal(current(plan.id).versions.length, versionCount);
});

test('pending rechecks forward metadata and record the server credit count including zero', async () => {
  const plan = fixture([{ ...note('n1'), verification: 'pending' }]);
  reply = async () => Response.json({ reply: '해소 확인', patch: { reviewNotes: [] }, changes: [], credits: 0 });
  await runner.askAgent(plan.id, '현재 문서를 검증', { reviewNoteIds: ['n1'], recheckOnly: true });
  assert.equal(chatRequests[0].recheckOnly, true);
  assert.deepEqual(chatRequests[0].reviewNoteIds, ['n1']);
  assert.equal(current(plan.id).chat.at(-1)?.credits, 0);
});

test('retry preserves the failed request review IDs and verification-only mode', async () => {
  const plan = fixture([{ ...note('n1'), verification: 'pending' }]);
  reply = async () => { throw new Error('mock network failure'); };
  await runner.askAgent(plan.id, '재검증', { reviewNoteIds: ['n1'], recheckOnly: true });
  const stranded = runner.unansweredRequest(current(plan.id).chat)!;
  assert.equal(stranded.content, '재검증');
  assert.deepEqual(stranded.reviewNoteIds, ['n1']);
  assert.equal(stranded.recheckOnly, true);
  reply = async () => Response.json({ reply: '재검증 완료', credits: 0 });
  await runner.askAgent(plan.id, stranded.content, {
    resend: true, reviewNoteIds: stranded.reviewNoteIds, recheckOnly: stranded.recheckOnly,
  });
  assert.deepEqual(chatRequests[1].reviewNoteIds, ['n1']);
  assert.equal(chatRequests[1].recheckOnly, true);
  assert.equal(current(plan.id).chat.filter((message) => message.role === 'user').length, 1);
});

test('a concurrent feature edit discards the stale document patch and warning resolution', async () => {
  const plan = fixture();
  const resolve = deferredResponse();
  const request = runner.askAgent(plan.id, '고쳐 주세요', { reviewNoteIds: ['n1'] });
  planner.usePlannerStore.getState().updateFeature(plan.id, 'FN-018', { description: '사용자가 고친 최신 설명' });
  resolve(Response.json({ reply: '고쳤습니다', changes: ['설명 수정'], patch: { features: plan.features, reviewNotes: [] } }));
  await request;
  assert.equal(current(plan.id).features[0].description, '사용자가 고친 최신 설명');
  assert.equal(current(plan.id).reviewNotes?.length, 1);
  assert.match(current(plan.id).chat.at(-1)!.content, /최신 문서가 변경/);
  assert.deepEqual(current(plan.id).chat.at(-1)?.changes, []);
  assert.equal(current(plan.id).versions.length, 0);
});

test('a concurrent brief edit also prevents applying stale review outcomes', async () => {
  const plan = fixture();
  const resolve = deferredResponse();
  const request = runner.askAgent(plan.id, '재검증', { reviewNoteIds: ['n1'], recheckOnly: true });
  planner.usePlannerStore.getState().renamePlan(plan.id, '수정한 서비스명');
  resolve(Response.json({ reply: '해소 확인', patch: { reviewNotes: [] } }));
  await request;
  assert.equal(current(plan.id).brief.title, '수정한 서비스명');
  assert.equal(current(plan.id).reviewNotes?.length, 1);
  assert.match(current(plan.id).chat.at(-1)!.content, /최신 문서가 변경/);
});

test('review merge preserves concurrent dismissal, new findings, and edited findings', async () => {
  const originals = [note('n1'), note('n2'), note('n3'), note('n4')];
  const plan = fixture(originals);
  const resolve = deferredResponse();
  const request = runner.askAgent(plan.id, '재검증', { reviewNoteIds: ['n1'], recheckOnly: true });
  const edited = { ...originals[2], text: '사용자가 변경한 지적' };
  const added = note('n5', '새로 생긴 지적');
  planner.usePlannerStore.getState().applyDocuments(plan.id, {
    reviewNotes: [originals[0], edited, originals[3], added],
  });
  resolve(Response.json({ reply: '해소 확인', patch: { reviewNotes: originals.slice(1) }, credits: 0 }));
  await request;
  assert.deepEqual(current(plan.id).reviewNotes, [edited, originals[3], added]);
});

test('a locally redundant review patch produces no changes badge or version', async () => {
  const plan = fixture();
  const resolve = deferredResponse();
  const request = runner.askAgent(plan.id, '재검증', { reviewNoteIds: ['n1'], recheckOnly: true });
  planner.usePlannerStore.getState().applyDocuments(plan.id, { reviewNotes: [] });
  resolve(Response.json({ reply: '해소 확인', patch: { reviewNotes: [] }, changes: ['지적 해소'] }));
  await request;
  assert.deepEqual(current(plan.id).chat.at(-1)?.changes, []);
  assert.equal(current(plan.id).versions.length, 0);
});
