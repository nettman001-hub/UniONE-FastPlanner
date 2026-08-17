/**
 * 계정마다 고른 것들 — 지금은 만들기 엔진 하나.
 *
 * **모델 이름은 오가지 않는다.** 브라우저는 `basic` / `advanced` 만 알고,
 * 그것이 어떤 모델인지는 서버(`lib/ai/provider.ts`)만 안다.
 */

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { readSettings, writeSettings } from '@/lib/db/user-settings';
import { isEngineTier } from '@/lib/ai/engines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;
  return NextResponse.json({ settings: await readSettings(user.id) });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { engine?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  if (body.engine !== undefined && !isEngineTier(body.engine)) {
    return NextResponse.json({ error: '없는 엔진입니다.' }, { status: 400 });
  }

  const patch = body.engine === undefined ? {} : { engine: body.engine };
  return NextResponse.json({ settings: await writeSettings(user.id, patch) });
}
