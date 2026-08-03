/** plans 표를 다루는 질의. 플랜 본문은 통째로 jsonb 한 칸에 담는다. */

import { getDb } from './index';
import type { Plan } from '../types';

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
  return { ...row.data, id: row.id, updatedAt: toIso(row.updated_at) };
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
  const updatedAt = plan.updatedAt || new Date().toISOString();
  const { rows } = await db.query<{ id: string }>(
    `insert into plans (id, user_id, title, data, updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, id) do update
       set title = excluded.title,
           data = excluded.data,
           updated_at = excluded.updated_at
     where plans.updated_at <= excluded.updated_at
     returning id`,
    [plan.id, userId, plan.brief?.title ?? '', JSON.stringify(plan), updatedAt],
  );
  return rows.length > 0;
}

export async function deletePlan(userId: string, planId: string): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    'delete from plans where user_id = $1 and id = $2 returning id',
    [userId, planId],
  );
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
