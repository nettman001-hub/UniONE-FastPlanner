import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { deletePlan, getPlan, savePlan } from '@/lib/db/plans';
import type { Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const { id } = await params;
  try {
    const plan = await getPlan(user.id, id);
    if (!plan) return NextResponse.json({ error: '플랜을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

/**
 * 플랜 하나를 저장한다.
 *
 * `applied: false` 는 실패가 아니라 "서버에 더 새 내용이 있어 건너뛰었다" 는 뜻이다.
 */
export async function PUT(request: Request, { params }: Context) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const { id } = await params;
  let body: { plan?: Plan };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan?.id) return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });
  // 주소의 ID 를 정답으로 본다.
  if (plan.id !== id) plan.id = id;

  try {
    return NextResponse.json({ applied: await savePlan(user.id, plan) });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const { id } = await params;
  try {
    // 이미 없으면 없는 대로 성공이다 — 두 번 눌러도 같은 결과여야 한다.
    return NextResponse.json({ deleted: await deletePlan(user.id, id) });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : '저장소에 접근하지 못했습니다.';
}
