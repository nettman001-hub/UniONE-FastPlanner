import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { generateJson, isAiEnabled } from '@/lib/ai/client';
import { resolveProvider } from '@/lib/ai/provider';
import { maxTokensFor } from '@/lib/jobs/queue';
import { aiErrorMessage } from '@/lib/ai/errors';
import { CHAT_SCHEMA } from '@/lib/ai/schemas';
import { buildChatPrompt } from '@/lib/ai/prompts';
import { draftToPatch } from '@/lib/ai/apply';
import { hasArtifact } from '@/lib/artifact-status';
import { contentLossMessage, describeContentLoss } from '@/lib/ai/guard';
import { ARTIFACT_LABEL, type ArtifactKey, type Plan, type PlanDocuments } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ChatBody {
  plan: Plan;
  message: string;
}

interface ChatResult {
  reply: string;
  changes: string[];
  patch: { artifact: string; payload: string };
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
  // 생성 API 와 같은 이유로 로그인을 요구한다 — 주인의 AI 키를 쓰는 요청이다.
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const { plan, message } = body;
  if (!plan || !message?.trim()) {
    return NextResponse.json({ error: '메시지를 입력해 주세요.' }, { status: 400 });
  }

  if (!isAiEnabled()) {
    return NextResponse.json({ ...offlineReply(plan), source: 'local' });
  }

  try {
    const result = await generateJson<ChatResult>({
      prompt: buildChatPrompt(plan, message),
      schema: CHAT_SCHEMA,
      /*
       * 에이전트는 문서를 통째로 다시 써서 돌려준다. 여기서 잘리면 내용이
       * 사라진 것처럼 보이므로(실제로 그런 일이 있었다) 생성 단계 중 가장 긴
       * 기능명세서와 같은 분량을 잡는다. 공급자 상한을 올리면 함께 올라간다.
       */
      maxTokens: maxTokensFor('fs', resolveProvider().maxOutputTokens),
    });

    const artifact = result.patch?.artifact;
    let patch: Partial<PlanDocuments> | undefined;
    let blocked: string | null = null;

    if (artifact && artifact !== 'none' && result.patch.payload) {
      try {
        const draft = JSON.parse(result.patch.payload);
        patch = draftToPatch(artifact as ArtifactKey, draft, plan, { mergeWireframes: true });
      } catch {
        // 패치 해석에 실패해도 답변은 그대로 전달한다.
        patch = undefined;
      }
    }

    /*
     * 수정안이 기존 내용을 지우면 반영하지 않는다.
     *
     * 문서가 크면 모델이 손댄 부분만 담아 보내는 일이 있는데, 그대로 덮어쓰면
     * 나머지가 통째로 사라진다. 실제로 기능명세서가 비었다. 되돌릴 수 없는 손실이므로
     * 의심스러우면 반영하지 않는 쪽을 고른다.
     */
    if (patch) {
      blocked = describeContentLoss(plan, patch);
      if (blocked) {
        console.error('[chat] 내용 손실 차단', artifact, blocked);
        patch = undefined;
      }
    }

    return NextResponse.json({
      reply: blocked ? `${contentLossMessage(blocked)}\n\n---\n\n${result.reply}` : result.reply,
      changes: patch ? (result.changes ?? []) : [],
      patch,
      source: 'ai',
      ...(blocked ? { warning: blocked } : {}),
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
    });
  }
}
