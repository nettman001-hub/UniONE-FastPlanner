/** 오늘 남은 크레딧과 최근 사용 내역. 내 것만 본다. */

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { creditState, recentUsage } from '@/lib/db/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const state = await creditState(user.id);
  // 머리글의 칩은 숫자만 필요하다. 내역까지 매번 실어 보내면 낭비다.
  const withHistory = new URL(request.url).searchParams.get('history') === '1';

  return NextResponse.json({
    ...state,
    ...(withHistory ? { usage: await recentUsage(user.id) } : {}),
  });
}
