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
import { resolveProvider } from '@/lib/ai/provider';
import { DEFAULT_ENGINE, type EngineTier } from '@/lib/ai/engines';
import { DEEPSEEK_OUTPUT_TOKENS } from '@/lib/ai/config';
import type { AiConfig } from '@/lib/ai/config';
import { readAiRuntime } from '@/lib/db/ai-config';
import { aiErrorMessage } from '@/lib/ai/errors';
import { generateLocally } from '@/lib/ai/local-generator';
import { ARTIFACT_SCHEMA } from '@/lib/ai/schemas';
import { buildPrompt } from '@/lib/ai/prompts';
import { draftToPatch } from '@/lib/ai/apply';
import { canAfford, spendCredits } from '@/lib/db/credits';
import type { SkillMap } from '@/lib/skills';
import { costOfArtifact } from '@/lib/credits';
import { ARTIFACT_LABEL } from '@/lib/types';
import type { ArtifactKey, Plan, PlanDocuments } from '@/lib/types';

/**
 * 단계마다 넣을 지연(ms). 기본 0 — 평소에는 아무 영향이 없다.
 *
 * 키 없이 내장 생성기로 돌면 한 단계가 순식간에 끝나 진행 중 동작(중단·이어 하기)을
 * 눈으로 확인할 수 없다. 시연하거나 검증할 때만 켠다.
 */
const STEP_DELAY_MS = Math.max(0, Number(process.env.GENERATE_STEP_DELAY_MS ?? 0) || 0);

/**
 * 어떤 산출물이든 DeepSeek에는 384K를 요청한다. `ceiling`은 다른 공급자의
 * 실제 제한만 보존하기 위한 안전장치다.
 */
export function maxTokensFor(_artifact: ArtifactKey, ceiling: number): number {
  return Math.min(DEEPSEEK_OUTPUT_TOKENS, ceiling);
}

export interface GenerateOptions {
  extra?: string;
  pageIds?: string[];
  merge?: boolean;
  /**
   * 사용자가 설정에 적어 둔 단계별 작성 지침.
   *
   * 브라우저가 보내는 것이 아니라 **서버가 계정에서 읽어 넣는다.** 브라우저가
   * 보내게 하면 남의 지침을 넣거나 울타리를 우회하는 문장을 끼워 넣을 수 있다.
   */
  skills?: SkillMap;
  /**
   * 크레딧을 치를 계정. **서버에서만 채운다.**
   *
   * 비어 있으면 셈을 건너뛴다 — 검사나 내부 호출에서 쓴다.
   */
  userId?: string;
  /**
   * 어느 엔진으로 만들지. 계정 설정에서 서버가 읽어 넣는다.
   *
   * 브라우저가 보내게 하지 않는 이유는 지침과 같다 — 요청을 손보면 값을 더 낸다는
   * 비싼 쪽을 마음대로 부를 수 있게 된다.
   */
  engine?: EngineTier;
  /**
   * 단계마다 고른 등급. 여기 있는 단계는 `engine` 대신 이 값을 쓴다.
   *
   * 사용자는 프로덕트 요구사항만 고급으로 뽑고 나머지는 기본으로 넘기는 식으로
   * 섞어 쓴다. 파이프라인 한 번에 서로 다른 등급이 돌 수 있다는 뜻이다.
   */
  engines?: Partial<Record<ArtifactKey, EngineTier>>;
  /**
   * 관리자가 화면에서 고친 AI 설정. 파이프라인이 시작할 때 **한 번만** 읽어
   * 단계마다 돌려 쓴다 — 5단계면 같은 질의를 다섯 번 할 이유가 없다.
   */
  config?: AiConfig;
  /** 화면에서 넣어 둔 API 키. 설정과 함께 서버가 읽어 넣는다. */
  apiKey?: string;
}

/**
 * 이 단계를 어느 등급으로 만들 것인가.
 *
 * **값을 매기는 자리와 부르는 자리가 같은 함수를 봐야 한다.** 갈리면 기본으로
 * 만들어 놓고 고급 값을 물리거나 그 반대가 된다.
 */
