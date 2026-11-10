/** 실행: npx tsx --test scripts/qa/qa-review-fix.ts — 네트워크·AI 키 없이 실제 적용 경로를 검증한다. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeAgentResponse, type AgentResult } from '../../src/lib/ai/agent-response';
import { changedDocumentPatch } from '../../src/lib/ai/document-patch';
import { issueFixPrompt, issuesFixPrompt, type FixableIssue } from '../../src/lib/ai/fix-prompt';
import { buildReviewPrompt } from '../../src/lib/ai/prompts';
import { buildNoteRecheckPrompt, revalidateNotes, type VerifyNotes } from '../../src/lib/ai/revalidate-notes';
import { emptyDocuments, type Plan, type Specification } from '../../src/lib/types';
import { validatePlan } from '../../src/lib/validate';

const NOTE_ID = 'note-return-visibility';
const ORIGINAL = '반납 확정 시 해당 장비가 다시 검색에 노출된다.';
const FIXED = '반납 확정은 대여 건만 COMPLETED로 전환한다. ACTIVE 장비만 검색에 재노출되며 INACTIVE 장비는 판매 재개 전까지 미노출이다.';

function fixture(): Plan {
  return {
    ...emptyDocuments(),
    id: 'plan-review-fix',
    brief: {
      title: '장비 대여', oneLiner: '판매 중지 상태를 유지하는 대여 서비스',
      idea: '장비 소유자가 대여·반납을 관리한다.', targetUser: '소유자와 대여자',
      purpose: '대여와 반납 관리', platform: 'web',
    },
    createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    generated: { prd: false, fs: true, ia: false, flow: false, wireframe: false },
    chat: [], comments: [], versions: [],
    requirements: [{
      id: 'REQ-001', title: '대여 운영', description: '요구사항 설명 전체',
      category: '대여', priority: 'P0', order: 0,
    }],
    features: [
      {
        id: 'FN-007', requirementId: 'REQ-001', name: '판매 중지·재개',
        description: '판매 중지 시 INACTIVE로 바꾸고 진행 중 대여는 반납 확인까지 유지한다.',
        priority: 'P0', status: '작성중', order: 0,
      },
      {
        id: 'FN-018', requirementId: 'REQ-001', name: '소유자 반납 확정',
        description: ORIGINAL, priority: 'P0', status: '작성중', order: 1,
      },
    ],
    specifications: [{
      id: 'SP-038', featureId: 'FN-018', title: '활성 장비 한정 재노출',
      actor: '소유자 본인', precondition: '대여 상태가 RETURN_PENDING일 때만 가능',
      mainFlow: ['장비 상태를 조회하여 ACTIVE/INACTIVE 노출 여부를 판정한다.'],
      exceptions: ['INACTIVE이면 완료 후에도 검색 노출을 차단한다.'],
      acceptanceCriteria: ['비활성 장비 반납 확정 후 검색 결과 0건을 확인한다.'],
      businessRules: ['반납 확정은 장비 상태를 변경하지 않는다.'],
      inputs: [{ name: '반납 확인 ID', required: true, rule: '소유한 대여 건의 ID만 허용' }],
      stateChanges: [{ entity: '대여 건', from: 'RETURN_PENDING', to: 'COMPLETED', trigger: '소유자가 반납 확정 버튼 클릭' }],
      postconditions: ['INACTIVE 장비는 소유자의 판매 재개 전까지 미노출 상태 유지'],
      roleDifferences: ['대여자는 소유자 반납 확정을 실행할 수 없다.'],
      pageIds: [], priority: 'P0', status: '작성중', order: 0,
    }],
    reviewNotes: [
      { id: NOTE_ID, kind: '모순', targetId: 'FN-018', text: '판매 중지 장비도 반납 후 재노출되는 모순', suggestion: 'ACTIVE인 경우만 노출하도록 명시' },
      { id: 'note-unrelated', kind: '모호', targetId: 'FN-007', text: '판매 재개 권한이 모호함', suggestion: '권한을 명시' },
    ],
  };
}

function edit(description = FIXED): AgentResult {
  return {
    reply: 'FN-018을 수정했습니다.', changes: ['FN-018 설명 수정'],
    patch: { artifact: 'fs', payload: JSON.stringify({ features: [{ id: 'FN-018', description }] }) },
  };
}

function verdict(status: 'resolved' | 'unresolved', reason = 'FN-018과 SP-038에서 ACTIVE 조건을 확인함') {
  return { results: [{ noteId: NOTE_ID, status, reason, suggestion: status === 'resolved' ? '' : '반납 후 미노출 조건을 더 명확히 명시' }] };
}

test('실제 문서 수정 후 재검증이 해결을 확인하면 대상 경고만 사라진다', async () => {
  const plan = fixture();
  const before = structuredClone(plan);
  let calls = 0;
  const response = await finalizeAgentResponse(plan, edit(), {
    reviewNoteIds: [NOTE_ID],
    verify: async (prompt) => {
      calls += 1;
      assert.ok(prompt.includes(FIXED), '검증은 수정된 FN-018 본문을 읽어야 한다.');
      assert.ok(!prompt.includes(ORIGINAL), '과거 FN 설명을 최신 문서로 전달하지 않는다.');
      return verdict('resolved');
    },
  });
  const applied = { ...plan, ...response.patch };
  assert.equal(calls, 1);
  assert.equal(applied.features.find((f) => f.id === 'FN-018')?.description, FIXED);
  assert.deepEqual(applied.reviewNotes, [plan.reviewNotes![1]]);
  assert.equal(applied.reviewNotes![0], plan.reviewNotes![1], '무관한 지적은 객체도 유지한다.');
  assert.ok(!validatePlan(applied).some((issue) => issue.noteId === NOTE_ID));
  assert.ok(validatePlan(applied).some((issue) => issue.noteId === 'note-unrelated'));
  assert.deepEqual(response.changes, ['FN-018 설명 수정']);
  assert.deepEqual(response.verification, { resolved: 1, unresolved: 0, pending: 0 });
  assert.deepEqual(plan, before, '입력 플랜 자체를 변경하지 않는다.');
});

test('미해결 재검증은 지적 ID를 유지하며 최신 이유와 제안으로 갱신한다', async () => {
  const plan = fixture();
  const reason = '현재 FN-018에는 검색 조건만 있고 신규 요청 조건이 여전히 모호하다.';
  const response = await finalizeAgentResponse(plan, edit(), {
    reviewNoteIds: [NOTE_ID], verify: async () => verdict('unresolved', reason),
  });
  const applied = { ...plan, ...response.patch };
  const note = applied.reviewNotes!.find((n) => n.id === NOTE_ID)!;
  assert.equal(note.id, NOTE_ID);
  assert.equal(note.targetId, 'FN-018');
  assert.equal(note.text, reason);
  assert.equal(note.suggestion, '반납 후 미노출 조건을 더 명확히 명시');
  assert.equal(note.verification, 'unresolved');
  assert.deepEqual(response.verification, { resolved: 0, unresolved: 1, pending: 0 });
  const issue = validatePlan(applied).find((i) => i.noteId === NOTE_ID)!;
  assert.ok(issue.detail.includes(reason));
  assert.equal(issue.recheckOnly, false);
  assert.deepEqual(applied.reviewNotes![1], plan.reviewNotes![1]);
});

const failedVerifications: [string, VerifyNotes][] = [
  ['예외', async () => { throw new Error('검증 공급자 연결 실패'); }],
  ['응답 누락', async () => undefined],
  ['대상 판정 누락', async () => ({ results: [{ noteId: 'another-note', status: 'resolved', reason: '다른 지적', suggestion: '' }] })],
  ['중복 판정', async () => ({ results: [...verdict('resolved').results, ...verdict('unresolved').results] })],
  ['해결 근거 누락', async () => verdict('resolved', '   ')],
];
for (const [name, verify] of failedVerifications) {
  test(`${name}: 문서 수정은 유지하고 경고는 재검증 필요로 남긴다`, async () => {
    const plan = fixture();
    const response = await finalizeAgentResponse(plan, edit(), { reviewNoteIds: [NOTE_ID], verify });
    const applied = { ...plan, ...response.patch };
    assert.equal(applied.features.find((f) => f.id === 'FN-018')?.description, FIXED);
    const note = applied.reviewNotes!.find((n) => n.id === NOTE_ID)!;
    assert.equal(note.verification, 'pending');
    assert.equal(note.text, plan.reviewNotes![0].text);
    assert.equal(note.suggestion, plan.reviewNotes![0].suggestion);
    assert.deepEqual(applied.reviewNotes![1], plan.reviewNotes![1]);
    const issue = validatePlan(applied).find((i) => i.noteId === NOTE_ID)!;
    assert.equal(issue.recheckOnly, true);
    assert.ok(issue.detail.includes('재검증 필요'));
    assert.ok(response.reply.includes('재검증 필요 1건'));
    assert.deepEqual(response.verification, { resolved: 0, unresolved: 0, pending: 1 });
  });
}

test('동일한 본문을 다시 반환해도 오래된 지적만 재검증하여 해결할 수 있다', async () => {
  const plan = fixture();
  const response = await finalizeAgentResponse(plan, edit(ORIGINAL), {
    reviewNoteIds: [NOTE_ID], verify: async () => verdict('resolved'),
  });
  assert.deepEqual(response.changes, [], '본문을 수정했다고 표시하지 않는다.');
  assert.deepEqual(Object.keys(response.patch ?? {}), ['reviewNotes']);
  assert.deepEqual(response.patch?.reviewNotes, [plan.reviewNotes![1]]);
  assert.ok(response.reply.includes('본문을 다시 변경하지 않았습니다'));
});

test('이미 해결된 지적의 요청은 검증과 문서 변경을 다시 수행하지 않는다', async () => {
  const plan = fixture();
  plan.reviewNotes = [plan.reviewNotes![1]];
  let calls = 0;
  // API는 대상 지적이 사라졌으면 수정 모델을 부르지 않고 undefined를 전달한다.
  const response = await finalizeAgentResponse(plan, undefined, {
    reviewNoteIds: [NOTE_ID], verify: async () => { calls += 1; return verdict('resolved'); },
  });
  assert.equal(calls, 0);
  assert.equal(response.patch, undefined);
  assert.deepEqual(response.changes, []);
});

test('revalidateNotes는 요청한 지적만 판정하고 무관한 반환 ID를 무시한다', async () => {
  const plan = fixture();
  const response = await revalidateNotes(plan, [plan.reviewNotes![0]], async () => ({
    results: [...verdict('resolved').results, { noteId: 'note-unrelated', status: 'resolved', reason: '요청하지 않은 지적', suggestion: '' }],
  }));
  assert.deepEqual(response.reviewNotes, [plan.reviewNotes![1]]);
  assert.equal(response.resolved, 1);
  assert.equal(response.unresolved, 0);
  assert.equal(response.pending, 0);
});

test('전체 검토와 지적 재검증 모두 상세명세의 모든 정책·흐름·입력·상태 본문을 받는다', () => {
  const plan = fixture();
  const spec = plan.specifications[0];
  const values = [
    plan.requirements[0].description, plan.features[0].description, plan.features[1].description,
    spec.id, spec.featureId, spec.title, spec.actor, spec.precondition,
    ...spec.mainFlow, ...spec.exceptions, ...spec.acceptanceCriteria, ...spec.businessRules!,
    spec.inputs![0].name, spec.inputs![0].rule, spec.stateChanges![0].entity,
    spec.stateChanges![0].from, spec.stateChanges![0].to, spec.stateChanges![0].trigger,
    ...spec.postconditions!, ...spec.roleDifferences!,
  ];
  for (const prompt of [buildReviewPrompt(plan), buildNoteRecheckPrompt(plan, [plan.reviewNotes![0]])]) {
    for (const value of values) assert.ok(prompt.includes(value), `검토에서 누락된 본문: ${value}`);
    assert.ok(prompt.includes('"required": true'), '입력 필수 여부도 전달한다.');
  }
});

test('연결이 끊긴 기능과 상세명세도 전체 검토 및 지적 재검증에 포함한다', () => {
  const plan = fixture();
  plan.features.push({ ...plan.features[0], id: 'FN-099', requirementId: 'REQ-MISSING', description: '연결이 끊긴 기능 본문' });
  plan.specifications.push({ ...plan.specifications[0], id: 'SP-099', featureId: 'FN-MISSING', precondition: '연결이 끊긴 명세의 사전 조건' });
  for (const prompt of [buildReviewPrompt(plan), buildNoteRecheckPrompt(plan, [plan.reviewNotes![0]])]) {
    for (const value of ['FN-099', 'REQ-MISSING', '연결이 끊긴 기능 본문', 'SP-099', 'FN-MISSING', '연결이 끊긴 명세의 사전 조건']) {
      assert.ok(prompt.includes(value), `고아 항목 누락: ${value}`);
    }
  }
});

test('구버전 상세명세에서 선택 필드와 배열이 누락되어도 두 검토 프롬프트를 만들 수 있다', () => {
  const plan = fixture();
  plan.specifications = [{ id: 'SP-038', featureId: 'FN-018', title: '이전 버전 명세' } as Specification];
  for (const prompt of [buildReviewPrompt(plan), buildNoteRecheckPrompt(plan, [plan.reviewNotes![0]])]) {
    assert.ok(prompt.includes('이전 버전 명세'));
    for (const key of ['mainFlow', 'exceptions', 'acceptanceCriteria', 'businessRules', 'inputs', 'stateChanges', 'postconditions', 'roleDifferences']) {
      assert.ok(prompt.includes(`"${key}": []`), `구버전 필드 기본값 누락: ${key}`);
    }
  }
});

for (const [name, payload] of [
  ['잘못된 JSON', '{broken-json'],
  ['기존 문서를 삭제하는 초안', JSON.stringify({ requirements: [], features: [], specifications: [] })],
] as const) {
  test(`${name}은 적용 성공으로 표시하지 않고 원래 문서로 재검증한다`, async () => {
    const plan = fixture();
    let calls = 0;
    const response = await finalizeAgentResponse(plan, {
      reply: '모두 수정했습니다.', changes: ['수정 완료'], patch: { artifact: 'fs', payload },
    }, {
      reviewNoteIds: [NOTE_ID],
      verify: async (prompt) => {
        calls += 1;
        assert.ok(prompt.includes(ORIGINAL));
        assert.ok(!prompt.includes(FIXED));
        return verdict('unresolved', 'FN-018 원래 본문에 조건이 여전히 없다.');
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(response.changes, []);
    assert.ok(!response.reply.includes('모두 수정했습니다.'));
    assert.deepEqual(Object.keys(response.patch ?? {}), ['reviewNotes']);
    const applied = { ...plan, ...response.patch };
    assert.deepEqual(applied.features, plan.features);
    assert.deepEqual(applied.requirements, plan.requirements);
    assert.deepEqual(applied.specifications, plan.specifications);
    assert.equal(applied.reviewNotes![0].verification, 'unresolved');
  });
}

test('changedDocumentPatch는 키 순서·undefined만 다른 값과 동일 배열을 실제 수정으로 세지 않는다', () => {
  const plan = fixture();
  assert.equal(changedDocumentPatch(plan, {}), undefined);
  assert.equal(changedDocumentPatch(plan, {
    features: plan.features.map(({ description, ...feature }) => ({ description, ...feature })),
    specifications: structuredClone(plan.specifications),
    reviewNotes: plan.reviewNotes!.map((n) => ({ ...n, verificationReason: undefined })),
  }), undefined);
  const features = plan.features.map((f) => f.id === 'FN-018' ? { ...f, description: FIXED } : f);
  const patch = changedDocumentPatch(plan, { features, requirements: structuredClone(plan.requirements) });
  assert.deepEqual(Object.keys(patch ?? {}), ['features']);
  assert.equal(patch!.features, features);
});

test('재검증 대기 지적의 단일 프롬프트는 수정 없이 현재 문서 확인만 요청한다', () => {
  const issue: FixableIssue = {
    id: 'pending', artifact: 'fs', title: '검증 대기 경고', detail: '이미 수정한 경고의 검증이 실패함',
    targets: ['FN-018 소유자 반납 확정'], recheckOnly: true,
  };
  const prompt = issueFixPrompt(issue);
  assert.ok(prompt.includes('현재 문서로 재검증'));
  assert.ok(prompt.includes('문서 본문을 수정하지 말고'));
  assert.ok(!prompt.includes('아래 문제를 고쳐'));
  assert.ok(prompt.includes('FN-018'));
});

test('수정·재검증이 섞인 일괄 요청은 재검증 대기 항목을 수정 프롬프트에서 제외한다', () => {
  const pending: FixableIssue = {
    id: 'pending', artifact: 'fs', title: '대기 전용 경고', detail: '이전 수정 검증만 필요',
    targets: ['FN-PENDING 재검증 대상'], recheckOnly: true,
  };
  const editable: FixableIssue = {
    id: 'editable', artifact: 'fs', title: '새로 수정할 경고', detail: '새로운 수정 필요',
    targets: ['FN-EDIT 수정 대상'],
  };
  const prompt = issuesFixPrompt('fs', [pending, editable]);
  assert.ok(prompt.includes('새로 수정할 경고'));
  assert.ok(prompt.includes('FN-EDIT'));
  assert.ok(!prompt.includes('대기 전용 경고'));
  assert.ok(!prompt.includes('FN-PENDING'));
  assert.ok(!prompt.includes('이전 수정 검증만 필요'));
});

test('모든 일괄 항목이 검증 대기이면 문서 수정 없이 재검증만 요청한다', () => {
  const pending = (id: string): FixableIssue => ({
    id, artifact: 'fs', title: `검증 대기 ${id}`, detail: `대기 사유 ${id}`,
    targets: [`FN-${id}`], recheckOnly: true,
  });
  const prompt = issuesFixPrompt('fs', [pending('018'), pending('007')]);
  assert.ok(prompt.includes('현재 문서로 재검증'));
  assert.ok(prompt.includes('문서 본문을 수정하지 말고'));
  assert.ok(prompt.includes('FN-018'));
  assert.ok(prompt.includes('FN-007'));
  assert.ok(!prompt.includes('아래 문제들을 고쳐'));
});
