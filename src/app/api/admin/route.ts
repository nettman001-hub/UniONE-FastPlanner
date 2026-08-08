/**
 * 관리자 자료.
 *
 * **관리자가 아니면 404 를 준다.** 403 은 "여기 뭔가 있다" 를 알려 주는 셈이다.
 * 있는지조차 모르는 편이 낫다.
 */

import { NextResponse } from 'next/server';

import { currentAdmin } from '@/lib/auth/admin';
import { adminOverview, adminUsers, grantCredits } from '@/lib/db/admin';
import { storageInfo } from '@/lib/db';
import { isAiEnabled, resolveProvider } from '@/lib/ai/client';
import { signupMode } from '@/lib/auth/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function GET(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return notFound();

  const params = new URL(request.url).searchParams;
  const view = params.get('view') ?? 'overview';

  if (view === 'users') {
    return NextResponse.json({ users: await adminUsers(params.get('q') ?? '') });
  }

  if (view === 'health') {
    const provider = resolveProvider();
    return NextResponse.json({
      storage: storageInfo(),
      signup: signupMode(),
      ai: {
        enabled: isAiEnabled(),
        /*
         * 여기서는 공급자와 모델을 **보여도 된다.** 사용자에게 감추는 규칙은
         * 일반 화면에 대한 것이고, 관리자는 무엇이 도는지 알아야 고칠 수 있다.
         */
        provider: provider.id,
        model: provider.model,
        maxOutputTokens: provider.maxOutputTokens,
      },
      stitch: process.env.STITCH_MCP_URL || 'https://stitch.googleapis.com/mcp',
      authSecret: Boolean(process.env.AUTH_SECRET),
    });
  }

  return NextResponse.json(await adminOverview());
}

/** 크레딧을 되돌려 준다. */
export async function POST(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return notFound();

  let body: { userId?: unknown; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const amount = Number(body.amount);
  if (!userId) return NextResponse.json({ error: '누구에게 줄지 없습니다.' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
    return NextResponse.json({ error: '1 에서 1000 사이로 적어 주세요.' }, { status: 400 });
  }

  await grantCredits(userId, Math.floor(amount));
  console.warn(`[admin] ${admin.email} 이(가) ${userId} 에게 ${amount} 크레딧을 주었습니다.`);
  return NextResponse.json({ ok: true });
}