export function engineFor(artifact: ArtifactKey, options: GenerateOptions): EngineTier {
  return options.engines?.[artifact] ?? options.engine ?? DEFAULT_ENGINE;
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

/**
 * 플로우를 **더** 만들 때 프롬프트에 덧붙이는 지시.
 *
 * 그냥 한 번 더 시키면 모델은 이미 만든 것과 거의 같은 플로우를 다시 내놓는다.
 * 무엇이 이미 있는지, 그리고 **아직 아무 플로우에도 안 나오는 화면이 무엇인지**를
 * 알려 줘야 빈 곳을 채운다. 화면 수가 플로우 수를 크게 앞지르는 것이 보통이라,
 * 여기가 실제로 빠지는 부분이다.
 */
export function moreFlowsBlock(plan: Plan): string {
  const inFlows = new Set(
    plan.flows.flatMap((f) => f.nodes.map((n) => n.pageId).filter(Boolean) as string[]),
  );
  const uncovered = plan.iaPages.filter(
    (p) => p.type === 'page' && p.featureIds.length > 0 && !inFlows.has(p.id),
  );

  const lines = [
    '## 이미 만들어 둔 플로우 (다시 만들지 마세요)',
    ...(plan.flows.length > 0
      ? plan.flows.map((f) => `- ${f.id} ${f.name} — ${f.description || '설명 없음'}`)
      : ['- 없음']),
    '',
    '## 이번에 만들 것',
    '위 목록에 **없는** 새 플로우만 3~5개 만드세요. 같은 여정을 이름만 바꿔 다시 내지 마세요.',
  ];

  if (uncovered.length > 0) {
    lines.push(
      '',
      '아래 화면들은 아직 어느 플로우에도 나오지 않습니다. 이 화면들을 지나는 여정을 우선 만드세요.',
      ...uncovered
        .slice(0, 20)
        .map((p) => `- ${p.id} ${p.name} (${p.path}) — ${p.description || '설명 없음'}`),
    );
    if (uncovered.length > 20) lines.push(`- 외 ${uncovered.length - 20}개`);
  } else {
    lines.push(
      '',
      '모든 화면이 이미 어느 플로우엔가 나옵니다. 예외·실패·관리자 여정처럼 아직 안 그린 경로를 만드세요.',
    );
  }

  return lines.join('\n');
}

/** 한 단계 생성. AI 가 실패하면 내장 생성기로 대체하고 사유를 함께 돌려준다. */
async function runStep(
  plan: Plan,
  artifact: ArtifactKey,
  options: GenerateOptions,
): Promise<{ patch: Partial<PlanDocuments>; source: 'ai' | 'local'; warning?: string }> {
  const runtime = options.config ? null : await readAiRuntime();
  const over = options.config ?? runtime!.config;
  const key = options.apiKey ?? runtime?.apiKey ?? '';
  const useAi = isAiEnabled(over, key);
  // 이 단계의 등급. 파이프라인 한 번에도 단계마다 다를 수 있다.
  const tier = engineFor(artifact, options);

  const toPatch = (draft: unknown) =>
    draftToPatch(artifact, draft, plan, {
      mergeWireframes: artifact === 'wireframe' && options.merge === true,
      mergeFlows: artifact === 'flow' && options.merge === true,
    });

  if (!useAi) {
    return { patch: toPatch(generateLocally(artifact, plan.brief, plan, options)), source: 'local' };
  }

  try {
    let prompt = buildPrompt(plan, artifact, options.extra, options.skills?.[artifact]);
    if (artifact === 'wireframe') {
      const targets =
        options.pageIds && options.pageIds.length > 0
          ? plan.iaPages.filter((p) => options.pageIds!.includes(p.id))
          : plan.iaPages.slice(0, 10);
      prompt += `\n\n## 와이어프레임을 만들 페이지\n${targets
        .map((p) => `- ${p.id} ${p.name} (${p.path}) — ${p.description}`)
        .join('\n')}`;
    }
    if (artifact === 'flow' && options.merge === true) {
      prompt += `\n\n${moreFlowsBlock(plan)}`;
    }
    const draft = await generateJson({
      prompt,
      schema: ARTIFACT_SCHEMA[artifact],
      maxTokens: maxTokensFor(artifact, resolveProvider(tier, over, key).maxOutputTokens),
      engine: tier,
      config: over,
      apiKey: key,
    });
    return { patch: toPatch(draft), source: 'ai' };
  } catch (error) {
    // AI 가 실패해도 내장 생성기로 결과를 내어 파이프라인이 멈추지 않게 한다.
    // 사유는 사용자에게 보여도 되는 문장으로 바꿔 전달한다 — 원문은 서버 로그에만 남는다.
    return {
      patch: toPatch(generateLocally(artifact, plan.brief, plan, options)),
      source: 'local',
      warning: aiErrorMessage(error),
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

    /*
     * 낼 수 있는지 **서버가 본다.**
     *
     * 예전에는 브라우저가 봤다. 브라우저가 안 보면 그만이라 사실상 무제한이었다.
     */
    /*
     * **고급 엔진은 두 배다.** 화면이 값을 보여 줄 때도 같은 함수를 쓰므로,
     * "3 크레딧이라더니 6 이 나갔다" 가 생기지 않는다.
     */
    const cost = costOfArtifact(artifact, engineFor(artifact, options));
    if (options.userId && !(await canAfford(options.userId, cost))) {
      yield {
        type: 'error',
        message: `크레딧이 부족합니다. ${ARTIFACT_LABEL[artifact]} 생성에는 ${cost} 크레딧이 필요합니다. 내일 다시 충전됩니다.`,
      };
      return;
    }

    yield { type: 'start', artifact };

    try {
      if (STEP_DELAY_MS > 0) await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      const result = await runStep(working, artifact, options);
      working = withPatch(working, result.patch);
      /*
       * 값은 **받았을 때** 치른다. 그리고 **AI 가 만든 것에만** 치른다 —
       * AI 가 실패해 내장 생성기로 대신했으면 우리 쪽 비용이 나가지 않았다.
       * 그걸 제값 받으면 받은 것보다 비싸게 문 셈이 된다.
       */
      if (options.userId && result.source === 'ai') {
        await spendCredits(options.userId, artifact, cost);
      }
      yield {
        type: 'step',
        artifact,
        patch: result.patch,
        source: result.source,
        ...(result.warning ? { warning: result.warning } : {}),
      };
    } catch (error) {
      yield { type: 'error', message: aiErrorMessage(error) };
      return;
    }
  }

  yield { type: 'done' };
}
