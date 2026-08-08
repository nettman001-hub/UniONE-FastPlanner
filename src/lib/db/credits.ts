/** credit_usage 표를 다루는 질의. 크레딧의 **유일한 근거**다. */

import { getDb } from './index';
import {
  DAILY_CREDIT_LIMIT,
  dayKey,
  dayStart,
  type CreditEntry,
  type CreditKind,
  type CreditState,
} from '../credits';

/** 오늘 쓴 양. */
async function usedToday(userId: string): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ used: string | number | null }>(
    'select coalesce(sum(amount), 0) as used from credit_usage where user_id = $1 and created_at >= $2',
    [userId, dayStart(dayKey())],
  );
  return Number(rows[0]?.used ?? 0);
}

export async function creditState(userId: string): Promise<CreditState> {
  const used = await usedToday(userId);
  return {
    used,
    remaining: Math.max(0, DAILY_CREDIT_LIMIT - used),
    limit: DAILY_CREDIT_LIMIT,
  };
}

/**
 * 낼 수 있는지 본다. **깎지는 않는다.**
 *
 * 값은 결과를 받았을 때 치른다. 시작할 때 미리 빼면, 그 단계가 끝나기 전에
 * 창을 닫았을 때 받지도 못한 것에 값을 치른 셈이 된다.
 */
export async function canAfford(userId: string, amount: number): Promise<boolean> {
  return (await creditState(userId)).remaining >= amount;
}

/**
 * 쓴 것을 적는다.
 *
 * 적는 데 실패해도 **던지지 않는다.** 이미 만들어 준 것을 무를 수는 없고,
 * 크레딧을 못 적었다고 산출물까지 날리는 것은 더 나쁘다. 대신 서버 기록에 남겨
 * 나중에 세어 볼 수 있게 한다.
 */
export async function spendCredits(
  userId: string,
  kind: CreditKind,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  try {
    const db = await getDb();
    await db.query('insert into credit_usage (user_id, kind, amount) values ($1, $2, $3)', [
      userId,
      kind,
      amount,
    ]);
  } catch (error) {
    console.error('[credits] 사용 기록을 남기지 못했습니다:', { userId, kind, amount, error });
  }
}

/** 최근 사용 내역. 설정의 사용량 화면이 읽는다. */
export async function recentUsage(userId: string, limit = 30): Promise<CreditEntry[]> {
  const db = await getDb();
  const { rows } = await db.query<{ kind: string; amount: number; created_at: string }>(
    `select kind, amount, created_at from credit_usage
     where user_id = $1
     order by created_at desc
     limit $2`,
    [userId, limit],
  );
  return rows.map((row) => ({ kind: row.kind, amount: Number(row.amount), at: row.created_at }));
}
