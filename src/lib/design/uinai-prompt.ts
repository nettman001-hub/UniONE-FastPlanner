import { screenPrompt, type PromptEmphasis } from '@/lib/design-handoff';
import { findSkill } from '@/lib/design/skills';
import {
  componentRecipes,
  findTokenSet,
  tokensToPromptBlock,
} from '@/lib/design/uniai-tokens';
import {
  UINAI_HARD_RULES,
  UINAI_SOFT_RULES,
  UINAI_STYLE_EXEMPLAR,
} from '@/lib/design/uniai-style';
import type { IaPage, Plan } from '@/lib/types';

/**
 * UniAI 시스템 프롬프트.
 *
 * 기존에는 범용 "제품 디자이너" 페르소나뿐이라 미적 품질 지시가 없었다.
 * 이제 역할은 하나로 못 박는다 — **주어진 디자인 토큰을 정확히 구현하는**
 * 프로토타이퍼. 하드 제약(토큰만 사용)과 소프트 품질 기준을 나눠 실어,
 * 모델이 전부 선택 사항으로 읽지 않게 한다(DesignRepair 의 구분을 따름).
 */
export const UINAI_SYSTEM_PROMPT = `당신은 제품 디자이너이자 프론트엔드 프로토타이퍼입니다.
주어진 기획·와이어프레임·디자인 토큰을 실제 제품처럼 보이는 완성도 높은 단일 화면 코드로 바꿉니다.

${UINAI_HARD_RULES}

${UINAI_SOFT_RULES}

형식 원칙:
- 화면 안의 문구는 자연스러운 한국어로 작성합니다.
- 기획에 적힌 기능, 정보 구조, 사용자 역할, 블록 순서와 필수 문구를 빠뜨리지 않습니다.
- 이미지를 생성하지 않습니다. 결과물은 HTML, CSS, JavaScript 프론트엔드 코드입니다.
- HTML은 body 안에 들어갈 시맨틱 마크업만 작성하고 style, script, iframe, object, embed는 넣지 않습니다.
- CSS와 JavaScript는 각각 별도 필드에 작성합니다. 외부 라이브러리나 네트워크 자원은 사용하지 않습니다.
- JavaScript는 버튼, 탭, 메뉴, 모달 같은 화면 내부 상호작용만 vanilla JavaScript로 구현합니다.
- JavaScript가 찾을 요소는 class, id 또는 data-* 속성으로 표시하고 HTML과 선택자를 정확히 맞춥니다.
- fetch, XMLHttpRequest, WebSocket, 저장소, 쿠키, 페이지 이동, eval, 동적 import는 사용하지 않습니다.
- 데스크톱과 모바일에서 모두 자연스럽고 hover, focus, disabled, empty 상태가 보이게 합니다.
- 결과는 지정된 JSON 스키마의 객체 하나로만 응답합니다.`;

export const UINAI_SCREEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    html: {
      type: 'string',
      description: 'body 안에 들어갈 시맨틱 HTML 마크업. style과 script 태그는 넣지 않는다.',
    },
    css: {
      type: 'string',
      description: '외부 자원 없이 화면을 완성하는 순수 CSS. 디자인 토큰은 var()로만 참조한다.',
    },
    javascript: {
      type: 'string',
      description:
        '화면 내부 상호작용을 구현하는 vanilla JavaScript. 상호작용이 필요 없으면 빈 문자열.',
    },
    summary: {
      type: 'string',
      description: '이 화면의 디자인 방향과 핵심 구성을 한국어 한두 문장으로 요약한다.',
    },
    implementationNotes: {
      type: 'array',
      description: '코딩 에이전트가 실제 기능을 붙일 때 알아야 할 구현 메모 2~6개.',
      items: { type: 'string' },
    },
  },
  required: ['html', 'css', 'javascript', 'summary', 'implementationNotes'],
} as const;

/**
 * 서비스 배경 블록.
 *
 * design-handoff 의 systemPrompt 는 "색·글꼴·간격을 정해 주세요" 로 끝나는
 * **대화형 도구용** 문장을 담고 있다. UniAI 는 화면당 한 번 부르는 호출이라
 * 그 문장이 화면마다 결을 다시 정하게 만든다. 그래서 같은 정보를 여기서
 * 직접 조립하되, 방향 정하기 문장은 넣지 않는다.
 */
