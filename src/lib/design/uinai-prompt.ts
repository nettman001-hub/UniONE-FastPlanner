import { screenPrompt, systemPrompt, type PromptEmphasis } from '@/lib/design-handoff';
import { findSkill } from '@/lib/design/skills';
import type { IaPage, Plan } from '@/lib/types';

export const UINAI_SYSTEM_PROMPT = `당신은 제품 디자이너이자 프론트엔드 프로토타이퍼입니다.
주어진 기획과 와이어프레임을 실제 제품처럼 보이는 완성도 높은 단일 화면으로 바꿉니다.

원칙:
- 화면 안의 문구는 자연스러운 한국어로 작성합니다.
- 기획에 적힌 기능, 정보 구조, 사용자 역할, 블록 순서와 필수 문구를 빠뜨리지 않습니다.
- 미리보기는 외부 라이브러리나 네트워크 없이 단독으로 열리는 HTML이어야 합니다.
- JavaScript, script, iframe, object, embed, form 전송, 외부 URL, @import를 사용하지 않습니다.
- CSS는 HTML 안의 style 태그에 넣고 데스크톱과 모바일에서 모두 자연스럽게 보이게 합니다.
- 실제 동작 대신 hover, focus, disabled, empty 같은 상태를 시각적으로 표현합니다.
- 결과는 지정된 JSON 스키마의 객체 하나로만 응답합니다.`;

export const UINAI_SCREEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    html: {
      type: 'string',
      description:
        'DOCTYPE, html, head, body를 모두 포함한 독립 실행형 HTML. CSS는 style 태그 안에 포함한다.',
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
  required: ['html', 'summary', 'implementationNotes'],
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
    '- 브라우저에서 바로 열 수 있는 완전한 HTML 문서 하나를 만드세요.',
    '- 아이콘은 글자, CSS 도형 또는 인라인 SVG로 만들고 외부 이미지는 불러오지 마세요.',
    '- 입력·버튼·카드·표 등은 실제 서비스의 밀도와 상태를 갖춰 시안처럼 보이게 하세요.',
    '- 코딩 에이전트가 컴포넌트로 옮기기 쉽도록 의미 있는 class 이름과 semantic HTML을 쓰세요.',
  ];
  return lines.join('\n');
}
