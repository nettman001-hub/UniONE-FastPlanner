/** plans 표를 다루는 질의. 플랜 본문은 통째로 jsonb 한 칸에 담는다. */

import { getDb, type Sql } from './index';
import { clearPlanSkills } from './skills';
import { normalizeUinAiScreens } from '../design/uinai';
import { compactPlan } from '../plan-transport';
import type { Plan, PlanVersion, UinAiScreen } from '../types';

/** 목록 화면에서 쓰는 요약. 본문 없이 무엇이 언제 바뀌었는지만 본다. */
export interface PlanSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface PlanRow {
  id: string;
  title: string;
  data: Plan;
  updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * 저장된 본문을 돌려준다.
 *
 * 본문 안의 `id` 와 `updatedAt` 은 열(column) 쪽 값을 정답으로 본다 — 동기화 판정이
 * 열을 보고 이루어지므로 둘이 어긋나면 안 된다.
 */
function toPlan(row: PlanRow, versions: PlanVersion[]): Plan {
  const plan = { ...row.data, id: row.id, updatedAt: toIso(row.updated_at), versions };
  const pageIds = (Array.isArray(plan.iaPages) ? plan.iaPages : [])
    .filter((page) => page?.type === 'page' && typeof page.id === 'string')
    .map((page) => page.id);
  return { ...plan, uinAiScreens: normalizeUinAiScreens(plan.uinAiScreens, pageIds) };
}

export async function listPlanSummaries(userId: string): Promise<PlanSummary[]> {
  const db = await getDb();
  const { rows } = await db.query<Omit<PlanRow, 'data'>>(
    'select id, title, updated_at from plans where user_id = $1 order by updated_at desc',
    [userId],
  );
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: toIso(row.updated_at) }));
}

export async function listPlans(userId: string): Promise<Plan[]> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    'select id from plans where user_id = $1 order by updated_at desc',
    [userId],
  );
  const plans: Plan[] = [];
  for (const row of rows) {
    const plan = await getPlan(userId, row.id);
    if (plan) plans.push(plan);
  }
  return plans;
}

/** 한 번에 한 플랜씩 현재 본문을 받아 대형 계정의 초기 응답을 제한한다. */
export async function listPlansPage(userId: string, afterId?: string, pageSize = 1): Promise<{ plans: Plan[]; nextCursor: string | null }> {
  const db = await getDb();
  const size = Math.min(10, Math.max(1, Math.floor(pageSize) || 1));
  const { rows } = await db.query<{ id: string }>(
    'select id from plans where user_id = $1 and ($2::text is null or id > $2) order by id asc limit $3',
    [userId, afterId ?? null, size + 1],
  );
  const selected = rows.slice(0, size);
  const plans: Plan[] = [];
  for (const row of selected) {
    const plan = await getPlan(userId, row.id);
    if (plan) plans.push(plan);
  }
  return { plans, nextCursor: rows.length > size ? selected[selected.length - 1].id : null };
}

export class VersionSnapshotConflictError extends Error {
  constructor() { super('같은 버전 ID에 다른 스냅샷이 이미 저장되어 있습니다.'); }
}

async function planLock(tx: Sql, userId: string, planId: string): Promise<PlanRow | undefined> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`${userId}:${planId}`]);
  const { rows } = await tx.query<PlanRow>(
    'select id, title, data, updated_at from plans where user_id = $1 and id = $2 for update', [userId, planId],
  );
  return rows[0];
}

function fullVersions(value: unknown): PlanVersion[] {
  return Array.isArray(value) ? value.filter((version): version is PlanVersion =>
    !!version && typeof version === 'object' && typeof version.id === 'string' && !!version.id &&
    !!version.snapshot && typeof version.snapshot === 'object' && !Array.isArray(version.snapshot),
  ) : [];
}

/** 스냅샷 JSON은 정규화하지 않고 그대로 보존한다. 같은 ID의 재전송만 허용한다. */
async function archiveVersions(tx: Sql, userId: string, planId: string, versions: unknown): Promise<void> {
  for (const version of fullVersions(versions)) {
    const { rows } = await tx.query<{ data: PlanVersion; deleted_at: string | null }>(
      'select data, deleted_at from plan_versions where user_id = $1 and plan_id = $2 and id = $3',
      [userId, planId, version.id],
    );
    if (rows[0]) {
      // 삭제한 버전은 오래된 전체 PUT에서도 부활시키지 않는다.
      if (rows[0].deleted_at) continue;
      const equal = await tx.query<{ equal: boolean }>(
        'select ($1::jsonb = $2::jsonb) as equal',
        [JSON.stringify(rows[0].data.snapshot), JSON.stringify(version.snapshot)],
      );
      if (!equal.rows[0]?.equal) throw new VersionSnapshotConflictError();
      continue;
    }
    await tx.query(
      'insert into plan_versions (user_id, plan_id, id, data, created_at) values ($1,$2,$3,$4,$5)',
      [userId, planId, version.id, JSON.stringify(version), typeof version.createdAt === 'string' ? version.createdAt : ''],
    );
  }
}

