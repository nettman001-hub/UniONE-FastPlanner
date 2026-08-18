/**
 * 관리자 화면이 읽는 질의.
 *
 * **본문은 목록에 섞어 담지 않는다.** 목록·통계 질의는 제목과 개수까지만 꺼낸다.
 * 목록을 여는 것만으로 모든 기획서가 딸려 오면, 볼 생각이 없었어도 이미 본 것이
 * 된다.
 *
 * 본문이 필요하면 `adminPlanBody` 로 **한 번에 하나씩** 따로 부른다. 부르는 쪽에서
 * 누가 무엇을 열었는지 기록을 남긴다(`app/api/admin/route.ts`).
 */

import { getDb } from './index';
import { DAILY_CREDIT_LIMIT, dayKey, dayStart } from '../credits';
import type { Plan } from '../types';

export interface AdminOverview {
  users: number;
  /** 오늘 가입 */
  newUsers: number;
  /** 최근 7일에 무엇이든 만든 사람 */
  activeUsers: number;
  plans: number;
  /** 오늘 크레딧을 쓴 건수와 양 */
  todayRuns: number;
  todayCredits: number;
  /** 연동을 이어 둔 계정 수 */
  integrations: number;
  /** 작성 지침을 켜 둔 계정 수 */
  skills: number;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ n: string | number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export async function adminOverview(): Promise<AdminOverview> {
  const today = dayStart(dayKey());
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [users, newUsers, activeUsers, plans, todayRuns, todayCredits, integrations, skills] =
    await Promise.all([
      count('select count(*) as n from users'),
      count('select count(*) as n from users where created_at >= $1', [today]),
      count('select count(distinct user_id) as n from credit_usage where created_at >= $1', [week]),
      count('select count(*) as n from plans'),
      count('select count(*) as n from credit_usage where created_at >= $1', [today]),
      count('select coalesce(sum(amount), 0) as n from credit_usage where created_at >= $1', [today]),
      count('select count(distinct user_id) as n from integrations'),
      count("select count(distinct user_id) as n from skills where enabled and body <> ''"),
    ]);

  return { users, newUsers, activeUsers, plans, todayRuns, todayCredits, integrations, skills };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  plans: number;
  /** 오늘 쓴 크레딧 */
  usedToday: number;
  remaining: number;
  /** 마지막으로 무엇을 만든 때. 없으면 null. */
  lastUsedAt: string | null;
}

/**
 * 한 사용자의 플랜 목록.
 *
 * **여기에는 본문을 담지 않는다.** 표의 `data` 칸을 통째로 꺼내면 목록을 여는
 * 것만으로 그 사람의 기획서가 전부 딸려 온다. 본문은 고른 하나만
 * `adminPlanBody` 로 따로 가져온다.
 *
 * 대신 **무엇이 만들어졌는지**는 세어서 보여 준다. 이건 본문이 아니라 진행
 * 상태라, 지원할 때 실제로 쓸모가 있다.
 */
export interface AdminPlan {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  /** 다섯 산출물 중 만들어진 것. */
  done: string[];
  counts: { requirements: number; features: number; pages: number; flows: number; wireframes: number };
}

export async function adminUserPlans(userId: string, limit = 200): Promise<AdminPlan[]> {
  const db = await getDb();
  /*
   * 세는 일을 **데이터베이스에서 한다.** 본문을 서버로 끌어와 세면 그 순간
   * 메모리에 남의 기획서가 통째로 올라온다. jsonb 길이만 물어보면 그럴 일이 없다.
   */
  const { rows } = await db.query<{
    id: string;
    title: string;
    updated_at: string;
    created_at: string;
    requirements: string | number;
    features: string | number;
    pages: string | number;
    flows: string | number;
    wireframes: string | number;
    prd_done: boolean;
  }>(
    `select id, title, updated_at, created_at,
            coalesce(jsonb_array_length(data -> 'requirements'), 0) as requirements,
            coalesce(jsonb_array_length(data -> 'features'), 0)     as features,
            coalesce(jsonb_array_length(data -> 'iaPages'), 0)      as pages,
            coalesce(jsonb_array_length(data -> 'flows'), 0)        as flows,
            coalesce(jsonb_array_length(data -> 'wireframes'), 0)   as wireframes,
            coalesce((data -> 'generated' ->> 'prd')::boolean, false) as prd_done
       from plans
      where user_id = $1
      order by updated_at desc
      limit $2`,
    [userId, limit],
  );

  return rows.map((row) => {
    const counts = {
      requirements: Number(row.requirements ?? 0),
      features: Number(row.features ?? 0),
      pages: Number(row.pages ?? 0),
      flows: Number(row.flows ?? 0),
      wireframes: Number(row.wireframes ?? 0),
    };
    const done: string[] = [];
    if (row.prd_done) done.push('prd');
    if (counts.features > 0) done.push('fs');
    if (counts.pages > 0) done.push('ia');
    if (counts.flows > 0) done.push('flow');
    if (counts.wireframes > 0) done.push('wireframe');
    return {
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      done,
      counts,
    };
  });
}

/**
 * 사용자 목록.
 *
 * `query` 는 이메일과 이름에서 찾는다. 대소문자를 가리지 않는다 — 관리자가
 * 정확한 표기를 기억하고 있을 리 없다.
 */
/**
 * 플랜 하나의 본문.
 *
 * 목록과 **일부러 떼어 놓았다.** 목록은 자주 열리고 본문은 가끔 열리는데, 한
 * 질의로 묶으면 목록을 여는 것만으로 그 사람의 기획서 전부가 서버 메모리에
 * 올라온다. 여기는 고른 하나만, 부를 때만 꺼낸다.
 *
 * `userId` 를 함께 받아 **주인과 짝이 맞을 때만** 준다. 플랜 id 만으로 찾게
 * 두면 화면에서 고르지 않은 남의 플랜도 id 만 알면 열린다.
 *
 * 없으면 `null` 이다. 지워진 플랜과 남의 플랜을 구분해서 알려 주지 않는다.
 */
export interface AdminPlanBody {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  plan: Plan;
}

export async function adminPlanBody(userId: string, planId: string): Promise<AdminPlanBody | null> {
  const db = await getDb();
  const { rows } = await db.query<{
    id: string;
    title: string;
    data: Plan;
    updated_at: string | Date;
    created_at: string | Date;
  }>(
    'select id, title, data, updated_at, created_at from plans where user_id = $1 and id = $2',
    [userId, planId],
  );

  const row = rows[0];
  if (!row) return null;

  const updatedAt = iso(row.updated_at);
  /*
   * 본문 안의 `id` 와 `updatedAt` 보다 **열 값을 정답으로 본다.** 저장 규칙이
   * 그렇다(`lib/db/plans.ts` 의 `toPlan`). 여기서만 다르게 보면 관리자 화면에
   * 보이는 시각이 사용자 화면과 어긋난다.
   */
  return {
    id: row.id,
    title: row.title,
    updatedAt,
    createdAt: iso(row.created_at),
    plan: { ...row.data, id: row.id, updatedAt },
  };
}

export async function adminUsers(query = '', limit = 50): Promise<AdminUser[]> {
  const db = await getDb();
  const today = dayStart(dayKey());
  const like = `%${query.trim().toLowerCase()}%`;

  const { rows } = await db.query<{
    id: string;
    email: string;
    name: string;
    created_at: string;
    plans: string | number;
    used_today: string | number;
    last_used_at: string | null;
  }>(
    `select u.id, u.email, u.name, u.created_at,
            (select count(*) from plans p where p.user_id = u.id) as plans,
            (select coalesce(sum(c.amount), 0) from credit_usage c
               where c.user_id = u.id and c.created_at >= $1) as used_today,
            (select max(c.created_at) from credit_usage c where c.user_id = u.id) as last_used_at
       from users u
      where $2 = '%%' or lower(u.email) like $2 or lower(u.name) like $2
      order by u.created_at desc
      limit $3`,
    [today, like, limit],
  );

  return rows.map((row) => {
    const usedToday = Number(row.used_today ?? 0);
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: new Date(row.created_at).toISOString(),
      plans: Number(row.plans ?? 0),
      usedToday,
      remaining: Math.max(0, DAILY_CREDIT_LIMIT - usedToday),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    };
  });
}

/**
 * 크레딧을 되돌려 준다.
 *
 * **쓴 기록을 지우지 않는다.** 음수 한 줄을 더 적어 상쇄한다. 지우면 무슨 일이
 * 있었는지가 사라져, 나중에 "왜 이 사람만 많이 썼나" 를 되짚을 수 없다.
 * 되돌려 준 것도 기록으로 남아야 한다.
 */
export async function grantCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const db = await getDb();
  await db.query('insert into credit_usage (user_id, kind, amount) values ($1, $2, $3)', [
    userId,
    'grant',
    -amount,
  ]);
}
