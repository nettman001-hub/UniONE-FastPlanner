/**
 * 생성 파이프라인.
 *
 * 한 요청 안에서 단계를 순서대로 돌면서, **끝나는 대로 결과를 흘려보낸다.**
 * 브라우저는 그때그때 받아 문서에 반영하므로, 5단계가 다 끝나기를 기다리지 않는다.
 *
 * 서버 메모리에 작업을 쌓아 두고 나중에 찾아가게 하던 방식은 서버리스에서 깨졌다.
 * 등록한 인스턴스와 조회하는 인스턴스가 달라 "작업을 찾을 수 없음"이 났다.
 * 한 요청 안에서 끝내면 인스턴스가 갈릴 일이 없다.
 *
 * 창을 닫으면 요청이 끊기고 `signal.aborted` 가 서므로, **다음 단계로 넘어가지 않는다.**
 * 지금 돌던 단계는 마친다 — 이미 모델을 부른 뒤라 버리면 그만큼이 낭비다.
 * 그때까지 흘려보낸 결과는 브라우저가 이미 저장했으므로 남는다.
 */

import { generateJson, isAiEnabled } from '@/lib/ai/client';
import { generateLocally } from '@/lib/ai/local-generator';
import { ARTIFACT_SCHEMA } from '@/lib/ai/schemas';
import { buildPrompt } from '@/lib/ai/prompts';
import { draftToPatch } from '@/lib/ai/apply';
import type { ArtifactKey, Plan, PlanDocuments } from '@/lib/types';

/**
 * 단계마다 넣을 지연(ms). 기본 0 — 평소에는 아무 영향이 없다.
 *
 * 키 없이 내장 생성기로 돌면 한 단계가 순식간에 끝나 진행 중 동작(중단·이어 하기)을
 * 눈으로 확인할 수 없다. 시연하거나 검증할 때만 켠다.
 */
const STEP_DELAY_MS = Math.max(0, Number(process.env.GENERATE_STEP_DELAY_MS ?? 0) || 0);

/** 산출물별 출력 분량이 크게 달라 토큰 상한을 따로 잡는다. */
const MAX_TOKENS: Record<ArtifactKey, number> = {
  prd: 16000,
  fs: 32000,
  ia: 20000,
  flow: 20000,
  wireframe: 32000,
};

export interface GenerateOptions {
  extra?: string;
  pageIds?: string[];
  merge?: boolean;
}

/** 브라우저로 흘려보내는 사건. 한 줄에 하나씩(NDJSON) 나간다. */
export type StreamEvent =
  | { type: 'start'; artifact: ArtifactKey }
  | {
      type: 'step';
      artifact: ArtifactKey;
      patch: Partial<PlanDocuments>;
      source: 'ai' | 'local';
      /** AI 가 실패해 내장 생성기로 대체했다면 그 사유 */
      warning?: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** 앞 단계 결과를 반영한 사본. 다음 단계 프롬프트가 이걸 컨텍스트로 쓴다. */
function withPatch(plan: Plan, patch: Partial<PlanDocuments>): Plan {
  return { ...plan, ...patch };
}

/** 만들 수 있는 상태인지. 못 만들면 사유를 돌려준다. */
export function precondition(plan: Plan, artifact: ArtifactKey): string | null {
  if (!plan?.brief?.idea?.trim()) return '서비스 아이디어가 비어 있어 생성할 수 없습니다.';
  if (artifact === 'ia' && plan.features.length === 0)
    return '정보구조도를 만들려면 기능명세서를 먼저 생성해 주세요.';
  if ((artifact === 'flow' || artifact === 'wireframe') && plan.iaPages.length === 0)
    return '이 산출물을 만들려면 정보구조도를 먼저 생성해 주세요.';
  return null;
}

/** 한 단계 생성. AI 가 실패하면 내장 생성기로 대체하고 사유를 함께 돌려준다. */
async function runStep(
  plan: Plan,
  artifact: ArtifactKey,
  options: GenerateOptions,
): Promise<{ patch: Partial<PlanDocuments>; source: 'ai' | 'local'; warning?: string }> {
  const useAi = isAiEnabled();

  const toPatch = (draft: unknown) =>
    draftToPatch(artifact, draft, plan, {
      mergeWireframes: artifact === 'wireframe' && options.merge === true,
    });

  if (!useAi) {
    return { patch: toPatch(generateLocally(artifact, plan.brief, plan, options)), source: 'local' };
  }

  try {
    let prompt = buildPrompt(plan, artifact, options.extra);
    if (artifact === 'wireframe') {
      const targets =
        options.pageIds && options.pageIds.length > 0
          ? plan.iaPages.filter((p) => options.pageIds!.includes(p.id))
          : plan.iaPages.slice(0, 10);
      prompt += `\n\n## 와이어프레임을 만들 페이지\n${targets
        .map((p) => `- ${p.id} ${p.name} (${p.path}) — ${p.description}`)
        .join('\n')}`;
    }
    const draft = await generateJson({
      prompt,
      schema: ARTIFACT_SCHEMA[artifact],
      maxTokens: MAX_TOKENS[artifact],
    });
    return { patch: toPatch(draft), source: 'ai' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다.';
    // AI 가 실패해도 내장 생성기로 결과를 내어 파이프라인이 멈추지 않게 한다.
    return {
      patch: toPatch(generateLocally(artifact, plan.brief, plan, options)),
      source: 'local',
      warning: message,
    };
  }
}

/**
 * 산출물을 순서대로 만들며 결과를 하나씩 내보낸다.
 *
 * `signal` 이 끊기면 **다음 단계로 넘어가지 않는다.** 브라우저가 사라졌다는 뜻이므로
 * 쓰지도 않을 것을 계속 만들지 않는다.
 */
export async function* runPipeline(
  basePlan: Plan,
  artifacts: ArtifactKey[],
  options: GenerateOptions,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let working = basePlan;

  for (const artifact of artifacts) {
    if (signal?.aborted) return;

    const blocked = precondition(working, artifact);
    if (blocked) {
      yield { type: 'error', message: blocked };
      return;
    }

    yield { type: 'start', artifact };

    try {
      if (STEP_DELAY_MS > 0) await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      const result = await runStep(working, artifact, options);
      working = withPatch(working, result.patch);
      yield {
        type: 'step',
        artifact,
        patch: result.patch,
        source: result.source,
        ...(result.warning ? { warning: result.warning } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다.';
      yield { type: 'error', message };
      return;
    }
  }

  yield { type: 'done' };
}
