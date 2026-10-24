/**
 * 아이디어를 읽고 **이 서비스에만 해당하는 질문**을 되묻는다.
 *
 * ## 왜 고정 폼으로는 안 되는가
 *
 * "누가 쓰나요" 처럼 어느 서비스에나 통하는 질문은 미리 만들어 둘 수 있다.
 * 그런데 정작 문서를 갈라놓는 것은 그런 질문이 아니다.
 *
 *   산책 매칭 → 처음 만나는 사람끼리 안전은 어떻게 확보하나요?
 *   중고 거래 → 돈은 직접 주고받나요, 앱이 잠시 맡아 두나요?
 *   학원 관리 → 학부모도 앱을 쓰나요, 선생님만 쓰나요?
 *
 * 이건 아이디어를 읽어야만 나오는 질문이고, 실제 기획자가 첫 미팅에서 하는 일이다.
 *
 * ## 답을 안 해도 된다
 *
 * 되묻기는 **건너뛸 수 있어야 한다.** 여기서 막히면 플랜을 아예 못 만든다.
 * 그래서 실패해도 조용히 빈 목록을 준다 — 질문을 못 만든 것이 플랜 생성을
 * 막을 이유는 없다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { generateJson } from '@/lib/ai/client';
import { userAgentEngine } from '@/lib/db/user-settings';
import { readAiRuntime } from '@/lib/db/ai-config';
import { isAiEnabled, resolveProvider } from '@/lib/ai/provider';
import { maxTokensFor } from '@/lib/jobs/queue';
import { visibleQuestions } from '@/lib/brief-questions';
import { ARCHETYPES, normalizeStructure } from '@/lib/archetypes';
import { briefBlock } from '@/lib/ai/prompts';
import type { PlanBrief } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 질문이 다루는 영역. 한 영역에서 두 개 이상 묻지 않게 해 질문이 한쪽으로 몰리지 않게 한다.
 * 화면에는 꼬리표로 보인다.
 */
