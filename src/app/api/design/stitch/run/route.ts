/**
 * 고른 화면들을 스티치에 **실제로 만든다.**
 *
 * 화면 하나에 수십 초가 걸리므로 다 끝나기를 기다렸다가 한 번에 주면 사용자는
 * 아무것도 없는 화면을 오래 본다. 그래서 산출물 생성과 같은 방식으로 **한 줄에
 * 하나씩(NDJSON)** 흘려보낸다.
 *
 * 중간에 실패한 화면이 있어도 멈추지 않는다 — 되는 것까지는 만들어 두는 편이
 * 낫다. 무엇이 안 됐는지는 줄마다 남긴다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { readIntegrationSecret } from '@/lib/db/integrations';
import { screenPrompt, systemPrompt } from '@/lib/design-handoff';
import {
  createProject,
  generateScreen,
  projectUrl,
  StitchError,
  type StitchCredential,
  type StitchDevice,
} from '@/lib/design/stitch';
import type { IaPage, Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** 한 번에 너무 많이 걸면 시간 안에 못 끝내고 사용량만 태운다. */
const MAX_SCREENS = 8;

interface RunBody {
  plan?: Plan;
  pageIds?: string[];
}

function deviceOf(plan: Plan, page: IaPage): StitchDevice {
  const wireframe = plan.wireframes?.find((w) => w.pageId === page.id);
  if (wireframe?.device === 'desktop') return 'DESKTOP';
  if (wireframe?.device === 'mobile') return 'MOBILE';
  return plan.brief?.platform === 'app' ? 'MOBILE' : 'DESKTOP';
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: RunBody;
  try {
    body = (await request.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan?.id) return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });

  const wanted = new Set(body.pageIds ?? []);
  const pages = (plan.iaPages ?? []).filter((p) => p.type === 'page' && wanted.has(p.id));
  if (pages.length === 0) {
    return NextResponse.json({ error: '만들 화면을 골라 주세요.' }, { status: 400 });
  }
  if (pages.length > MAX_SCREENS) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_SCREENS}개까지 만들 수 있습니다.` },
      { status: 400 },
    );
  }

  let secret: string | null = null;
  try {
    secret = await readIntegrationSecret(user.id, 'stitch');
  } catch {
    secret = null;
  }
  if (!secret) {
    return NextResponse.json(
      { error: '스티치가 연결돼 있지 않습니다. 먼저 연결해 주세요.' },
      { status: 409 },
    );
  }

  /*
   * 값만 보고 어느 방식인지 가른다. 구글 액세스 토큰은 `ya29.` 로 시작하고,
   * 클라우드 API 키는 `AIza` 로 시작한다. 애매하면 토큰으로 본다 — 스티치가
   * 키를 안 받는 경우가 있어 그쪽이 실패 문구가 더 친절하다.
   */
  const cred: StitchCredential = {
    kind: /^AIza[0-9A-Za-z_-]{10,}$/.test(secret) ? 'apikey' : 'oauth',
    secret,
    quotaProject: process.env.STITCH_QUOTA_PROJECT || undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* 이미 닫힌 스트림 */
        }
      };

      try {
        send({ type: 'start', total: pages.length });

        const title = plan.brief?.title?.trim() || '무제 플랜';
        const projectId = await createProject(title, cred, request.signal);
        send({ type: 'project', projectId, url: projectUrl(projectId) });

        /*
         * 톤을 먼저 잡는 문장을 첫 화면 요청 앞에 붙인다. 화면마다 따로 만들면
         * 색·글꼴이 제각각이 되는데, 스티치에는 "이전 대화" 개념이 없어서
         * 첫 요청에 함께 넣어 두는 것이 가장 확실하다.
         */
        const tone = systemPrompt(plan, 'stitch');

        let made = 0;
        for (const [index, page] of pages.entries()) {
          if (request.signal.aborted) break;
          send({ type: 'screen-start', pageId: page.id, name: page.name, index });

          const prompt =
            index === 0 ? `${tone}\n\n---\n\n${screenPrompt(plan, page, 'stitch')}` : screenPrompt(plan, page, 'stitch');

          try {
            const screen = await generateScreen(projectId, prompt, deviceOf(plan, page), cred, request.signal);
            made += 1;
            send({ type: 'screen-done', pageId: page.id, name: page.name, ...screen });
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') break;
            const message =
              error instanceof StitchError ? error.message : '이 화면을 만들지 못했습니다.';
            send({ type: 'screen-failed', pageId: page.id, name: page.name, message });
            // 자격증명 문제라면 남은 화면도 전부 같은 이유로 실패한다. 여기서 멈춘다.
            if (error instanceof StitchError && error.kind === 'auth') {
              send({ type: 'error', message });
              break;
            }
          }
        }

        send({ type: 'done', made, total: pages.length, projectId, url: projectUrl(projectId) });
      } catch (error) {
        if (!request.signal.aborted) {
          const message =
            error instanceof StitchError
              ? error.message
              : '스티치에 화면을 만들지 못했습니다.';
          send({ type: 'error', message });
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
      'x-accel-buffering': 'no',
    },
  });
}
