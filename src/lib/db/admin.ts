/**
 * 관리자 화면이 읽는 질의.
 *
 * **남의 기획서 본문은 읽지 않는다.** 제목과 언제 고쳤는지까지다. 목록과 통계로
 * 운영에 필요한 것은 다 되고, 본문은 남의 것이라 볼 이유가 없다. 봐야 할 일이
 * 생기면 그때 "왜 열었는지" 를 남기는 장치와 함께 만든다.
 */

import { getDb } from './index';
import { DAILY_CREDIT_LIMIT, dayKey, dayStart } from '../credits';

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
 * 사용자 목록.
 *
 * `query` 는 이메일과 이름에서 찾는다. 대소문자를 가리지 않는다 — 관리자가
 * 정확한 표기를 기억하고 있을 리 없다.
 */
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
