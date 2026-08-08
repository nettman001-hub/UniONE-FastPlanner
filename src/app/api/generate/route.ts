import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { precondition, runPipeline } from '@/lib/jobs/queue';
import { activeSkills } from '@/lib/db/skills';
import type { ArtifactKey, Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

interface GenerateBody {
  /** 한 종만 만들 때 */
  artifact?: ArtifactKey;
  /** 순서대로 이어서 만들 때 (전체 자동 생성) */
  artifacts?: ArtifactKey[];
  plan: Plan;
  /** 사용자가 추가로 준 지시 */
  extra?: string;
  /** 와이어프레임을 만들 대상 페이지 */
  pageIds?: string[];
  /** 기존 와이어프레임을 유지하고 병합할지 */
  merge?: boolean;
}

/**
 * 산출물을 만들며 결과를 **한 줄에 하나씩(NDJSON) 흘려보낸다.**
 *
 * 브라우저는 단계가 끝나는 대로 받아 문서에 반영하므로, 5단계가 다 끝나기를 기다리지
 * 않는다. 창을 닫으면 연결이 끊기고 서버는 다음 단계로 넘어가지 않는다.
 */
export async function POST(request: Request) {
  // 이 요청은 주인의 AI API 키를 쓴다. 로그인한 사람만 부를 수 있어야 한다.
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const { plan } = body;
  const artifacts = body.artifacts ?? (body.artifact ? [body.artifact] : []);

  if (artifacts.length === 0 || artifacts.some((a) => !VALID.includes(a))) {
    return NextResponse.json({ error: '지원하지 않는 산출물입니다.' }, { status: 400 });
  }
  if (!plan?.id) {
    return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });
  }

  // 첫 단계는 지금 바로 판단할 수 있다. 뒤 단계는 앞 결과에 달렸으므로 흐름 안에서 본다.
  const blocked = precondition(plan, artifacts[0]);
  if (blocked) {
    const status = plan.brief?.idea?.trim() ? 409 : 400;
    return NextResponse.json({ error: blocked }, { status });
  }

  /*
   * 작성 지침은 **서버가 계정에서 읽는다.** 브라우저가 보내게 하면 남의 지침을
   * 넣거나, 울타리를 우회하는 문장을 끼워 넣을 수 있다.
   *
   * 플랜 번호를 함께 넘겨, 이 플랜에만 적어 둔 것이 있으면 그것을 쓴다.
   * 번호는 브라우저가 보낸 것이지만 **내 `user_id` 아래에서만 찾으므로**
   * 남의 지침이 딸려 올 수는 없다.
   */
  const skills = await activeSkills(user.id, plan.id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runPipeline(
          plan,
          artifacts,
          { extra: body.extra, pageIds: body.pageIds, merge: body.merge, skills, userId: user.id },
          request.signal,
        )) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        // 연결이 끊긴 뒤의 쓰기 실패는 정상 종료로 본다.
        if (!request.signal.aborted) {
          const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다.';
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`));
          } catch {
            /* 이미 닫힌 스트림 */
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* 이미 닫힌 스트림 */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // 프록시가 스트림을 모아서 한 번에 보내지 않도록.
      'x-accel-buffering': 'no',
    },
  });
}
