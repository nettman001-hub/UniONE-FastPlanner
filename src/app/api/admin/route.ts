/**
 * 관리자 자료.
 *
 * **관리자가 아니면 404 를 준다.** 403 은 "여기 뭔가 있다" 를 알려 주는 셈이다.
 * 있는지조차 모르는 편이 낫다.
 */

import { NextResponse } from 'next/server';

import { currentAdmin } from '@/lib/auth/admin';
import { adminOverview, adminPlanBody, adminUserPlans, adminUsers, grantCredits } from '@/lib/db/admin';
import { storageInfo } from '@/lib/db';
import { isAiEnabled, resolveProvider } from '@/lib/ai/client';
import { readAiConfigRecord, readAiKey, writeAiConfig } from '@/lib/db/ai-config';
import { aiConfigProblem, parseAiConfig } from '@/lib/ai/config';
import { signupMode } from '@/lib/auth/policy';
import { passwordProblem } from '@/lib/auth/rules';

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

  if (view === 'plans') {
    const userId = (params.get('userId') ?? '').trim();
    if (!userId) return NextResponse.json({ error: '누구의 플랜인지 없습니다.' }, { status: 400 });
    // 목록에는 본문이 담기지 않는다. 제목·시각·진행 상태뿐이다(lib/db/admin.ts 참고).
    return NextResponse.json({ plans: await adminUserPlans(userId) });
  }

  if (view === 'plan') {
    /*
     * 기획서 본문. **고른 하나만, 열 때만 간다.**
     *
     * 목록에 본문을 섞지 않은 이유가 여기 있다 — 관리자가 목록을 열었다고 해서
     * 그 사람의 기획서를 다 본 것이 되면 안 된다. 본 것은 본 것으로 남긴다.
     */
    const userId = (params.get('userId') ?? '').trim();
    const planId = (params.get('planId') ?? '').trim();
    if (!userId || !planId) {
      return NextResponse.json({ error: '어느 플랜인지 없습니다.' }, { status: 400 });
    }

    const found = await adminPlanBody(userId, planId);
    /*
     * 없는 것과 남의 것을 **구분해서 알려 주지 않는다.** 주인이 다르면 404 와
     * 403 이 갈리는데, 그 차이만으로 "이 id 는 존재한다" 가 새어 나간다.
     */
    if (!found) return notFound();

    /*
     * 누가 누구의 무엇을 열었는지 남긴다. 값은 남기지 않는다 — 기록하려고
     * 본문을 한 번 더 흘리면 남기는 일이 새는 일이 된다.
     */
    console.warn(`[admin] ${admin.email} 이(가) ${userId} 의 플랜 ${planId} 본문을 열었습니다.`);
    return NextResponse.json({ plan: found });
  }

  if (view === 'ai') {
    /*
     * 화면은 **적어 둔 값**과 **지금 실제로 도는 값**을 나란히 봐야 한다.
     * 빈 칸은 환경변수를 따르므로, 적어 둔 것만 보면 무엇이 도는지 알 수 없다.
     */
    const record = await readAiConfigRecord();
    const savedKey = await readAiKey();
    const basic = resolveProvider('basic', record.config, savedKey);
    const advanced = resolveProvider('advanced', record.config, savedKey);
    return NextResponse.json({
      config: record.config,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      effective: {
        provider: basic.id,
        enabled: isAiEnabled(record.config, savedKey),
        baseUrl: basic.baseUrl,
        models: { basic: basic.model, advanced: advanced.model },
        effort: basic.effort,
        maxOutputTokens: basic.maxOutputTokens,
        /** 키는 절대 안 내보낸다. **있는지 없는지**와 어디서 왔는지만 알려 준다. */
        hasKey: Boolean(basic.apiKey),
        keyFrom: savedKey ? ('screen' as const) : basic.apiKey ? ('env' as const) : ('none' as const),
      },
    });
  }

  if (view === 'health') {
    const over = (await readAiConfigRecord()).config;
    // 여기서도 화면에서 넣은 키를 봐야 한다. 안 보면 "꺼짐" 으로 잘못 나온다.
    const savedKey = await readAiKey();
    const basic = resolveProvider('basic', over, savedKey);
    const advanced = resolveProvider('advanced', over, savedKey);
    return NextResponse.json({
      storage: storageInfo(),
      signup: signupMode(),
      ai: {
        enabled: isAiEnabled(over, savedKey),
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

  let body: {
    userId?: unknown;
    amount?: unknown;
    action?: unknown;
    config?: unknown;
    apiKey?: unknown;
    newPassword?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  if (body.action === 'reset_password') {
    const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!targetUserId) return NextResponse.json({ error: '사용자 ID가 없습니다.' }, { status: 400 });
    const problem = passwordProblem(newPassword);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const { adminSetUserPassword } = await import('@/lib/db/users');
    const res = await adminSetUserPassword(targetUserId, newPassword);
    if (res === 'no-user') return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

    console.warn(`[admin] ${admin.email} 이(가) ${targetUserId} 의 비밀번호를 재설정했습니다.`);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'ai') {
    /*
     * 잘못된 값은 **조용히 고치지 않고 되돌려 보낸다.** 말없이 버리면 저장이 된
     * 줄 알고 나가는데, 실제로는 예전 값이 계속 돈다.
     */
    const problem = aiConfigProblem(body.config);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    /*
     * 키는 세 가지 뜻이 있다.
     *   보내지 않음 — 건드리지 않는다. 다른 칸만 고칠 때 매번 다시 치게 하면 안 된다.
     *   null        — 지운다. 환경변수로 되돌아간다.
     *   문자열      — 그 값으로 새로 넣는다.
     */
    let apiKey: string | null | undefined;
    if (body.apiKey === null) apiKey = null;
    else if (typeof body.apiKey === 'string' && body.apiKey.trim()) apiKey = body.apiKey;
    if (typeof apiKey === 'string' && apiKey.trim().length > 400) {
      return NextResponse.json({ error: 'API 키가 너무 깁니다.' }, { status: 400 });
    }

    const saved = await writeAiConfig(parseAiConfig(body.config), admin.email, apiKey);
    // 키를 건드렸는지도 남긴다. 값은 절대 안 남긴다.
    const keyNote = apiKey === null ? ' (키 삭제)' : apiKey ? ' (키 교체)' : '';
    console.warn(`[admin] ${admin.email} 이(가) AI 설정을 고쳤습니다.${keyNote}`);
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
