import { screenPrompt, systemPrompt, type PromptEmphasis } from '@/lib/design-handoff';
import { findSkill } from '@/lib/design/skills';
import type { IaPage, Plan } from '@/lib/types';

export const UINAI_SYSTEM_PROMPT = `당신은 제품 디자이너이자 프론트엔드 프로토타이퍼입니다.
주어진 기획과 와이어프레임을 실제 제품처럼 보이는 완성도 높은 단일 화면으로 바꿉니다.

원칙:
- 화면 안의 문구는 자연스러운 한국어로 작성합니다.
- 기획에 적힌 기능, 정보 구조, 사용자 역할, 블록 순서와 필수 문구를 빠뜨리지 않습니다.
- 이미지를 생성하지 않습니다. 결과물은 HTML, CSS, JavaScript 프론트엔드 코드입니다.
- HTML은 body 안에 들어갈 시맨틱 마크업만 작성하고 style, script, iframe, object, embed는 넣지 않습니다.
- CSS와 JavaScript는 각각 별도 필드에 작성합니다. 외부 라이브러리나 네트워크 자원은 사용하지 않습니다.
- JavaScript는 버튼, 탭, 메뉴, 모달 같은 화면 내부 상호작용만 vanilla JavaScript로 구현합니다.
- JavaScript가 찾을 요소는 class, id 또는 data-* 속성으로 표시하고 HTML과 선택자를 정확히 맞춥니다.
- fetch, XMLHttpRequest, WebSocket, 저장소, 쿠키, 페이지 이동, eval, 동적 import는 사용하지 않습니다.
- HTML 10,000자, CSS 12,000자, JavaScript 6,000자 이내로 간결하게 완성합니다.
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
      description: '외부 자원 없이 화면을 완성하는 순수 CSS.',
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

export function buildUinAiPrompt(
  plan: Plan,
  page: IaPage,
  emphasis: PromptEmphasis,
  skillKey: string,
): string {
  const skill = findSkill(skillKey);
  const lines = [
    systemPrompt(plan, 'uinai'),
    ...(skill ? ['', '## 선택한 디자인 지침', skill.designMd] : []),
    '',
    '## 이번에 만들 화면',
    screenPrompt(plan, page, 'uinai', emphasis),
    '',
    '## 결과물 기준',
    '- 이미지가 아니라 HTML, CSS, JavaScript 프론트엔드 코드로 만드세요.',
    '- html에는 body 내부 마크업만, css에는 스타일만, javascript에는 화면 상호작용만 넣으세요.',
    '- 아이콘은 글자, CSS 도형 또는 인라인 SVG로 만들고 이미지 파일은 생성하거나 불러오지 마세요.',
    '- 입력·버튼·카드·표 등은 실제 서비스의 밀도와 상태를 갖춰 시안처럼 보이게 하세요.',
    '- 코딩 에이전트가 컴포넌트로 옮기기 쉽도록 의미 있는 class 이름과 semantic HTML을 쓰세요.',
    '- 세 코드 필드의 합계를 28,000자 이내로 완결하고 반복되는 스타일은 합쳐서 쓰세요.',
    '- 응답 키 예시: {"html":"<main>...</main>","css":".screen {...}","javascript":"...","summary":"...","implementationNotes":[]}',
  ];
  return lines.join('\n');
}
