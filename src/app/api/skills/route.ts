/**
 * 기획 스킬 읽기·저장. 내 것만 만진다.
 *
 * 자리(scope)가 둘이다 — `planId` 가 없으면 **계정 기본**, 있으면 **그 플랜만**.
 */

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { clearSkill, listSkills, saveSkill } from '@/lib/db/skills';
import { ACCOUNT_SCOPE, SKILL_MAX_CHARS, isSkillArtifact } from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 플랜 ID 는 브라우저가 만든다. 길이만 본다. */
const MAX_PLAN_ID = 128;

/**
 * `plans` 표에 실제로 있는지는 **확인하지 않는다.**
 *
 * 플랜은 브라우저에서 먼저 만들어지고 1.2초쯤 뒤에 서버로 올라간다. 있는지
 * 따지면 방금 만든 플랜에는 지침을 못 적는다. 그리고 이 줄은 어차피 내
 * `user_id` 아래에만 생기므로, 아무 문자열이나 넣어도 남의 것을 건드리지 못한다.
 */
function scopeOf(value: string | null): string | null {
  const planId = (value ?? '').trim();
  if (!planId) return ACCOUNT_SCOPE;
  return planId.length <= MAX_PLAN_ID ? planId : null;
}

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const scope = scopeOf(new URL(request.url).searchParams.get('planId'));
  if (scope === null) {
    return NextResponse.json({ error: '플랜을 알 수 없습니다.' }, { status: 400 });
  }

  if (scope === ACCOUNT_SCOPE) {
    return NextResponse.json({ skills: await listSkills(user.id) });
  }

  /*
   * 플랜 화면은 **둘 다** 필요하다. 이 플랜에 적어 둔 것과, `기본을 따름` 일 때
   * 실제로 들어갈 계정 기본. 안 보여 주면 "기본을 따름" 이 무슨 글인지 모른 채
   * 고르게 된다. 어차피 같은 표라 한 번에 준다.
   */
  const [skills, defaults] = await Promise.all([
    listSkills(user.id, scope),
    listSkills(user.id, ACCOUNT_SCOPE),
  ]);
  return NextResponse.json({ skills, defaults });
}

export async function PUT(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { artifact?: unknown; body?: unknown; enabled?: unknown; planId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  if (!isSkillArtifact(body.artifact)) {
    return NextResponse.json({ error: '어느 단계의 지침인지 알 수 없습니다.' }, { status: 400 });
  }
  const scope = scopeOf(typeof body.planId === 'string' ? body.planId : null);
  if (scope === null) {
    return NextResponse.json({ error: '플랜을 알 수 없습니다.' }, { status: 400 });
  }
  const text = typeof body.body === 'string' ? body.body : '';
  if (text.length > SKILL_MAX_CHARS) {
    return NextResponse.json(
      { error: `지침은 ${SKILL_MAX_CHARS.toLocaleString()}자까지입니다.` },
      { status: 400 },
    );
  }

  await saveSkill(user.id, scope, body.artifact, text, body.enabled !== false);
  return NextResponse.json({ ok: true });
}

/** 플랜에 적어 둔 것을 지워 다시 계정 기본을 따르게 한다. */
export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const params = new URL(request.url).searchParams;
  const scope = scopeOf(params.get('planId'));
  if (scope === null || scope === ACCOUNT_SCOPE) {
    // 계정 기본은 이 길로 지우지 않는다 — 지우려면 내용을 비우고 저장하면 된다.
    return NextResponse.json({ error: '어느 플랜인지 알 수 없습니다.' }, { status: 400 });
  }
  const artifact = params.get('artifact');
  if (!isSkillArtifact(artifact)) {
    return NextResponse.json({ error: '어느 단계의 지침인지 알 수 없습니다.' }, { status: 400 });
  }

  await clearSkill(user.id, scope, artifact);
  return NextResponse.json({ ok: true });
}