const AREAS = ['정책·규칙', '예외 상황', '운영', '개인정보·안전', '돈', '데이터'] as const;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          why: { type: 'string' },
          area: { type: 'string', enum: [...AREAS] },
          choices: { type: 'array', items: { type: 'string' } },
          recommended: { type: 'string' },
          recommendReason: { type: 'string' },
        },
        required: ['question', 'why', 'area', 'choices', 'recommended', 'recommendReason'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

interface Generated {
  questions: Array<{
    question: string;
    why: string;
    area: string;
    choices: string[];
    recommended: string;
    recommendReason: string;
  }>;
}

function listBlock(title: string, items: string[]): string {
  return items.length > 0 ? `\n## ${title}\n${items.map((item) => `- ${item}`).join('\n')}` : '';
}

interface Body {
  brief?: PlanBrief;
  /**
   * 2 면 **꼬리 질문** 을 만든다. 1회차 질문과 답이 brief.followups 에 담겨 온다 — 답에서
   * 이어지는 것(예: "보증금으로 처리" → "보증금은 얼마, 언제 돌려주나요?")만 묻는다.
   */
  round?: number;
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ questions: [] });
  }
  const brief = body.brief;
  const round = body.round === 2 ? 2 : 1;

  if (!brief?.idea?.trim()) {
    return NextResponse.json({ questions: [], reason: '아이디어를 먼저 적어 주세요.' });
  }
  if (!isAiEnabled()) {
    return NextResponse.json({ questions: [], reason: '지금은 되묻기를 쓸 수 없습니다.' });
  }

  const engine = await userAgentEngine(user.id);
  const aiRuntime = await readAiRuntime();

  // 브라우저가 보낸 값이라 다시 세운다.
  const structure = normalizeStructure(brief.structure);
  const safeBrief: PlanBrief = {
    ...brief,
    structure,
    followups: Array.isArray(brief.followups) ? brief.followups.slice(0, 12) : undefined,
    summary: undefined,
  };
  const asked = visibleQuestions(structure).map((q) => q.ask);
  const previous = (safeBrief.followups ?? []).map((f) => f.question);
  const hints =
    structure && structure.primary !== 'none'
      ? [
          ...ARCHETYPES[structure.primary].followupHints,
          ...(structure.secondary ? ARCHETYPES[structure.secondary].followupHints.slice(0, 1) : []),
        ]
      : [];

  const prompt = [
    round === 1
      ? '아래 서비스를 읽고, **기획을 시작하기 전에 반드시 확인해야 하는 질문**을 3~5개 만드세요.'
      : '아래 서비스와 지금까지의 문답을 읽고, **사용자가 한 답에서 이어지는 꼬리 질문**을 2~4개 만드세요. 답을 하면 그 결정을 실제로 구현하려면 무엇을 더 정해야 하는지를 물으세요.',
    '',
    '## 서비스 정보',
    briefBlock(safeBrief),
    listBlock('이미 보기로 물은 질문 (답이 없어도 다시 묻지 마세요)', asked),
    listBlock('이미 되물은 질문 (다시 묻지 마세요)', previous),
    round === 1 ? listBlock('이 구조에서 문서를 갈라놓는 것 (아직 안 물었다면 우선)', hints) : '',
    '',
    '규칙:',
    '- **이 서비스에만 해당하는 질문**을 하세요. 어느 서비스에나 통하는 일반론은 쓰지 마세요.',
    '- 이미 위에서 답이 나온 것은 다시 묻지 마세요.',
    '- 답에 따라 화면·기능·정책이 실제로 달라지는 것만 물으세요. 취향을 묻지 마세요.',
    `- area 는 ${AREAS.join(' / ')} 중 하나. **한 영역에서 두 개 이상 묻지 마세요.** 정책·규칙(숫자로 정할 것: 기한·한도·횟수)과 예외 상황(실패·취소·분쟁)을 우선하세요.`,
    '- 질문은 한 문장, 존댓말로. 전문 용어를 쓰지 마세요.',
    '- 보기(choices)를 2~4개 함께 주세요. 사용자가 고르기만 해도 되게. 숫자로 정할 것은 보기에 숫자를 넣으세요(예: 24시간 전까지 / 1시간 전까지).',
    '- recommended 에는 보기 중 이 서비스에 가장 맞는 것 하나를 그대로 적고, recommendReason 에 이유를 30자 이내로 적으세요.',
    '- why 에는 이 답이 무엇을 바꾸는지 한 문장으로 적으세요.',
    '',
    '예) 아이디어가 "이웃끼리 물건을 빌려 쓰는 앱" 이라면:',
    '- 질문: 물건이 망가지면 누가 책임지나요?  area: 예외 상황  보기: 빌린 사람 / 보증금으로 처리 / 서비스가 보상',
    '- recommended: 보증금으로 처리  recommendReason: 분쟁을 서비스 안에서 끝낼 수 있음',
    '- why: 보증금·분쟁 처리 화면이 생길지 결정합니다.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    /*
     * 넉넉히 준다.
     *
     * 처음에는 2000 이었다. 질문 몇 줄이면 충분하다고 봤는데, 생각을 길게 하는
     * 모델은 그 길이를 답이 아니라 **생각하는 데** 다 쓰고 잘린다. 잘리면
     * `too-long` 으로 던져지고, 아래 catch 가 삼켜서 "질문 없음" 으로 보였다.
     * 지금은 앱 전체 DeepSeek 요청과 같이 384K 상한을 쓴다. 질문 수는 스키마와
     * 프롬프트가 제한하므로, 상한이 커도 질문이 불필요하게 길어지지는 않는다.
     */
    const result = await generateJson<Generated>({
      prompt,
      schema: SCHEMA,
      maxTokens: maxTokensFor('prd', resolveProvider(engine, aiRuntime.config, aiRuntime.apiKey).maxOutputTokens),
      engine,
      ...aiRuntime,
    });
    const questions = (result.questions ?? [])
      .filter((q) => q.question?.trim())
      .filter((q) => !previous.includes(q.question.trim()))
      .slice(0, 5)
      .map((q) => {
        // 보기가 없어도 자유 입력으로 받으면 되므로 막지 않는다.
        const choices = (q.choices ?? []).filter((c) => c?.trim()).slice(0, 5);
        const recommended = choices.includes(q.recommended) ? q.recommended : '';
        return {
          question: q.question.trim(),
          why: (q.why ?? '').trim(),
          area: (AREAS as readonly string[]).includes(q.area) ? q.area : '',
          choices,
          recommended,
          recommendReason: recommended ? (q.recommendReason ?? '').trim().slice(0, 60) : '',
        };
      });
    return NextResponse.json({
      questions,
      ...(questions.length === 0
        ? { reason: round === 2 ? '더 여쭤볼 것이 없습니다.' : '여쭤볼 것을 찾지 못했습니다.' }
        : {}),
    });
  } catch (error) {
    /*
     * 되묻기를 못 만든 것이 플랜 생성을 막을 이유는 없다. 다만 **아무 말 없이**
     * 넘어가면 안 된다 — 그러면 "AI 가 아무것도 안 물어봤다" 는 상태와
     * "물어볼 게 없다" 는 상태가 화면에서 똑같아 보인다. 실제로 그렇게 묻혔다.
     */
    console.error('[brief/questions] 되묻기 생성 실패:', error);
    return NextResponse.json({
      questions: [],
      reason: '여쭤볼 것을 만들지 못했습니다. 그냥 진행하셔도 됩니다.',
    });
  }
}
