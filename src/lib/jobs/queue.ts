/**
 * 생성 작업 큐.
 *
 * 브라우저는 작업을 **맡기고 결과를 가지러 온다.** 요청을 붙잡고 기다리지 않으므로
 * 탭을 닫거나 새로고침해도 서버는 계속 만든다.
 *
 * 전체 자동 생성은 **한 작업 안에서 5단계를 서버가 이어서 돈다.** 브라우저가 단계마다
 * 다시 요청하던 예전 방식은, 화면을 옮기면 다음 단계를 아무도 시작하지 않아 끊겼다.
 * 앞 단계 결과는 서버가 들고 있는 사본에 바로 반영해 다음 단계 컨텍스트로 넘긴다.
 */

import { generateJson, isAiEnabled } from '@/lib/ai/client';
import { generateLocally } from '@/lib/ai/local-generator';
import { ARTIFACT_SCHEMA } from '@/lib/ai/schemas';
import { buildPrompt } from '@/lib/ai/prompts';
import { draftToPatch } from '@/lib/ai/apply';
import type { ArtifactKey, Plan, PlanDocuments } from '@/lib/types';
import { jobStore, type Job } from './store';

/** 산출물별 출력 분량이 크게 달라 토큰 상한을 따로 잡는다. */
const MAX_TOKENS: Record<ArtifactKey, number> = {
  prd: 16000,
  fs: 32000,
  ia: 20000,
  flow: 20000,
  wireframe: 32000,
};

export interface EnqueueOptions {
  extra?: string;
  pageIds?: string[];
  merge?: boolean;
}

function newId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  options: EnqueueOptions,
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

/** 작업 하나를 끝까지 돈다. 요청 응답과 무관하게 돌아가므로 절대 throw 하지 않는다. */
async function run(job: Job, basePlan: Plan, options: EnqueueOptions) {
  const store = jobStore();
  let working = basePlan;
  let merged: Partial<PlanDocuments> = {};
  const done: ArtifactKey[] = [];
  const warnings: string[] = [];

  for (const artifact of job.artifacts) {
    const blocked = precondition(working, artifact);
    if (blocked) {
      await store.update(job.id, {
        status: 'error',
        current: null,
        error: blocked,
        done,
        patch: merged,
        warnings,
      });
      return;
    }

    await store.update(job.id, { status: 'running', current: artifact });

    try {
      const result = await runStep(working, artifact, options);
      merged = { ...merged, ...result.patch };
      working = withPatch(working, result.patch);
      done.push(artifact);
      if (result.warning) warnings.push(`${artifact}: ${result.warning}`);

      await store.update(job.id, {
        current: null,
        done: [...done],
        patch: merged,
        warnings: [...warnings],
        source: result.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다.';
      await store.update(job.id, {
        status: 'error',
        current: null,
        error: message,
        done,
        patch: merged,
        warnings,
      });
      return;
    }
  }

  await store.update(job.id, { status: 'done', current: null });
}

/**
 * 작업을 맡기고 곧바로 돌려준다.
 *
 * 실행은 응답을 기다리지 않고 뒤에서 돈다. 서버리스에서는 응답 후 실행이 잘릴 수 있어
 * 호출부가 `waitUntil` 로 붙잡아 줄 수 있도록 실행 프라미스를 함께 돌려준다.
 */
export async function enqueue(
  planId: string,
  plan: Plan,
  artifacts: ArtifactKey[],
  cost: number,
  options: EnqueueOptions = {},
): Promise<{ job: Job; running: Promise<void> }> {
  const store = jobStore();
  const now = Date.now();
  const job: Job = {
    id: newId(),
    planId,
    artifacts,
    status: 'queued',
    current: null,
    done: [],
    patch: {},
    warnings: [],
    source: null,
    cost,
    createdAt: now,
    updatedAt: now,
  };

  await store.create(job);
  const running = run(job, plan, options).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : '작업 실행 중 오류가 발생했습니다.';
    await store.update(job.id, { status: 'error', current: null, error: message });
  });

  return { job, running };
}
