import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { generateJson, isAiEnabled } from '@/lib/ai/client';
import { CHAT_SCHEMA } from '@/lib/ai/schemas';
import { buildChatPrompt } from '@/lib/ai/prompts';
import { draftToPatch } from '@/lib/ai/apply';
import { ARTIFACT_LABEL, type ArtifactKey, type Plan } from '@/lib/types';

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

/** 오프라인 모드에서 문서 상태를 근거로 답을 만든다. */
function offlineReply(plan: Plan, message: string): { reply: string; changes: string[] } {
  const missing = (['prd', 'fs', 'ia', 'flow', 'wireframe'] as ArtifactKey[]).filter(
    (key) => !plan.generated[key],
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
    `요청하신 내용("${message.slice(0, 40)}${message.length > 40 ? '…' : ''}")을 문서에 자동 반영하려면 .env.local 에 DEEPSEEK_API_KEY 를 설정해 AI 모드를 켜 주세요. 지금은 내장 생성기 모드라 문서 편집은 각 탭에서 직접 하실 수 있습니다.`,
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
    return NextResponse.json({ ...offlineReply(plan, message), source: 'local' });
  }

  try {
    const result = await generateJson<ChatResult>({
      prompt: buildChatPrompt(plan, message),
      schema: CHAT_SCHEMA,
      maxTokens: 32000,
    });

    const artifact = result.patch?.artifact;
    let patch: Record<string, unknown> | undefined;

    if (artifact && artifact !== 'none' && result.patch.payload) {
      try {
        const draft = JSON.parse(result.patch.payload);
        patch = draftToPatch(artifact as ArtifactKey, draft, plan, { mergeWireframes: true });
      } catch {
        // 패치 해석에 실패해도 답변은 그대로 전달한다.
        patch = undefined;
      }
    }

    return NextResponse.json({
      reply: result.reply,
      changes: patch ? (result.changes ?? []) : [],
      patch,
      source: 'ai',
    });
  } catch (error) {
    // 모델 호출이 실패해도 대화가 끊기지 않도록, 이유를 밝히고 문서 현황이라도 돌려준다.
    const reason = error instanceof Error ? error.message : '응답 생성에 실패했습니다.';
    const fallback = offlineReply(plan, message);
    return NextResponse.json({
      reply: `${reason}\n\n대신 지금 문서 상태를 정리해 드립니다.\n\n${fallback.reply}`,
      changes: [],
      source: 'local',
      warning: reason,
    });
  }
}
