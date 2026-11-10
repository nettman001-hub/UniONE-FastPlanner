/** 실행: npx tsx --test scripts/qa/qa-admin-plan-access.ts — 외부 서비스 없이 관리자 플랜 접근 정책 검증. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePlanActor } from '../../src/lib/auth/plan-actor-policy';
import type { PublicUser } from '../../src/lib/db/users';

const ADMIN: PublicUser = { id: 'admin-actor', email: 'admin@example.test', name: '관리자' };
const ALICE: PublicUser = { id: 'owner-alice', email: 'alice@example.test', name: '앨리스' };
const BOB: PublicUser = { id: 'owner-bob', email: 'bob@example.test', name: '밥' };
const SHARED_PLAN_ID = 'same-plan-id';

function request(headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/plans/same-plan-id', { headers });
}

function scope(ownerId = ALICE.id, planId = SHARED_PLAN_ID) {
  return { 'x-admin-user-id': ownerId, 'x-admin-plan-id': planId };
}

/** 실제 저장 구조처럼 플랜 ID가 아닌 (소유자 ID, 플랜 ID) 쌍으로 찾는다. */
function fixture() {
  const users = new Map([ADMIN, ALICE, BOB].map((user) => [user.id, user]));
  const plans = new Map<string, Set<string>>([
    [ALICE.id, new Set([SHARED_PLAN_ID, 'alice-only-plan'])],
    [BOB.id, new Set([SHARED_PLAN_ID, 'bob-only-plan'])],
  ]);
  const calls: string[] = [];
  const dependencies = {
    isAdmin(email: string) {
      calls.push(`admin:${email}`);
      return email === ADMIN.email;
    },
    async findOwner(userId: string) {
      calls.push(`owner:${userId}`);
      return users.get(userId) ?? null;
    },
    async ownsPlan(userId: string, planId: string) {
      calls.push(`plan:${userId}:${planId}`);
      return plans.get(userId)?.has(planId) ?? false;
    },
  };
  return { users, plans, calls, dependencies };
}

test('미로그인 요청은 관리자 헤더 유무와 무관하게 조회 전에 401로 거절한다', async () => {
  for (const headers of [{}, scope()]) {
    const { dependencies, calls } = fixture();
    assert.deepEqual(await resolvePlanActor(request(headers), SHARED_PLAN_ID, null, dependencies), { status: 401 });
    assert.deepEqual(calls, []);
  }
});

test('일반 요청은 로그인 사용자 본인을 유지하고 관리자·소유자·플랜 조회를 수행하지 않는다', async () => {
  for (const actor of [ALICE, ADMIN]) {
    for (const planId of [SHARED_PLAN_ID, undefined]) {
      const { dependencies, calls } = fixture();
      const decision = await resolvePlanActor(request(), planId, actor, dependencies);
      assert.deepEqual(decision.access, { user: actor, actor, delegated: false });
      assert.equal(decision.access?.user, actor);
      assert.deepEqual(calls, []);
    }
  }
});

test('비관리자의 소유자·플랜 헤더 위조는 다른 사용자 조회 전에 거절한다', async () => {
  const { dependencies, calls } = fixture();
  const decision = await resolvePlanActor(request(scope(BOB.id)), SHARED_PLAN_ID, ALICE, dependencies);
  assert.deepEqual(decision, { status: 404 });
  assert.deepEqual(calls, [`admin:${ALICE.email}`]);
});

test('잘못되거나 불완전한 범위 헤더로는 사용자·플랜을 조회할 수 없다', async (t) => {
  const cases: [string, Record<string, string>][] = [
    ['소유자만 지정', { 'x-admin-user-id': ALICE.id }],
    ['플랜만 지정', { 'x-admin-plan-id': SHARED_PLAN_ID }],
    ['빈 소유자', scope('')],
    ['공백 소유자', scope('   ')],
    ['빈 플랜', scope(ALICE.id, '')],
    ['공백 플랜', scope(ALICE.id, '   ')],
    ['소유자 길이 초과', scope('u'.repeat(129))],
    ['플랜 길이 초과', scope(ALICE.id, 'p'.repeat(129))],
  ];
  for (const [name, headers] of cases) {
    await t.test(name, async () => {
      const { dependencies, calls } = fixture();
      assert.deepEqual(await resolvePlanActor(request(headers), undefined, ADMIN, dependencies), { status: 404 });
      assert.ok(calls.every((entry) => entry.startsWith('admin:')), '유효하지 않은 범위로 소유자 데이터를 조회하지 않는다.');
    });
  }
});