async function versionSummaries(tx: Sql, userId: string, planId: string): Promise<PlanVersion[]> {
  const { rows } = await tx.query<{ data: PlanVersion }>(
    "select data - 'snapshot' as data from plan_versions where user_id = $1 and plan_id = $2 and deleted_at is null order by created_at desc, id desc",
    [userId, planId],
  );
  return rows.map((row) => row.data);
}

/** 이관이 완전히 성공한 뒤에만 현재 본문에서 스냅샷을 제거한다. */
async function migrateEmbeddedVersions(tx: Sql, userId: string, row: PlanRow): Promise<void> {
  if (fullVersions(row.data.versions).length === 0) return;
  await archiveVersions(tx, userId, row.id, row.data.versions);
  const next = { ...row.data, versions: await versionSummaries(tx, userId, row.id) };
  await tx.query('update plans set data = $3 where user_id = $1 and id = $2', [userId, row.id, JSON.stringify(next)]);
  row.data = next;
}

export async function getPlan(userId: string, planId: string): Promise<Plan | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await planLock(tx, userId, planId);
    if (!row) return null;
    await migrateEmbeddedVersions(tx, userId, row);
    return toPlan(row, await versionSummaries(tx, userId, planId));
  });
}

export async function listVersionSummaries(userId: string, planId: string): Promise<PlanVersion[]> {
  const plan = await getPlan(userId, planId);
  return plan?.versions ?? [];
}

export async function getPlanVersion(userId: string, planId: string, versionId: string): Promise<PlanVersion | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const plan = await planLock(tx, userId, planId);
    if (!plan) return null;
    await migrateEmbeddedVersions(tx, userId, plan);
    const { rows } = await tx.query<{ data: PlanVersion }>(
      'select data from plan_versions where user_id = $1 and plan_id = $2 and id = $3 and deleted_at is null', [userId, planId, versionId],
    );
    return rows[0]?.data ?? null;
  });
}

export async function savePlanVersion(userId: string, planId: string, version: PlanVersion): Promise<boolean> {
  if (fullVersions([version]).length !== 1) throw new Error('버전 스냅샷이 없습니다.');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const plan = await planLock(tx, userId, planId);
    if (!plan) return false;
    await migrateEmbeddedVersions(tx, userId, plan);
    await archiveVersions(tx, userId, planId, [version]);
    const { rows } = await tx.query('select 1 from plan_versions where user_id=$1 and plan_id=$2 and id=$3 and deleted_at is null', [userId, planId, version.id]);
    return rows.length > 0;
  });
}

export async function deletePlanVersion(userId: string, planId: string, versionId: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const plan = await planLock(tx, userId, planId);
    if (!plan) return false;
    await migrateEmbeddedVersions(tx, userId, plan);
    // 미전송 로컬 버전을 먼저 지운 경우도 지운 기록을 남겨 늦은 업로드를 차단한다.
    const { rows } = await tx.query(
      `insert into plan_versions (user_id,plan_id,id,data,deleted_at) values ($1,$2,$3,$4,now())
       on conflict (user_id,plan_id,id) do update set deleted_at=coalesce(plan_versions.deleted_at,excluded.deleted_at)
       returning id`,
      [userId, planId, versionId, JSON.stringify({ id: versionId })],
    );
    return rows.length > 0;
  });
}

/** 관리자 작업 권한 확인에는 큰 플랜 본문을 가져오지 않는다. */
export async function planExists(userId: string, planId: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query('select 1 from plans where user_id = $1 and id = $2', [userId, planId]);
  return rows.length > 0;
}

/**
 * 저장(있으면 갱신).
 *
 * `updated_at` 이 더 최신일 때만 덮어쓴다. 탭 두 개를 띄워 두면 오래된 쪽의 저장이
 * 늦게 도착할 수 있는데, 그때 새 내용이 지워지면 안 되기 때문이다.
 * 실제로 반영됐는지 여부를 돌려준다.
 */
