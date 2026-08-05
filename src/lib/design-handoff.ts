/**
 * 만들어 둔 기획을 **AI 디자인 도구가 바로 먹을 수 있는 형태**로 바꾼다.
 *
 * ## 왜 문장을 만드는 일이 먼저인가
 *
 * **손으로 옮겨 적는 일을 없앤다.** 화면마다 무엇을 그려야 하는지는 이미
 * 와이어프레임 블록·기능·역할·플로우에 다 있다. 그걸 도구가 알아듣는 문장으로
 * 조립해 복사만 하면 되게 한다. 실제로 사람이 하던 일이 그것이다.
 *
 * 자동 연결을 붙이더라도 이 부분은 그대로 쓰인다. 스티치의
 * `generate_screen_from_text` 는 결국 `prompt` 문자열을 받고, Figma 캔버스에
 * 그려 달라고 할 때도 넘길 것은 같은 문장이다. **무엇을 그릴지 적는 일**이
 * 어느 경로로 가든 공통이라, 여기를 먼저 정확히 만들어 둔다.
 *
 * Figma 는 길이 하나 더 있다 — **SVG 를 그대로 읽는다.** 이미 만들고 있는
 * 와이어프레임 SVG 를 끌어다 놓으면 편집 가능한 레이어로 들어간다.
 */

import { PLATFORM_LABEL, type Feature, type IaPage, type Plan, type Wireframe } from './types';
import { WIREFRAME_BLOCK_LABEL } from './types';

/* ------------------------------------------------------------------ */
/* 도구                                                                 */
/* ------------------------------------------------------------------ */

export type DesignToolKey = 'stitch' | 'figma' | 'v0' | 'generic';

export interface DesignTool {
  key: DesignToolKey;
  name: string;
  /** 한 줄 설명 — 무엇을 하는 도구인가. */
  what: string;
  /** 이 도구에 넘기는 방법. */
  how: string;
  url: string;
  /** 프롬프트 대신 파일을 주는 도구인가. */
  fileBased?: boolean;
}

export const DESIGN_TOOLS: DesignTool[] = [
  {
    key: 'stitch',
    name: 'Google Stitch',
    what: '설명을 주면 UI 화면을 만들어 줍니다.',
    how: '연결하면 고른 화면을 여기서 바로 만듭니다. 연결하지 않으셨다면 아래 문장을 복사해 붙여 넣으셔도 됩니다.',
    url: 'https://stitch.withgoogle.com',
  },
  {
    key: 'figma',
    name: 'Figma',
    what: '디자이너가 화면을 직접 그리는 도구입니다.',
    how: 'SVG 를 캔버스에 끌어다 놓으면 편집 가능한 레이어로 들어갑니다. 설명이 필요하면 아래 문장을 함께 전달하세요.',
    url: 'https://figma.com',
    fileBased: true,
  },
  {
    key: 'v0',
    name: 'v0',
    what: '설명을 주면 화면을 코드(React)로 만들어 줍니다.',
    how: '화면마다 아래 문장을 복사해 붙여 넣으세요.',
    url: 'https://v0.dev',
  },
  {
    key: 'generic',
    name: '그 밖의 도구',
    what: 'Lovable · Uizard · ChatGPT 등 설명을 받는 도구 전부.',
    how: '아래 문장을 그대로 쓰시면 됩니다. 특정 도구에 맞춘 표현이 없습니다.',
    url: '',
  },
];

/* ------------------------------------------------------------------ */
/* 프롬프트 조립                                                         */
/* ------------------------------------------------------------------ */

function deviceWord(wireframe: Wireframe | undefined, plan: Plan): string {
  if (wireframe?.device === 'desktop') return '데스크톱 웹';
  if (wireframe?.device === 'mobile') return '모바일 앱';
  return PLATFORM_LABEL[plan.brief.platform] ?? '웹';
}

/** 이 화면을 지나는 플로우 이름들. 무엇을 하러 들어오는 화면인지 알려 준다. */
function journeysOf(plan: Plan, pageId: string): string[] {
  return plan.flows
    .filter((f) => f.nodes.some((n) => n.pageId === pageId))
    .map((f) => f.name);
}

function featuresOf(plan: Plan, page: IaPage): Feature[] {
  return page.featureIds
    .map((id) => plan.features.find((f) => f.id === id))
    .filter((f): f is Feature => Boolean(f));
}

export interface ScreenPrompt {
  pageId: string;
  /** 화면 이름 — 목록에 보여 준다. */
  name: string;
  /** 와이어프레임이 있는가. 없으면 블록 없이 기능만으로 만든다. */
  hasWireframe: boolean;
  text: string;
}

/**
 * 화면 하나를 그려 달라는 요청문.
 *
 * 블록의 **구성 항목**을 그대로 넘기는 것이 핵심이다. 거기 적힌 것이 실제 화면에
 * 나올 문구라서, 그것 없이 "리스트 블록" 이라고만 하면 도구가 아무 말이나 채운다.
 */
