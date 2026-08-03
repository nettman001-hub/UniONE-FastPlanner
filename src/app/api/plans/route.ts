import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { listPlans, savePlans } from '@/lib/db/plans';
import { serverErrorMessage } from '@/lib/api-error';
import type { Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 내 플랜 전부. 브라우저가 로그인 직후 한 번 받아 간다. */
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    return NextResponse.json({ plans: await listPlans(user.id) });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

/**
 * 여러 개를 한 번에 저장한다.
 *
 * 로그인 전에 브라우저에 만들어 둔 플랜을 계정으로 옮길 때 쓴다.
 */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { plans?: Plan[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const plans = body.plans;
  if (!Array.isArray(plans) || plans.some((p) => !p?.id)) {
    return NextResponse.json({ error: '플랜 목록이 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    return NextResponse.json({ saved: await savePlans(user.id, plans) });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

/** 원문은 서버 로그에만 남기고 화면에는 안전한 문장을 보낸다. */
function describe(error: unknown): string {
  return serverErrorMessage('plans', error);
}
