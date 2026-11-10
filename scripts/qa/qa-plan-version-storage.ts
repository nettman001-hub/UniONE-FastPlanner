/** 실행: npx tsx scripts/qa/qa-plan-version-storage.ts — 격리된 실제 PGlite로 버전 이관·보존 검증. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../../src/lib/db/index';
import {
  deletePlan, deletePlanVersion, getPlan, getPlanVersion, listPlans, listPlansPage,
  listVersionSummaries, savePlan, savePlanVersion, VersionSnapshotConflictError,
} from '../../src/lib/db/plans';
import { compactPlan, planForAi } from '../../src/lib/plan-transport';
import { emptyDocuments, type Plan, type PlanVersion } from '../../src/lib/types';

const OWNER = 'qa-version-owner';
const OTHER = 'qa-version-other';

function version(id: string, extra = ''): PlanVersion {
  const snapshot = {
    ...emptyDocuments(),
    prd: { ...emptyDocuments().prd, overview: `원문 ${id} ${extra}` },
    futureFields: { nested: ['그대로 보존', { optional: null, value: '본문'.repeat(4_000) }] },
  };
  return { id, label: `버전 ${id}`, createdAt: '2026-11-10T00:00:00.000Z', snapshot };
}

function plan(id: string): Plan {
  return {
    ...emptyDocuments(), id,
    brief: { title: id, oneLiner: '버전 저장 검증', idea: '외부 서비스 없는 검증', targetUser: 'QA', purpose: '이관 확인', platform: 'web' },
    createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    generated: { prd: true, fs: false, ia: false, flow: false, wireframe: false },
    chat: [], comments: [], versions: [],
  };
}

async function worker() {
  // 프로세스 환경은 부모가 임시 PGlite로 고정한다. .env 파일은 읽지 않는다.
  assert.equal(process.env.DATABASE_URL, '');
  assert.ok(path.basename(process.env.PGLITE_DIR ?? '').startsWith('uniboard-version-db-qa-'));
  const db = await getDb();
  for (const id of [OWNER, OTHER]) {
    await db.query('insert into users(id,email,name) values ($1,$2,$3)', [id, `${id}@qa.invalid`, id]);
  }
  let count = 0;
  const check = (name: string, action: () => void) => { action(); count += 1; console.log(`PASS ${name}`); };
  const legacy = plan('shared-plan');
  legacy.prd.overview = '현재 문서 원문';
  legacy.versions = Array.from({ length: 24 }, (_, index) => version(`ver-${String(index).padStart(3, '0')}`));
  const unknownVersion = { ...legacy.versions[0], futureVersionMetadata: { format: 'v2', tags: ['원형 보존'] } };
  legacy.versions[0] = unknownVersion;
  await db.query('insert into plans(id,user_id,title,data,updated_at) values ($1,$2,$3,$4,$5)', [legacy.id, OWNER, legacy.brief.title, JSON.stringify(legacy), legacy.updatedAt]);

  const read = await getPlan(OWNER, legacy.id);
  assert.ok(read);
  const { rows: archived } = await db.query<{ count: string }>('select count(*) as count from plan_versions where user_id=$1 and plan_id=$2', [OWNER, legacy.id]);
  const { rows: stored } = await db.query<{ data: Plan; updated_at: Date | string }>('select data,updated_at from plans where user_id=$1 and id=$2', [OWNER, legacy.id]);
  check('기존 내장 버전 24개를 전부 이관하고 현재 본문에서는 스냅샷만 제거한다', () => {
    assert.equal(Number(archived[0].count), 24);
    assert.equal(read.versions.length, 24);
    assert.ok(read.versions.every((item) => !Object.hasOwn(item, 'snapshot')));
    assert.ok(stored[0].data.versions.every((item) => !Object.hasOwn(item, 'snapshot')));
    assert.equal(read.prd.overview, '현재 문서 원문');
    assert.equal(new Date(stored[0].updated_at).toISOString(), legacy.updatedAt);
    assert.ok(JSON.stringify(read).length < JSON.stringify(legacy).length / 10);
  });
  const restored = await getPlanVersion(OWNER, legacy.id, unknownVersion.id);
  check('확장 필드를 포함한 버전 원본 JSON을 요청할 때만 정확하게 읽는다', () => {
    assert.deepEqual(restored, unknownVersion);
    assert.deepEqual(restored?.snapshot, unknownVersion.snapshot);
    assert.equal(read.versions.find((item) => item.id === unknownVersion.id)?.label, unknownVersion.label);
  });
  const summaries = await listVersionSummaries(OWNER, legacy.id);
  check('버전 목록은 전체 이력을 유지하면서 본문을 포함하지 않는다', () => {
    assert.equal(summaries.length, 24);
    assert.ok(summaries.every((item) => !Object.hasOwn(item, 'snapshot')));
  });

  const stalePending = version('local-pending-version');
  const stale = { ...read, updatedAt: '2020-01-01T00:00:00.000Z', versions: [stalePending], prd: { ...read.prd, overview: '덮어쓰면 안 되는 오래된 본문' } };
  const staleApplied = await savePlan(OWNER, stale);
  const preservedPending = await getPlanVersion(OWNER, legacy.id, stalePending.id);
  const afterConflict = await getPlan(OWNER, legacy.id);
  check('본문 충돌로 저장을 거절해도 미전송 스냅샷은 먼저 보관한다', () => {
    assert.equal(staleApplied, false);
    assert.deepEqual(preservedPending, stalePending);
    assert.equal(afterConflict?.prd.overview, '현재 문서 원문');
    assert.equal(afterConflict?.versions.length, 25);
  });

  const next = { ...read, updatedAt: '2027-01-01T00:00:00.000Z', versions: [], prd: { ...read.prd, overview: '새 현재 본문' } };
  assert.equal(await savePlan(OWNER, next), true);
  const afterOmission = await getPlan(OWNER, legacy.id);
  check('빈 버전 목록으로 현재 문서를 저장해도 기존 서버 이력을 삭제하지 않는다', () => {
    assert.equal(afterOmission?.versions.length, 25);
    assert.equal(afterOmission?.prd.overview, '새 현재 본문');
  });
  const newVersion = version('new-idempotent-version');
  assert.equal(await savePlanVersion(OWNER, legacy.id, newVersion), true);
  assert.equal(await savePlanVersion(OWNER, legacy.id, newVersion), true);
  const afterRetry = await listVersionSummaries(OWNER, legacy.id);
  check('버전 개별 업로드의 재시도는 중복을 만들지 않는다', () => {
    assert.equal(afterRetry.length, 26);
    assert.equal(afterRetry.filter((item) => item.id === newVersion.id).length, 1);
  });
  await assert.rejects(savePlanVersion(OWNER, legacy.id, version(newVersion.id, '다른 원문')), VersionSnapshotConflictError);
  check('같은 ID의 다른 스냅샷을 조용히 덮어쓰지 않는다', () => assert.ok(true));
  assert.deepEqual(await getPlanVersion(OWNER, legacy.id, newVersion.id), newVersion);

  assert.equal(await deletePlanVersion(OWNER, legacy.id, unknownVersion.id), true);
  assert.equal(await deletePlanVersion(OWNER, legacy.id, unknownVersion.id), true);
  assert.equal(await savePlan(OWNER, { ...legacy, updatedAt: '2028-01-01T00:00:00.000Z' }), true);
  const afterDelete = await getPlan(OWNER, legacy.id);
  check('명시적으로 지운 버전은 오래된 전체 PUT이 다시 보내도 살아나지 않는다', () => {
    assert.ok(!afterDelete?.versions.some((item) => item.id === unknownVersion.id));
    assert.equal(afterDelete?.versions.length, 25);
  });
  assert.equal(await getPlanVersion(OWNER, legacy.id, unknownVersion.id), null);
  assert.equal(await deletePlanVersion(OWNER, legacy.id, 'deleted-before-upload'), true);
  assert.equal(await savePlanVersion(OWNER, legacy.id, version('deleted-before-upload')), false);
  assert.equal(await getPlanVersion(OWNER, legacy.id, 'deleted-before-upload'), null);
  check('아직 서버에 없는 로컬 버전의 삭제도 늦은 업로드보다 우선한다', () => assert.ok(true));

  const other = plan(legacy.id);
  other.versions = [version(newVersion.id, '다른 소유자의 원문')];
  assert.equal(await savePlan(OTHER, other), true);
  const ownSnapshot = await getPlanVersion(OWNER, legacy.id, newVersion.id);
  const otherSnapshot = await getPlanVersion(OTHER, legacy.id, newVersion.id);
  check('소유자와 플랜·버전 ID 조합으로 이력을 분리한다', () => {
    assert.deepEqual(ownSnapshot, newVersion);
    assert.deepEqual(otherSnapshot, other.versions[0]);
    assert.notDeepEqual(otherSnapshot?.snapshot, ownSnapshot?.snapshot);
  });
  assert.equal(await getPlanVersion(OWNER, 'missing-plan', newVersion.id), null);
  assert.equal(await savePlanVersion(OWNER, 'missing-plan', version('missing-parent')), false);
  check('존재하지 않는 플랜에는 버전을 생성하거나 다른 플랜의 이력을 조회하지 않는다', () => assert.ok(true));

  const conflict = plan('migration-conflict-plan');
  conflict.versions = [version('collision')];
  await savePlan(OWNER, conflict);
  const incomingConflict = { ...conflict, versions: [version('collision', '보존해야 하는 미이관 원문')] };
  await db.query('update plans set data=$3 where user_id=$1 and id=$2', [OWNER, conflict.id, JSON.stringify(incomingConflict)]);
  await assert.rejects(getPlan(OWNER, conflict.id), VersionSnapshotConflictError);
  const { rows: retained } = await db.query<{ data: Plan }>('select data from plans where user_id=$1 and id=$2', [OWNER, conflict.id]);
  check('이관 실패 시 원래 내장 스냅샷을 제거하지 않고 트랜잭션을 되돌린다', () => assert.deepEqual(retained[0].data.versions, incomingConflict.versions));
  await deletePlan(OWNER, conflict.id);

  await savePlan(OWNER, plan('another-plan'));
  const firstPage = await listPlansPage(OWNER, undefined, 1);
  assert.equal(firstPage.plans.length, 1);
  assert.ok(firstPage.nextCursor);
  const secondPage = await listPlansPage(OWNER, firstPage.nextCursor, 1);
  check('현재 문서 목록을 한 플랜씩 페이지로 읽으며 스냅샷을 반복 전송하지 않는다', () => {
    assert.equal(secondPage.plans.length, 1);
    assert.equal(secondPage.nextCursor, null);
    assert.notEqual(firstPage.plans[0].id, secondPage.plans[0].id);
    assert.ok([...firstPage.plans, ...secondPage.plans].every((item) => item.versions.every((entry) => !Object.hasOwn(entry, 'snapshot'))));
  });
  const all = await listPlans(OWNER);
  check('기존 전체 목록 응답도 스냅샷 본문은 제외한다', () => {
    assert.equal(all.length, 2);
    assert.ok(all.every((item) => item.versions.every((entry) => !Object.hasOwn(entry, 'snapshot'))));
  });

  const originalJson = JSON.stringify(legacy);
  const slim = compactPlan(legacy);
  const ai = planForAi({ ...legacy, chat: [{ id: 'msg', role: 'user', content: '과거 대화', createdAt: legacy.createdAt }] });
  check('전송용 변환은 원본을 수정하지 않고 버전·AI 요청 복제만 줄인다', () => {
    assert.equal(JSON.stringify(legacy), originalJson);
    assert.equal(slim.versions.length, 24);
    assert.ok(slim.versions.every((entry) => !Object.hasOwn(entry, 'snapshot')));
    assert.deepEqual(ai.prd, legacy.prd);
    assert.deepEqual(ai.brief, legacy.brief);
    assert.deepEqual(ai.versions, []);
    assert.deepEqual(ai.chat, []);
    assert.deepEqual(ai.uinAiScreens, []);
  });

  assert.equal(await deletePlan(OWNER, legacy.id), true);
  const { rows: remaining } = await db.query<{ count: string }>('select count(*) as count from plan_versions where user_id=$1 and plan_id=$2', [OWNER, legacy.id]);
  check('사용자가 플랜을 명시적으로 삭제하면 해당 소유자의 버전만 정리한다', () => assert.equal(Number(remaining[0].count), 0));
  assert.deepEqual(await getPlanVersion(OTHER, legacy.id, newVersion.id), other.versions[0]);
  console.log(`완료: 실제 PGlite 버전 보관 검증 ${count}개 통과.`);
}

async function main() {
  if (process.argv.includes('--worker')) {
    try { await worker(); process.exit(0); }
    catch (error) { console.error(error instanceof Error ? error.message : '버전 검증 실패'); process.exit(1); }
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'uniboard-version-db-qa-'));
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve(process.argv[1]), '--worker'], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: '', PGLITE_DIR: directory }, windowsHide: true, stdio: 'inherit',
    });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, '버전 보관 회귀 검증이 실패했습니다.');
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(target).startsWith('uniboard-version-db-qa-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '버전 검증 실패'); process.exitCode = 1; });