export function screenPrompt(plan: Plan, page: IaPage, tool: DesignToolKey): string {
  const wireframe = plan.wireframes.find((w) => w.pageId === page.id);
  const features = featuresOf(plan, page);
  const journeys = journeysOf(plan, page.id);

  const lines: string[] = [];

  lines.push(
    `${deviceWord(wireframe, plan)} 화면 하나를 디자인해 주세요.`,
    '',
    `서비스: ${plan.brief.title}${plan.brief.oneLiner ? ` — ${plan.brief.oneLiner}` : ''}`,
    `화면 이름: ${page.name}`,
  );
  if (page.path) lines.push(`경로: ${page.path}`);
  if (page.description) lines.push(`화면 설명: ${page.description}`);
  if (page.roles.length > 0) lines.push(`사용자: ${page.roles.join(', ')}`);
  if (journeys.length > 0) lines.push(`이 화면을 지나는 여정: ${journeys.join(', ')}`);

  if (features.length > 0) {
    lines.push('', '이 화면에서 할 수 있어야 하는 것:');
    lines.push(...features.map((f) => `- ${f.name}${f.description ? ` — ${f.description}` : ''}`));
  }

  if (wireframe && wireframe.blocks.length > 0) {
    lines.push('', '화면 구성 (위에서 아래 순서):');
    wireframe.blocks.forEach((block, index) => {
      const kind = WIREFRAME_BLOCK_LABEL[block.type] ?? block.type;
      lines.push(`${index + 1}. ${kind} — ${block.title || '(제목 없음)'}`);
      if (block.items.length > 0) {
        // 여기 적힌 것이 실제로 화면에 나올 문구다. 바꾸지 말라고 못 박는다.
        lines.push(`   표시할 내용: ${block.items.join(' / ')}`);
      }
      if (block.note) lines.push(`   기획 의도: ${block.note}`);
    });
    lines.push('', '위 순서와 문구를 그대로 지켜 주세요. 항목을 임의로 늘리거나 바꾸지 마세요.');
  } else {
    lines.push(
      '',
      '와이어프레임이 아직 없는 화면입니다. 위 기능이 자연스럽게 들어가도록 구성해 주세요.',
    );
  }

  if (tool === 'v0') {
    lines.push('', '반응형으로 만들고, 실제로 눌리는 상태(hover·disabled·빈 목록)까지 포함해 주세요.');
  }
  if (tool === 'figma') {
    lines.push('', '레이어 이름은 위 블록 이름을 그대로 써 주세요.');
  }

  return lines.join('\n');
}

/** 만들 수 있는 화면 목록. 기능이 걸린 화면을 먼저 보여 준다. */
export function screenPrompts(plan: Plan, tool: DesignToolKey): ScreenPrompt[] {
  const withWireframe = new Set(plan.wireframes.map((w) => w.pageId));
  return plan.iaPages
    .filter((p) => p.type === 'page')
    .slice()
    .sort((a, b) => {
      // 그림이 있는 화면이 먼저다 — 결과가 훨씬 정확하다.
      const byWf = Number(withWireframe.has(b.id)) - Number(withWireframe.has(a.id));
      return byWf !== 0 ? byWf : a.order - b.order;
    })
    .map((page) => ({
      pageId: page.id,
      name: page.name,
      hasWireframe: withWireframe.has(page.id),
      text: screenPrompt(plan, page, tool),
    }));
}

/**
 * 서비스 전체를 한 번에 설명하는 요청문.
 *
 * 화면을 하나씩 만들면 색·글꼴·간격이 화면마다 달라진다. 먼저 이걸로 톤을 잡고
 * 화면별 요청을 이어 가면 결과가 한 벌로 나온다.
 */
export function systemPrompt(plan: Plan, tool: DesignToolKey): string {
  const { brief, prd } = plan;
  const pages = plan.iaPages.filter((p) => p.type === 'page');

  const lines = [
    `${PLATFORM_LABEL[brief.platform] ?? '웹'} 서비스의 화면들을 디자인하려 합니다. 먼저 전체 방향을 잡아 주세요.`,
    '',
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

  lines.push(
    '',
    '색·글꼴·간격·버튼 모양을 정해 주세요. 이후 화면들은 여기서 정한 것을 그대로 씁니다.',
  );
  if (tool === 'figma') lines.push('컴포넌트로 만들어 재사용할 수 있게 해 주세요.');

  return lines.join('\n');
}

/** 화면별 요청문을 하나의 문서로. 파일로 받아 두고 하나씩 쓰기 좋게. */
export function handoffDocument(plan: Plan, tool: DesignToolKey): string {
  const meta = DESIGN_TOOLS.find((t) => t.key === tool);
  const screens = screenPrompts(plan, tool);

  const out = [
    `# ${plan.brief.title} — 디자인 요청문`,
    '',
    `대상 도구: ${meta?.name ?? '디자인 도구'}`,
    `화면 ${screens.length}개`,
    '',
    '---',
    '',
    '## 0. 먼저 전체 방향 잡기',
    '',
    '```',
    systemPrompt(plan, tool),
    '```',
    '',
  ];

  screens.forEach((screen, index) => {
    out.push(
      '---',
      '',
      `## ${index + 1}. ${screen.name}${screen.hasWireframe ? '' : ' (와이어프레임 없음)'}`,
      '',
      '```',
      screen.text,
      '```',
      '',
    );
  });

  return out.join('\n');
}
