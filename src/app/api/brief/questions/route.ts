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
import { isAiEnabled } from '@/lib/ai/provider';
import { answersBlock } from '@/lib/brief-questions';
import { PLATFORM_LABEL, type PlanBrief } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
          choices: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'why', 'choices'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

interface Generated {
  questions: Array<{ question: string; why: string; choices: string[] }>;
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let brief: PlanBrief | undefined;
  try {
    brief = ((await request.json()) as { brief?: PlanBrief }).brief;
  } catch {
    return NextResponse.json({ questions: [] });
  }

  if (!brief?.idea?.trim()) {
    return NextResponse.json({ questions: [], reason: '아이디어를 먼저 적어 주세요.' });
  }
  if (!isAiEnabled()) {
    return NextResponse.json({ questions: [], reason: '지금은 되묻기를 쓸 수 없습니다.' });
  }

  const prompt = [
    '아래 서비스 아이디어를 읽고, **기획을 시작하기 전에 반드시 확인해야 하는 질문**을 3~5개 만드세요.',
    '',
    `서비스명: ${brief.title}`,
    `한 줄 소개: ${brief.oneLiner || '(미입력)'}`,
    `아이디어: ${brief.idea}`,
    `타겟 사용자: ${brief.targetUser || '(미입력)'}`,
    `플랫폼: ${PLATFORM_LABEL[brief.platform]}`,
    brief.mustHave ? `꼭 넣을 기능: ${brief.mustHave}` : '',
    answersBlock(brief.answers),
    '',
    '규칙:',
    '- **이 서비스에만 해당하는 질문**을 하세요. 어느 서비스에나 통하는 일반론은 쓰지 마세요.',
    '- 이미 위에서 답이 나온 것은 다시 묻지 마세요.',
    '- 답에 따라 화면이나 기능이 실제로 달라지는 것만 물으세요. 취향을 묻지 마세요.',
    '- 질문은 한 문장, 존댓말로. 전문 용어를 쓰지 마세요.',
    '- 보기(choices)를 2~4개 함께 주세요. 사용자가 고르기만 해도 되게.',
    '- why 에는 이 답이 무엇을 바꾸는지 한 문장으로 적으세요.',
    '',
    '예) 아이디어가 "이웃끼리 물건을 빌려 쓰는 앱" 이라면:',
    '- 질문: 물건이 망가지면 누가 책임지나요?  보기: 빌린 사람 / 보증금으로 처리 / 서비스가 보상 / 아직 안 정함',
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
     * 다른 산출물 생성이 16000~32000 을 쓰는 것에 비하면 2000 은 유별나게 작았다.
     */
    const result = await generateJson<Generated>({ prompt, schema: SCHEMA, maxTokens: 8000 });
    const questions = (result.questions ?? [])
      .filter((q) => q.question?.trim())
      .slice(0, 5)
      .map((q) => ({
        question: q.question.trim(),
        why: (q.why ?? '').trim(),
        // 보기가 없어도 자유 입력으로 받으면 되므로 막지 않는다.
        choices: (q.choices ?? []).filter((c) => c?.trim()).slice(0, 5),
      }));
    return NextResponse.json({
      questions,
      ...(questions.length === 0 ? { reason: '여쭤볼 것을 찾지 못했습니다.' } : {}),
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