test('헤더 플랜과 라우트·요청 본문에서 전달한 플랜이 다르면 소유자 조회 전에 거절한다', async () => {
  for (const suppliedPlanId of ['route-other-plan', 'body-other-plan']) {
    const { dependencies, calls } = fixture();
    const decision = await resolvePlanActor(request(scope()), suppliedPlanId, ADMIN, dependencies);
    assert.deepEqual(decision, { status: 404 });
    assert.ok(!calls.some((entry) => entry.startsWith('owner:') || entry.startsWith('plan:')));
  }
});

test('관리자는 지정한 소유자가 실제로 가진 정확한 플랜에만 접근한다', async () => {
  const { dependencies, calls } = fixture();
  const allowed = await resolvePlanActor(request(scope()), SHARED_PLAN_ID, ADMIN, dependencies);
  assert.deepEqual(allowed.access, { user: ALICE, actor: ADMIN, delegated: true });
  assert.deepEqual(calls, [`admin:${ADMIN.email}`, `owner:${ALICE.id}`, `plan:${ALICE.id}:${SHARED_PLAN_ID}`]);

  calls.length = 0;
  const wrongOwner = await resolvePlanActor(request(scope(ALICE.id, 'bob-only-plan')), 'bob-only-plan', ADMIN, dependencies);
  assert.deepEqual(wrongOwner, { status: 404 });
  assert.deepEqual(calls, [`admin:${ADMIN.email}`, `owner:${ALICE.id}`, `plan:${ALICE.id}:bob-only-plan`]);
});

test('삭제된 사용자는 플랜 존재 조회 전에 거절한다', async () => {
  const { users, dependencies, calls } = fixture();
  users.delete(ALICE.id);
  assert.deepEqual(await resolvePlanActor(request(scope()), SHARED_PLAN_ID, ADMIN, dependencies), { status: 404 });
  assert.deepEqual(calls, [`admin:${ADMIN.email}`, `owner:${ALICE.id}`]);
});

test('사용자가 남아 있어도 삭제된 플랜은 접근할 수 없다', async () => {
  const { plans, dependencies } = fixture();
  plans.get(ALICE.id)!.delete(SHARED_PLAN_ID);
  assert.deepEqual(await resolvePlanActor(request(scope()), SHARED_PLAN_ID, ADMIN, dependencies), { status: 404 });
});

test('서로 다른 소유자가 같은 플랜 ID를 가져도 대상 계정이 혼동되지 않는다', async () => {
  const { dependencies } = fixture();
  const alice = await resolvePlanActor(request(scope(ALICE.id)), SHARED_PLAN_ID, ADMIN, dependencies);
  const bob = await resolvePlanActor(request(scope(BOB.id)), SHARED_PLAN_ID, ADMIN, dependencies);
  assert.equal(alice.access?.user.id, ALICE.id);
  assert.equal(bob.access?.user.id, BOB.id);
  assert.equal(alice.access?.actor.id, ADMIN.id);
  assert.equal(bob.access?.actor.id, ADMIN.id);
});

test('과금·설정에 사용할 유효 사용자는 플랜 소유자이고 감사 기록의 행위자는 관리자다', async () => {
  const { dependencies } = fixture();
  const decision = await resolvePlanActor(request(scope(BOB.id)), SHARED_PLAN_ID, ADMIN, dependencies);
  assert.ok(decision.access);
  const { user, actor } = decision.access;
  assert.equal(user.id, BOB.id);
  assert.equal(actor.id, ADMIN.id);
  assert.notEqual(user.id, actor.id);
  assert.equal(decision.access.delegated, true);
});

test('플랜 ID 인자가 없는 범위 API에서도 실제 소유 관계를 검증한다', async () => {
  const { dependencies } = fixture();
  const valid = await resolvePlanActor(request(scope()), undefined, ADMIN, dependencies);
  assert.equal(valid.access?.user.id, ALICE.id);
  assert.deepEqual(await resolvePlanActor(request(scope(ALICE.id, 'unknown-plan')), undefined, ADMIN, dependencies), { status: 404 });
});

test('소유자·플랜 조회 장애를 허용 판정으로 바꾸지 않는다', async () => {
  const { dependencies } = fixture();
  const unavailable = new Error('저장소 조회 실패');
  await assert.rejects(resolvePlanActor(request(scope()), SHARED_PLAN_ID, ADMIN, {
    ...dependencies, findOwner: async () => { throw unavailable; },
  }), unavailable);
  await assert.rejects(resolvePlanActor(request(scope()), SHARED_PLAN_ID, ADMIN, {
    ...dependencies, ownsPlan: async () => { throw unavailable; },
  }), unavailable);
});
