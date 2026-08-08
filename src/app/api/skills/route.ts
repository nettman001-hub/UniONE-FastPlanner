/** 기획 스킬 읽기·저장. 내 것만 만진다. */

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { listSkills, saveSkill } from '@/lib/db/skills';
import { SKILL_MAX_CHARS, isSkillArtifact } from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;
  return NextResponse.json({ skills: await listSkills(user.id) });
}

export async function PUT(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { artifact?: unknown; body?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  if (!isSkillArtifact(body.artifact)) {
    return NextResponse.json({ error: '어느 단계의 지침인지 알 수 없습니다.' }, { status: 400 });
  }
  const text = typeof body.body === 'string' ? body.body : '';
  if (text.length > SKILL_MAX_CHARS) {
    return NextResponse.json(
      { error: `지침은 ${SKILL_MAX_CHARS.toLocaleString()}자까지입니다.` },
      { status: 400 },
    );
  }

  await saveSkill(user.id, body.artifact, text, body.enabled !== false);
  return NextResponse.json({ ok: true });
}
