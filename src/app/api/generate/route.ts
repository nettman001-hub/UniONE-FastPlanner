import { NextResponse } from 'next/server';
import { generateJson, hasApiKey } from '@/lib/ai/client';
import { generateLocally } from '@/lib/ai/local-generator';
import { ARTIFACT_SCHEMA } from '@/lib/ai/schemas';
import { buildPrompt } from '@/lib/ai/prompts';
import { draftToPatch } from '@/lib/ai/apply';
import type { ArtifactKey, Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

interface GenerateBody {
  artifact: ArtifactKey;
  plan: Plan;
  /** 사용자가 추가로 준 지시 */
  extra?: string;
  /** 와이어프레임을 만들 대상 페이지 */
  pageIds?: string[];
  /** 기존 와이어프레임을 유지하고 병합할지 */
  merge?: boolean;
}

/** 산출물별 출력 분량이 크게 달라 토큰 상한을 따로 잡는다. */
const MAX_TOKENS: Record<ArtifactKey, number> = {
  prd: 16000,
  fs: 32000,
  ia: 20000,
  flow: 20000,
  wireframe: 32000,
};

export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const { artifact, plan } = body;

  if (!artifact || !VALID.includes(artifact)) {
    return NextResponse.json({ error: '지원하지 않는 산출물입니다.' }, { status: 400 });
  }
  if (!plan?.brief?.idea?.trim()) {
    return NextResponse.json(
      { error: '서비스 아이디어가 비어 있어 생성할 수 없습니다.' },
      { status: 400 },
    );
  }
  if (artifact === 'ia' && plan.features.length === 0) {
    return NextResponse.json(
      { error: '정보구조도를 만들려면 기능명세서를 먼저 생성해 주세요.' },
      { status: 409 },
    );
  }
  if ((artifact === 'flow' || artifact === 'wireframe') && plan.iaPages.length === 0) {
    return NextResponse.json(
      { error: '이 산출물을 만들려면 정보구조도를 먼저 생성해 주세요.' },
      { status: 409 },
    );
  }

  const useAi = hasApiKey();

  try {
    let draft: unknown;

    if (useAi) {
      let prompt = buildPrompt(plan, artifact, body.extra);
      if (artifact === 'wireframe') {
        const targets =
          body.pageIds && body.pageIds.length > 0
            ? plan.iaPages.filter((p) => body.pageIds!.includes(p.id))
            : plan.iaPages.slice(0, 10);
        prompt += `\n\n## 와이어프레임을 만들 페이지\n${targets
          .map((p) => `- ${p.id} ${p.name} (${p.path}) — ${p.description}`)
          .join('\n')}`;
      }
      draft = await generateJson({
        prompt,
        schema: ARTIFACT_SCHEMA[artifact],
        maxTokens: MAX_TOKENS[artifact],
      });
    } else {
      draft = generateLocally(artifact, plan.brief, plan, { pageIds: body.pageIds });
    }

    const patch = draftToPatch(artifact, draft, plan, {
      mergeWireframes: artifact === 'wireframe' && body.merge === true,
    });

    return NextResponse.json({ patch, source: useAi ? 'ai' : 'local' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다.';
    // AI 호출이 실패해도 내장 생성기로 결과를 돌려주어 흐름이 끊기지 않게 한다.
    try {
      const draft = generateLocally(artifact, plan.brief, plan, { pageIds: body.pageIds });
      const patch = draftToPatch(artifact, draft, plan, {
        mergeWireframes: artifact === 'wireframe' && body.merge === true,
      });
      return NextResponse.json({ patch, source: 'local', warning: message });
    } catch {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
}
