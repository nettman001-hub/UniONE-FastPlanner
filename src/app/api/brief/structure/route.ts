/**
 * 아이디어를 읽고 **서비스 구조**를 추정한다. 비어 있는 아이디어 줄의 후보도 함께 준다.
 *
 * ## 진행을 막지 않는다
 *
 * 위저드 1단계에서 입력이 멈출 때 부른다. 사용자는 결과를 기다리지 않고 `다음` 을 누를
 * 수 있고, 여기서 무엇이 실패해도 **키워드 추정**을 돌려준다(`source: 'rule'`).
 * 4xx·5xx 로 끝나는 경우는 로그인하지 않았을 때뿐이다.
 *
 * ## 고쳐 쓰지 않는다
 *
 * 후보는 **비어 있는 줄**에 넣을 것만 만든다. 사용자가 고른 것만 아이디어에 들어간다 —
 * AI 가 지어낸 문장이 몰래 '사용자 아이디어' 가 되어 다섯 문서에 사실로 퍼지면 안 된다.
 *
 * 크레딧은 차감하지 않는다(되묻기와 같다). 빠르게 끝나도록 기본 엔진으로 고정한다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { generateJson } from '@/lib/ai/client';
import { readAiRuntime } from '@/lib/db/ai-config';
import { isAiEnabled, resolveProvider } from '@/lib/ai/provider';
import { maxTokensFor } from '@/lib/jobs/queue';
import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  CAUTIONS,
  CAUTION_KEYS,
  IDEA_LINES,
  guessStructure,
  ideaLineFilled,
  normalizeStructure,
} from '@/lib/archetypes';
import type { BriefStructure } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SCHEMA = {
  type: 'object',
  properties: {
    primary: { type: 'string', enum: [...ARCHETYPE_KEYS, 'none'] },
    secondary: { type: 'string', enum: [...ARCHETYPE_KEYS, ''] },
    twoSided: { type: 'boolean' },
    cautions: { type: 'array', items: { type: 'string', enum: CAUTION_KEYS } },
    reason: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'string', enum: IDEA_LINES.map((l) => l.label) },
          text: { type: 'string' },
        },
        required: ['line', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['primary', 'secondary', 'twoSided', 'cautions', 'reason', 'suggestions'],
  additionalProperties: false,
};

interface Generated {
  primary: string;
  secondary: string;
  twoSided: boolean;
  cautions: string[];
  reason: string;
  suggestions: Array<{ line: string; text: string }>;
}

export interface StructureResponse {
  structure: BriefStructure | null;
  suggestions: Array<{ line: string; text: string }>;
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let title = '';
  let idea = '';
  try {
    const body = (await request.json()) as { title?: string; idea?: string };
    title = String(body.title ?? '').slice(0, 200);
    idea = String(body.idea ?? '').slice(0, 4000);
  } catch {
    return NextResponse.json({ structure: null, suggestions: [] } satisfies StructureResponse);
  }

  const rule = guessStructure(`${title} ${idea}`) ?? null;
  if (idea.trim().length < 15 || !isAiEnabled()) {
    return NextResponse.json({ structure: rule, suggestions: [] } satisfies StructureResponse);
  }

  const empty = IDEA_LINES.filter((l) => !ideaLineFilled(idea, l.label)).map((l) => l.label);

  const prompt = [
    '아래 서비스 아이디어를 읽고 **서비스 구조**를 고르세요.',
    '',
    `서비스명: ${title || '(미입력)'}`,
    `아이디어:\n${idea}`,
    '',
    '## 구조 (key — 판별 기준)',
    ...ARCHETYPE_KEYS.map((k) => `- ${k} — ${ARCHETYPES[k].label}: ${ARCHETYPES[k].criterion} 예: ${ARCHETYPES[k].examples}`),
    '- none — 위 어느 것에도 맞지 않음 (게임, 기기 연동 등)',
    '',
    '## 규칙',
    '- 단어가 아니라 **누가 무엇을 주고받는지**로 판단하세요. "공유" 라는 말이 있어도 빌려주고 빌리면 matching 입니다.',
    '- primary 는 사용자가 가장 자주 하는 행동 기준으로 하나. 다른 구조가 분명히 섞여 있을 때만 secondary 에 하나 적고, 아니면 빈 문자열.',
    '- twoSided: matching 일 때 제공하는 쪽이 따로 있으면(숨고·장비 대여) true, 같은 처지끼리면(산책 메이트) false. matching 이 아니면 false.',
    `- cautions: 아이디어에 해당하는 것만 — ${CAUTION_KEYS.map((k) => `${k}(${CAUTIONS[k].label})`).join(', ')}.`,
    '- reason: 왜 그렇게 봤는지 존댓말 한 문장, 60자 이내. 예: "가르치는 쪽과 배우는 쪽을 잇고, 수업 시간을 미리 잡는 구조로 읽었습니다."',
    empty.length > 0
      ? `- suggestions: 아이디어에 아직 없는 줄(${empty.join(', ')})에 넣을 후보를 줄마다 최대 1개. 아이디어에 적힌 내용에서 자연스럽게 나오는 것만, 40자 이내. 새 기능이나 정책을 지어내지 마세요. 핵심 행동은 "A → B → C" 형태로.`
      : '- suggestions: 빈 배열.',
  ].join('\n');

  try {
    const aiRuntime = await readAiRuntime();
    const result = await generateJson<Generated>({
      prompt,
      schema: SCHEMA,
      maxTokens: maxTokensFor('prd', resolveProvider('basic', aiRuntime.config, aiRuntime.apiKey).maxOutputTokens),
      engine: 'basic',
      ...aiRuntime,
    });
    const structure = normalizeStructure({
      primary: result.primary,
      secondary: result.secondary || undefined,
      twoSided: result.primary === 'matching' ? result.twoSided : undefined,
      cautions: result.cautions,
      reason: result.reason,
      source: 'ai',
    });
    const suggestions = (result.suggestions ?? [])
      .filter((s) => empty.includes(s.line as (typeof empty)[number]) && s.text?.trim())
      .map((s) => ({ line: s.line, text: s.text.replace(/\s+/g, ' ').trim().slice(0, 60) }))
      .slice(0, 3);
    return NextResponse.json({ structure: structure ?? rule, suggestions } satisfies StructureResponse);
  } catch (error) {
    console.error('[brief/structure] 구조 추정 실패:', error);
    return NextResponse.json({ structure: rule, suggestions: [] } satisfies StructureResponse);
  }
}
