/**
 * 위저드 마지막 단계 — **제가 이해한 게 맞나요?**
 *
 * 지금까지 받은 것(아이디어·구조·고른 답·되물은 답)을 7줄로 되짚고, 사용자가 정하지 않아
 * AI 가 채운 줄에는 표시를 붙인다. 답이 없는 질문은 어떻게 가정할지 따로 적는다.
 *
 * 잘못 이해한 부분은 PRD 를 만들고 크레딧을 쓴 뒤에야 드러난다. 그 전에, 사용자가 줄마다
 * 읽고 고칠 수 있게 하려는 것이다. 고친 요약은 모든 생성 프롬프트에서 가장 앞선다.
 *
 * 크레딧은 차감하지 않는다(되묻기와 같다). 실패해도 플랜은 만들 수 있다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { generateJson } from '@/lib/ai/client';
import { userAgentEngine } from '@/lib/db/user-settings';
import { readAiRuntime } from '@/lib/db/ai-config';
import { isAiEnabled, resolveProvider } from '@/lib/ai/provider';
import { maxTokensFor } from '@/lib/jobs/queue';
import { briefBlock } from '@/lib/ai/prompts';
import { normalizeStructure } from '@/lib/archetypes';
import { SUMMARY_LABELS } from '@/lib/brief-questions';
import type { BriefSummary, PlanBrief } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: [...SUMMARY_LABELS] },
          text: { type: 'string' },
          assumed: { type: 'boolean' },
        },
        required: ['label', 'text', 'assumed'],
        additionalProperties: false,
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['lines', 'assumptions'],
  additionalProperties: false,
};

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let brief: PlanBrief | undefined;
  try {
    brief = ((await request.json()) as { brief?: PlanBrief }).brief;
  } catch {
    return NextResponse.json({ summary: null });
  }
  if (!brief?.idea?.trim()) {
    return NextResponse.json({ summary: null, reason: '아이디어를 먼저 적어 주세요.' });
  }
  if (!isAiEnabled()) {
    return NextResponse.json({ summary: null, reason: '지금은 요약을 만들 수 없습니다. 그냥 진행하셔도 됩니다.' });
  }

  const safeBrief: PlanBrief = {
    ...brief,
    structure: normalizeStructure(brief.structure),
    followups: Array.isArray(brief.followups) ? brief.followups.slice(0, 12) : undefined,
    summary: undefined,
  };

  const prompt = [
    '아래 서비스 정보를 읽고, 기획자가 첫 미팅 끝에 "제가 이해한 게 맞나요?" 하고 되짚듯이 요약하세요.',
    '',
    '## 서비스 정보',
    briefBlock(safeBrief),
    '',
    '## 규칙',
    `- lines 는 다음 순서로 하나씩, 모두 채웁니다: ${SUMMARY_LABELS.join(' / ')}.`,
    '- 각 줄은 60자 이내의 구체적인 한 문장. "편리한 경험" 같은 수식어 대신 사람·행동·숫자로 씁니다.',
    '- 사용자가 직접 말한 것(아이디어, 고른 답, 되물은 답)에서 나온 줄은 assumed=false. 말하지 않아 추측한 줄은 assumed=true.',
    '- "처음 가치를 느끼는 순간" 은 가입 후 사용자가 이 서비스의 가치를 처음 경험하는 구체적인 행동입니다 (예: 첫 산책 약속이 잡히는 순간).',
    '- "만들지 않을 것" 은 사용자가 적은 것이 있으면 그대로, 없으면 이번 범위에서 빼는 것이 자연스러운 것을 추측해 assumed=true 로 씁니다.',
    '- assumptions 에는 정하지 않은 것(답이 없는 질문, "잘 모르겠어요" 로 고른 것)을 어떻게 가정할지 0~4개. 형식: "취소는 이용 24시간 전까지 무료로 가정".',
  ].join('\n');

  try {
    const engine = await userAgentEngine(user.id);
    const aiRuntime = await readAiRuntime();
    const result = await generateJson<BriefSummary>({
      prompt,
      schema: SCHEMA,
      maxTokens: maxTokensFor('prd', resolveProvider(engine, aiRuntime.config, aiRuntime.apiKey).maxOutputTokens),
      engine,
      ...aiRuntime,
    });
    const byLabel = new Map((result.lines ?? []).map((l) => [l.label, l]));
    const summary: BriefSummary = {
      // 순서와 줄 수는 우리가 정한다. 모델이 빠뜨린 줄은 빈칸으로 두어 사용자가 채우게 한다.
      lines: SUMMARY_LABELS.map((label) => {
        const line = byLabel.get(label);
        const text = (line?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return { label, text, assumed: text ? Boolean(line?.assumed) : false };
      }),
      assumptions: (result.assumptions ?? [])
        .map((a) => String(a).replace(/\s+/g, ' ').trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 4),
    };
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('[brief/summary] 요약 생성 실패:', error);
    return NextResponse.json({ summary: null, reason: '요약을 만들지 못했습니다. 그냥 진행하셔도 됩니다.' });
  }
}
