import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/server';
import { signupMode } from '@/lib/auth/policy';
import { hasDatabase } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 지금 누가 로그인해 있는지 + 로그인 화면이 알아야 할 정책.
 *
 * 로그인하지 않았어도 200 을 돌려준다 — 화면이 "아직 모름" 과 "안 했음" 을
 * 구분할 수 있어야 깜빡임 없이 그려진다.
 */
export async function GET() {
  return NextResponse.json({
    user: await currentUser(),
    signup: signupMode(),
    // 배포에 DB 를 안 붙였으면 화면에서 미리 알려 줄 수 있다.
    database: hasDatabase() ? 'postgres' : 'local',
  });
}
