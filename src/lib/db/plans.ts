/** plans 표를 다루는 질의. 플랜 본문은 통째로 jsonb 한 칸에 담는다. */

import { getDb } from './index';
import { clearPlanSkills } from './skills';
import { normalizeUinAiScreens } from '../design/uinai';
import type { Plan, UinAiScreen } from '../types';

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
function toPlan(row: PlanRow): Plan {
  const plan = { ...row.data, id: row.id, updatedAt: toIso(row.updated_at) };
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
  const { rows } = await db.query<PlanRow>(
    'select id, title, data, updated_at from plans where user_id = $1 order by updated_at desc',
    [userId],
  );
  return rows.map(toPlan);
}

export async function getPlan(userId: string, planId: string): Promise<Plan | null> {
  const db = await getDb();
  const { rows } = await db.query<PlanRow>(
    'select id, title, data, updated_at from plans where user_id = $1 and id = $2',
    [userId, planId],
  );
  return rows[0] ? toPlan(rows[0]) : null;
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
    // 행이 아직 없는 첫 저장도 다른 요청과 한 줄로 세우기 위한 플랜별 잠금.
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`${userId}:${plan.id}`]);
    const { rows: current } = await tx.query<PlanRow>(
      'select id, title, data, updated_at from plans where user_id = $1 and id = $2 for update',
      [userId, plan.id],
    );
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
    // UinAI 결과는 화면별 생성 시각으로 병합한다. 서로 다른 기기에서 만든 화면이
    // Plan 전체의 updatedAt 경쟁 때문에 통째로 사라지지 않게 한다.
    const mergedScreens = normalizeUinAiScreens(
      [
        ...preservedServerScreens,
        ...(Array.isArray(plan.uinAiScreens) ? plan.uinAiScreens : []),
      ],
      validPageIds,
    );
    const next: Plan = { ...plan, updatedAt, uinAiScreens: mergedScreens };
    await tx.query(
      `insert into plans (id, user_id, title, data, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, id) do update
         set title = excluded.title,
             data = excluded.data,
             updated_at = excluded.updated_at`,
      [plan.id, userId, plan.brief?.title ?? '', JSON.stringify(next), updatedAt],
    );
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