function serviceContext(plan: Plan): string[] {
  const { brief, prd } = plan;
  const pages = plan.iaPages.filter((p) => p.type === 'page');

  const lines = [
    `서비스: ${brief.title}${brief.oneLiner ? ` — ${brief.oneLiner}` : ''}`,
  ];
  if (brief.idea) lines.push(`무엇을 하는 서비스인가: ${brief.idea}`);
  if (brief.targetUser) lines.push(`주 사용자: ${brief.targetUser}`);
  if (prd?.overview) lines.push(`제품 개요: ${prd.overview}`);
  if (prd?.coreValues?.length) lines.push(`핵심 가치: ${prd.coreValues.join(', ')}`);
  if (prd?.roles?.length) lines.push(`사용자 역할: ${prd.roles.map((r) => r.name).join(', ')}`);
  if (brief.reference) lines.push(`참고할 서비스: ${brief.reference}`);

  if (pages.length > 0) {
    lines.push('', `전체 화면 ${pages.length}개:`);
    lines.push(...pages.slice(0, 30).map((p) => `- ${p.name}${p.path ? ` (${p.path})` : ''}`));
    if (pages.length > 30) lines.push(`- 외 ${pages.length - 30}개`);
  }
  return lines;
}

/**
 * UniAI 화면 하나를 만드는 요청문.
 *
 * 구성: 서비스 배경 → 디자인 방향(스킬 designMd) → 토큰(변수명 그대로) →
 * 컴포넌트 레시피 → 퓨샷 → 화면 상세(screenPrompt) → 결과물 기준.
 * 스킬을 고르지 않았으면 중립 토큰 세트로 품질 하한선을 잡는다.
 */
export function buildUinAiPrompt(
  plan: Plan,
  page: IaPage,
  emphasis: PromptEmphasis,
  skillKey: string,
): string {
  const skill = findSkill(skillKey);
  const set = findTokenSet(skillKey);

  const lines: string[] = [
    '## 서비스 배경',
    ...serviceContext(plan),
    '',
    '## 디자인 방향',
  ];
  if (skill) {
    lines.push(`선택한 디자인 스킬: ${skill.name} — ${skill.what}`, '', skill.designMd.trim());
  } else {
    lines.push(
      '특별한 디자인 방향이 지정되지 않았습니다. 아래 중립 토큰으로 단정한 기본 결을 만드세요.',
    );
  }
  lines.push(
    '',
    tokensToPromptBlock(set),
    '',
    componentRecipes(),
    '',
    '## 퓨샷 — 토큰을 이렇게 사용합니다',
    '```css',
    UINAI_STYLE_EXEMPLAR,
    '```',
    '',
    '## 이번에 만들 화면',
    screenPrompt(plan, page, 'uinai', emphasis),
    '',
    '## 결과물 기준',
    '- 이미지가 아니라 HTML, CSS, JavaScript 프론트엔드 코드로 만드세요.',
    '- html에는 body 내부 마크업만, css에는 스타일만, javascript에는 화면 상호작용만 넣으세요.',
    '- 길이: html ≤ 12,000자, css ≤ 20,000자, javascript ≤ 6,000자, 합계 ≤ 34,000자. 반복되는 스타일은 합쳐서 쓰세요.',
    '- 아이콘은 글자, CSS 도형 또는 인라인 SVG로 만들고 이미지 파일은 생성하거나 불러오지 마세요.',
    '- 입력·버튼·카드·표 등은 실제 서비스의 밀도와 상태를 갖춰 시안처럼 보이게 하세요.',
    '- 코딩 에이전트가 컴포넌트로 옮기기 쉽도록 의미 있는 class 이름과 semantic HTML을 쓰세요.',
    '- 응답 키 예시: {"html":"<main>...</main>","css":".screen {...}","javascript":"...","summary":"...","implementationNotes":[]}',
  );
  return lines.join('\n');
}
