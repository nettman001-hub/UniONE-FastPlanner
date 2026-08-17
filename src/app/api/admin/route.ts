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
import { readAiConfigRecord, writeAiConfig } from '@/lib/db/ai-config';
import { aiConfigProblem, parseAiConfig } from '@/lib/ai/config';
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

  if (view === 'ai') {
    /*
     * 화면은 **적어 둔 값**과 **지금 실제로 도는 값**을 나란히 봐야 한다.
     * 빈 칸은 환경변수를 따르므로, 적어 둔 것만 보면 무엇이 도는지 알 수 없다.
     */
    const record = await readAiConfigRecord();
    const basic = resolveProvider('basic', record.config);
    const advanced = resolveProvider('advanced', record.config);
    return NextResponse.json({
      config: record.config,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      effective: {
        provider: basic.id,
        enabled: isAiEnabled(record.config),
        baseUrl: basic.baseUrl,
        models: { basic: basic.model, advanced: advanced.model },
        effort: basic.effort,
        maxOutputTokens: basic.maxOutputTokens,
        /** 키는 절대 안 내보낸다. **있는지 없는지**만 알려 준다. */
        hasKey: Boolean(basic.apiKey),
      },
    });
  }

  if (view === 'health') {
    const over = (await readAiConfigRecord()).config;
    const basic = resolveProvider('basic', over);
    const advanced = resolveProvider('advanced', over);
    return NextResponse.json({
      storage: storageInfo(),
      signup: signupMode(),
      ai: {
        enabled: isAiEnabled(over),
        /*
         * 여기서는 공급자와 모델을 **보여도 된다.** 사용자에게 감추는 규칙은
         * 일반 화면에 대한 것이고, 관리자는 무엇이 도는지 알아야 고칠 수 있다.
         *
         * 등급마다 어떤 모델이 걸렸는지를 **짝으로** 보여 준다. 하나만 보여 주면
         * 환경변수를 한쪽만 넣어 둔 것을 못 잡는다.
         */
        provider: basic.id,
        engines: { basic: basic.model, advanced: advanced.model },
        maxOutputTokens: basic.maxOutputTokens,
      },
      stitch: process.env.STITCH_MCP_URL || 'https://stitch.googleapis.com/mcp',
      authSecret: Boolean(process.env.AUTH_SECRET),
    });
  }

  return NextResponse.json(await adminOverview());
}

/** 크레딧을 되돌려 주거나, AI 설정을 고친다. */
export async function POST(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return notFound();

  let body: { userId?: unknown; amount?: unknown; action?: unknown; config?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  if (body.action === 'ai') {
    /*
     * 잘못된 값은 **조용히 고치지 않고 되돌려 보낸다.** 말없이 버리면 저장이 된
     * 줄 알고 나가는데, 실제로는 예전 값이 계속 돈다.
     */
    const problem = aiConfigProblem(body.config);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const saved = await writeAiConfig(parseAiConfig(body.config), admin.email);
    console.warn(`[admin] ${admin.email} 이(가) AI 설정을 고쳤습니다.`);
    return NextResponse.json({ ok: true, config: saved });
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
