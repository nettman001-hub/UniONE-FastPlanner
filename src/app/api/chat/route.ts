import { NextResponse } from 'next/server';
import { requirePlanActor } from '@/lib/auth/plan-actor';
import { generateJson, isAiEnabled } from '@/lib/ai/client';
import { resolveProvider } from '@/lib/ai/provider';
import { userAgentEngine } from '@/lib/db/user-settings';
import { readAiRuntime } from '@/lib/db/ai-config';
import { canAfford, spendCredits } from '@/lib/db/credits';
import { CHAT_CREDIT_COST } from '@/lib/types';
import { costWithEngine } from '@/lib/credits';
import { maxTokensFor } from '@/lib/jobs/queue';
import { aiErrorMessage } from '@/lib/ai/errors';
import { CHAT_SCHEMA } from '@/lib/ai/schemas';
import { buildChatPrompt } from '@/lib/ai/prompts';
import { finalizeAgentResponse, type AgentResult } from '@/lib/ai/agent-response';
import { hasArtifact } from '@/lib/artifact-status';
import { ARTIFACT_LABEL, type ArtifactKey, type Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ChatBody {
  plan: Plan;
  message: string;
  reviewNoteIds?: string[];
  recheckOnly?: boolean;
}

/** AI 를 쓸 수 없을 때 문서 상태를 근거로 답을 만든다. */
function offlineReply(plan: Plan): { reply: string; changes: string[] } {
  const missing = (['prd', 'fs', 'ia', 'flow', 'wireframe'] as ArtifactKey[]).filter(
    (key) => !hasArtifact(plan, key),
  );

  const stats = [
    `요구사항 ${plan.requirements.length}개`,
    `기능 ${plan.features.length}개`,
    `상세명세 ${plan.specifications.length}개`,
    `페이지 ${plan.iaPages.length}개`,
    `플로우 ${plan.flows.length}개`,
    `와이어프레임 ${plan.wireframes.length}개`,
  ].join(' · ');

  const lines = [
    `현재 "${plan.brief.title}" 플랜은 ${stats} 상태입니다.`,
  ];

  if (missing.length > 0) {
    lines.push(
      `아직 만들지 않은 산출물이 있습니다: ${missing.map((k) => ARTIFACT_LABEL[k]).join(', ')}. 각 탭의 [AI로 생성] 버튼으로 만들 수 있습니다.`,
    );
  } else {
    lines.push('5종 산출물이 모두 생성되어 있습니다. 내보내기 탭에서 문서를 받아갈 수 있습니다.');
  }

  lines.push(
    '지금은 문서를 자동으로 고쳐 드릴 수 없는 상태입니다. 각 화면에서 직접 편집하실 수 있고, 다른 기능은 모두 그대로 쓰실 수 있습니다.',
  );

  return { reply: lines.join('\n\n'), changes: [] };
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const { plan, message } = body;
  if (!plan?.id || !message?.trim()) {
    return NextResponse.json({ error: '메시지를 입력해 주세요.' }, { status: 400 });
  }

  const { user, response } = await requirePlanActor(request, plan.id);
  if (!user) return response;

  const reviewNoteIds = Array.isArray(body.reviewNoteIds)
    ? [...new Set(body.reviewNoteIds.filter((id): id is string => typeof id === 'string'))]
    : undefined;
  // 이미 해결되거나 확인한 지적을 오래된 버튼에서 다시 보내도 AI를 호출하지 않는다.
  if (reviewNoteIds !== undefined && !plan.reviewNotes?.some((note) => reviewNoteIds.includes(note.id))) {
    return NextResponse.json({ reply: '이미 처리된 지적입니다. 다시 수정하지 않았습니다.', changes: [], credits: 0 });
  }
  if (body.recheckOnly && !reviewNoteIds?.length) {
    return NextResponse.json({ error: '재검증할 지적을 지정해 주세요.' }, { status: 400 });
  }

  // 설정·키·등급은 여기서 한 번만 읽는다. 아래에서 그대로 돌려 쓴다.
  const runtime = await readAiRuntime();
  const engine = await userAgentEngine(user.id);
  const cost = costWithEngine(CHAT_CREDIT_COST, engine);

  if (!isAiEnabled(runtime.config, runtime.apiKey)) {
    return NextResponse.json({ ...offlineReply(plan), source: 'local', credits: 0 });
  }

  /*
   * 낼 수 있는지 **서버가 본다.**
   *
   * 예전에는 브라우저만 셌다. 브라우저가 안 깎으면 그만이라 사실상 무제한이었다.
   */
  if (!(await canAfford(user.id, cost))) {
    return NextResponse.json(
      { error: '크레딧이 부족합니다. 내일 다시 충전됩니다.' },
      { status: 402 },
    );
  }

  try {
    const deadline = Date.now() + 280_000;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(280_000)]);
    const result = body.recheckOnly ? undefined : await generateJson<AgentResult>({
      prompt: buildChatPrompt(plan, message),
      schema: CHAT_SCHEMA,
      /*
       * 여러 항목을 수정하는 요청도 처리할 수 있도록 기능명세서와 같은 출력
       * 상한을 쓴다. 실제 응답에는 손댄 항목만 포함한다.
       */
      maxTokens: maxTokensFor('fs', resolveProvider(engine, runtime.config, runtime.apiKey).maxOutputTokens),
      engine,
      config: runtime.config,
      apiKey: runtime.apiKey,
      signal,
    });
    const completed = await finalizeAgentResponse(plan, result, {
      reviewNoteIds,
      verify: (prompt, schema) => generateJson({
        system: '당신은 기획 문서의 정합성을 재검증하는 검토자입니다. 문서를 수정하거나 새 기능을 제안하지 않고 지정된 지적만 판정합니다.',
        prompt,
        schema,
        maxTokens: 4096,
        effort: 'high',
        engine,
        config: runtime.config,
        apiKey: runtime.apiKey,
        signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(60_000, deadline - Date.now())))]),
        retryFormat: false,
      }),
    });

    // 검증 취소를 실패 상태로 보존했더라도 사용자가 취소한 요청은 청구하지 않는다.
    request.signal.throwIfAborted();
    const charged = body.recheckOnly && !completed.verification?.resolved && !completed.verification?.unresolved ? 0 : cost;
    if (charged > 0) await spendCredits(user.id, 'chat', charged);

    return NextResponse.json({
      ...completed,
      credits: charged,
      source: 'ai',
    });
  } catch (error) {
    /*
     * 호출이 실패해도 대화가 끊기지 않도록 사유를 밝히고 문서 현황이라도 돌려준다.
     * 사유는 **사용자에게 보여도 되는 문장**이어야 한다 — 어떤 모델을 쓰는지,
     * 어떤 환경변수가 비었는지가 채팅창에 나가면 안 된다.
     */
    const reason = aiErrorMessage(error);
    const fallback = offlineReply(plan);
    return NextResponse.json({
      reply: `${reason}\n\n대신 지금 문서 상태를 정리해 드립니다.\n\n${fallback.reply}`,
      changes: [],
      source: 'local',
      warning: reason,
      credits: 0,
    });
  }
}