export async function savePlan(userId: string, plan: Plan): Promise<boolean> {
  const db = await getDb();
  const parsed = Date.parse(plan.updatedAt);
  const updatedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  return db.transaction(async (tx) => {
    const row = await planLock(tx, userId, plan.id);
    if (row) {
      await migrateEmbeddedVersions(tx, userId, row);
      // 현재 본문이 충돌해도 이 기기에서 만든 미전송 스냅샷은 먼저 보관한다.
      await archiveVersions(tx, userId, plan.id, plan.versions);
    }
    const current = row ? [row] : [];
    if (current[0] && new Date(current[0].updated_at).getTime() > new Date(updatedAt).getTime()) {
      return false;
    }

    const validPageIds = (Array.isArray(plan.iaPages) ? plan.iaPages : [])
      .filter((page) => page?.type === 'page' && typeof page.id === 'string')
      .map((page) => page.id);
    const currentPages = new Map(
      (Array.isArray(current[0]?.data.iaPages) ? current[0].data.iaPages : []).map((page) => [
        page.id,
        page,
      ]),
    );
    const nextPages = new Map(
      (Array.isArray(plan.iaPages) ? plan.iaPages : []).map((page) => [page.id, page]),
    );
    const preservedServerScreens = (
      Array.isArray(current[0]?.data.uinAiScreens) ? current[0].data.uinAiScreens : []
    ).filter((screen) => {
      const before = currentPages.get(screen.pageId);
      const after = nextPages.get(screen.pageId);
      return (
        before?.type === 'page' &&
        after?.type === 'page' &&
        before.name === after.name &&
        before.path === after.path &&
        before.parentId === after.parentId
      );
    });
    // UniAI 결과는 화면별 생성 시각으로 병합한다. 서로 다른 기기에서 만든 화면이
    // Plan 전체의 updatedAt 경쟁 때문에 통째로 사라지지 않게 한다.
    const mergedScreens = normalizeUinAiScreens(
      [
        ...preservedServerScreens,
        ...(Array.isArray(plan.uinAiScreens) ? plan.uinAiScreens : []),
      ],
      validPageIds,
    );
    const next: Plan = { ...compactPlan(plan), updatedAt, uinAiScreens: mergedScreens };
    if (row) next.versions = await versionSummaries(tx, userId, plan.id);
    await tx.query(
      `insert into plans (id, user_id, title, data, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, id) do update
         set title = excluded.title,
             data = excluded.data,
             updated_at = excluded.updated_at`,
      [plan.id, userId, plan.brief?.title ?? '', JSON.stringify(next), updatedAt],
    );
    if (!row) {
      // 처음 저장하는 플랜은 외래키 대상 행을 만든 뒤 같은 트랜잭션에서 버전을 보관한다.
      await archiveVersions(tx, userId, plan.id, plan.versions);
      next.versions = await versionSummaries(tx, userId, plan.id);
      await tx.query('update plans set data = $3 where user_id = $1 and id = $2', [userId, plan.id, JSON.stringify(next)]);
    }
    return true;
  });
}

export type SaveUinAiScreenResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: 'missing-plan' | 'missing-page' | 'too-large' };

/**
 * 생성 결과를 응답보다 먼저 서버 플랜에 화면 단위로 합친다.
 * 브라우저가 닫혀도 다음 로그인에서 결과를 복구할 수 있고, 동시에 만든 다른 화면도 보존된다.
 */
export async function saveUinAiScreen(
  userId: string,
  planId: string,
  screen: UinAiScreen,
): Promise<SaveUinAiScreenResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`${userId}:${planId}`]);
    const { rows } = await tx.query<PlanRow>(
      'select id, title, data, updated_at from plans where user_id = $1 and id = $2 for update',
      [userId, planId],
    );
    const row = rows[0];
    if (!row) return { ok: false, reason: 'missing-plan' };

    const validPageIds = (Array.isArray(row.data.iaPages) ? row.data.iaPages : [])
      .filter((page) => page?.type === 'page' && typeof page.id === 'string')
      .map((page) => page.id);
    if (!validPageIds.includes(screen.pageId)) return { ok: false, reason: 'missing-page' };

    const merged = normalizeUinAiScreens(
      [...(Array.isArray(row.data.uinAiScreens) ? row.data.uinAiScreens : []), screen],
      validPageIds,
    );
    if (!merged.some((item) => item.id === screen.id)) {
      return { ok: false, reason: 'too-large' };
    }

    const updatedAt = new Date().toISOString();
    const next: Plan = { ...row.data, id: planId, updatedAt, uinAiScreens: merged };
    await tx.query(
      'update plans set data = $3, updated_at = $4 where user_id = $1 and id = $2',
      [userId, planId, JSON.stringify(next), updatedAt],
    );
    return { ok: true, updatedAt };
  });
}

export async function deletePlan(userId: string, planId: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    'delete from plans where user_id = $1 and id = $2 returning id',
    [userId, planId],
  );
  /*
   * 이 플랜에만 걸어 둔 작성 지침도 함께 치운다. `skills` 는 `plans` 를 외래키로
   * 참조하지 않으므로(아직 안 올라간 플랜에도 지침을 적을 수 있어야 해서)
   * 여기서 직접 지우지 않으면 주인 없는 줄로 남는다.
   *
   * 지우기가 실패해도 플랜 삭제는 성공으로 본다 — 남는 것은 안 쓰이는 줄뿐이고,
   * 그것 때문에 "삭제되지 않았습니다" 가 뜨면 사용자는 뭘 해야 할지 알 수 없다.
   */
  await clearPlanSkills(userId, planId).catch((error) => {
    console.error('[plans] 플랜 지침을 치우지 못했습니다:', error);
  });
  return rows.length > 0;
}

/** 로그인 전에 만든 플랜을 계정으로 옮길 때 쓴다. */
export async function savePlans(userId: string, plans: Plan[]): Promise<number> {
  let saved = 0;
  for (const plan of plans) {
    if (await savePlan(userId, plan)) saved += 1;
  }
  return saved;
}
