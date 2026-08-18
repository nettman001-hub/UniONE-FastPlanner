/**
 * 계정마다 고른 것들 — 만들기 엔진.
 *
 * **모델 이름은 오가지 않는다.** 브라우저는 `basic` / `advanced` 만 알고,
 * 그것이 어떤 모델인지는 서버(`lib/ai/provider.ts`)만 안다.
 *
 * 엔진은 **단계마다 따로** 정한다(`engines`). `engine` 은 단계가 아닌 것들
 * (에이전트 대화·기능 배치·브리프 질문)이 쓰는 값이다.
 */

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { readSettings, writeSettings, type EngineMap } from '@/lib/db/user-settings';
import { isEngineTier } from '@/lib/ai/engines';
import { ARTIFACT_KEYS, type ArtifactKey } from '@/lib/types';

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

  let body: { engine?: unknown; engines?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  if (body.engine !== undefined && !isEngineTier(body.engine)) {
    return NextResponse.json({ error: '없는 엔진입니다.' }, { status: 400 });
  }

  /*
   * 단계별 값은 **모르는 것이 하나라도 있으면 통째로 되돌려 보낸다.**
   * 조용히 걸러 내면 저장됐다고 알고 나가는데 그 단계만 예전 값으로 돈다.
   */
  let engines: Partial<EngineMap> | undefined;
  if (body.engines !== undefined) {
    if (typeof body.engines !== 'object' || body.engines === null || Array.isArray(body.engines)) {
      return NextResponse.json({ error: '단계별 엔진이 올바르지 않습니다.' }, { status: 400 });
    }
    const raw = body.engines as Record<string, unknown>;
    const picked: Partial<EngineMap> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!ARTIFACT_KEYS.includes(key as ArtifactKey)) {
        return NextResponse.json({ error: `없는 단계입니다: ${key}` }, { status: 400 });
      }
      if (!isEngineTier(value)) {
        return NextResponse.json({ error: '없는 엔진입니다.' }, { status: 400 });
      }
      picked[key as ArtifactKey] = value;
    }
    engines = picked;
  }

  const patch = {
    ...(body.engine === undefined ? {} : { engine: body.engine }),
    ...(engines === undefined ? {} : { engines }),
  };
  return NextResponse.json({ settings: await writeSettings(user.id, patch) });
}
