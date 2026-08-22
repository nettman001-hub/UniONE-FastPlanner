/**
 * UniAI 디자인 토큰 — 스킬별 "구체 값"의 결정적 정의.
 *
 * ## 왜 필요한가
 *
 * 기존 디자인 스킬(skills.ts)은 산문 지침(designMd)과 씨앗색 하나뿐이라,
 * 모델이 나머지(팔레트·타입·간격·모서리)를 즉흥 결정해 범용적인 화면이 나왔다.
 * 여기서 스킬마다 구체 토큰을 정해 두고, 생성된 CSS 앞에 토큰 블록을 서버가
 * 직접 심는다 — 모델은 var() 참조만 하면 되고, 화면 간 결이 항상 일치한다.
 *
 * ## 파생 규칙 (결정적 — 코드로 못 박는다)
 *
 * - primary = skills.ts 의 씨앗색 그대로
 * - primary-hover = 밝기 ±8% (라이트는 어둡게, 다크는 밝게)
 * - primary-soft = primary 색조의 옅은 배경 톤, primary-border = 중간 톤
 * - surface/border/fg 계열은 라이트·다크 각각 고정 계열 (globals.css 어휘와 정합)
 * - accessible 스킬은 fg/surface 대비 4.5:1 이상 보장
 *
 * ## 표기 규칙
 *
 * 새 코드는 "UniAI" 표기를 쓴다. 기존 uinai.ts/uinai-prompt.ts 등의 파일명과
 * uinAiScreens 같은 저장 필드는 기존 데이터 호환을 위해 그대로 둔다.
 *
 * ## import 규칙
 *
 * 이 파일은 상대 import 없이 **완전히 독립적**이어야 한다 — 검증 스크립트와
 * 런타임(경로 alias 해석 없이)에서 바로 읽을 수 있도록.
 */

export interface DesignTokenSet {
  key: string;
  name: string;
  colors: {
    primary: string;
    primaryHover: string;
    primarySoft: string;
    primaryBorder: string;
    surface: string;
    surface2: string;
    border: string;
    borderStrong: string;
    fg: string;
    fgMuted: string;
    danger: string;
    dangerSoft: string;
    warn: string;
    warnSoft: string;
    ok: string;
    okSoft: string;
  };
  typeScale: {
    display: { size: number; weight: number };
    h1: { size: number; weight: number };
    h2: { size: number; weight: number };
    h3: { size: number; weight: number };
    body: { size: number; weight: number };
    caption: { size: number; weight: number };
  };
  spacing: number[];
  radius: { card: number; button: number; input: number };
  shadow: string;
  shadowLg: string;
  fontStack: string;
  /** 포커스 링 — primary-border 색으로 만든 box-shadow 값. */
  focusRing: string;
}

/* ------------------------------------------------------------------ */
/* 공통 계열                                                             */
/* ------------------------------------------------------------------ */

const FONT_INTER =
  "'Inter','Pretendard',-apple-system,'Segoe UI','Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const FONT_POPPINS =
  "'Poppins','Inter','Pretendard',-apple-system,'Segoe UI','Malgun Gothic','Noto Sans KR',sans-serif";
const FONT_NOTO =
  "'Noto Sans KR','Pretendard','Malgun Gothic','Apple SD Gothic Neo',-apple-system,sans-serif";

const LIGHT_SURFACE = {
  surface: '#ffffff',
  surface2: '#f6f7f9',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  fg: '#16181d',
  fgMuted: '#5c6472',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  warn: '#b45309',
  warnSoft: '#fef3c7',
  ok: '#15803d',
  okSoft: '#dcfce7',
  shadow: '0 1px 2px rgb(16 24 40 / 0.06)',
  shadowLg: '0 8px 24px rgb(16 24 40 / 0.10)',
};

const DARK_SURFACE = {
  surface: '#14171d',
  surface2: '#1a1e26',
  border: '#262c37',
  borderStrong: '#39414f',
  fg: '#e8eaee',
  fgMuted: '#a0a8b8',
  danger: '#f87171',
  dangerSoft: '#3a1d1d',
  warn: '#fbbf24',
  warnSoft: '#37290c',
  ok: '#4ade80',
  okSoft: '#10291a',
  shadow: '0 1px 2px rgb(0 0 0 / 0.4)',
  shadowLg: '0 8px 24px rgb(0 0 0 / 0.5)',
};

const TYPE_CLEAN = {
  display: { size: 28, weight: 700 },
  h1: { size: 22, weight: 700 },
  h2: { size: 18, weight: 600 },
  h3: { size: 16, weight: 600 },
  body: { size: 15, weight: 400 },
  caption: { size: 13, weight: 400 },
};

const TYPE_FRIENDLY = {
  display: { size: 30, weight: 700 },
  h1: { size: 24, weight: 700 },
  h2: { size: 19, weight: 600 },
  h3: { size: 16, weight: 600 },
  body: { size: 16, weight: 400 },
  caption: { size: 14, weight: 400 },
};

const TYPE_DENSE = {
  display: { size: 22, weight: 700 },
  h1: { size: 17, weight: 600 },
  h2: { size: 15, weight: 600 },
  h3: { size: 14, weight: 600 },
  body: { size: 13, weight: 400 },
  caption: { size: 12, weight: 400 },
};

const TYPE_COMMERCE = {
  display: { size: 28, weight: 800 },
  h1: { size: 22, weight: 700 },
  h2: { size: 18, weight: 700 },
  h3: { size: 16, weight: 600 },
  body: { size: 15, weight: 400 },
  caption: { size: 13, weight: 400 },
};

const TYPE_ACCESSIBLE = {
  display: { size: 30, weight: 700 },
  h1: { size: 26, weight: 700 },
  h2: { size: 22, weight: 600 },
  h3: { size: 19, weight: 600 },
  body: { size: 18, weight: 400 },
  caption: { size: 16, weight: 400 },
};

const SPACING = [4, 8, 12, 16, 24, 32, 48];

/* ------------------------------------------------------------------ */
/* 스킬별 토큰 셋                                                         */
/* ------------------------------------------------------------------ */

function focusRing(color: string): string {
  return `0 0 0 3px ${color}`;
}

export const TOKEN_SETS: DesignTokenSet[] = [
  {
    key: 'clean',
    name: '깔끔한 기본',
    colors: {
      primary: '#3B5BDB',
      primaryHover: '#2E4CC4',
      primarySoft: '#eef0ff',
      primaryBorder: '#c9cdf7',
      ...LIGHT_SURFACE,
    },
    typeScale: TYPE_CLEAN,
    spacing: SPACING,
    radius: { card: 12, button: 8, input: 8 },
    shadow: LIGHT_SURFACE.shadow,
    shadowLg: LIGHT_SURFACE.shadowLg,
    fontStack: FONT_INTER,
    focusRing: focusRing('#c9cdf7'),
  },
  {
    key: 'friendly',
    name: '친근한',
    colors: {
      primary: '#F76707',
      primaryHover: '#d85506',
      primarySoft: '#fff0e4',
      primaryBorder: '#fdd7b6',
      ...LIGHT_SURFACE,
    },
    typeScale: TYPE_FRIENDLY,
    spacing: SPACING,
    radius: { card: 16, button: 999, input: 10 },
    shadow: LIGHT_SURFACE.shadow,
    shadowLg: LIGHT_SURFACE.shadowLg,
    fontStack: FONT_POPPINS,
    focusRing: focusRing('#fdd7b6'),
  },
  {
    key: 'dense',
    name: '업무용 · 정보 밀집',
    colors: {
      primary: '#1C7ED6',
      primaryHover: '#176bb5',
      primarySoft: '#e8f4fd',
      primaryBorder: '#bfe0f7',
      ...LIGHT_SURFACE,
    },
    typeScale: TYPE_DENSE,
    spacing: SPACING,
    radius: { card: 4, button: 4, input: 4 },
    shadow: LIGHT_SURFACE.shadow,
    shadowLg: LIGHT_SURFACE.shadowLg,
    fontStack: FONT_INTER,
    focusRing: focusRing('#bfe0f7'),
  },
  {
    key: 'commerce',
    name: '커머스',
    colors: {
      primary: '#E8590C',
      primaryHover: '#c44b0a',
      primarySoft: '#fdeee2',
      primaryBorder: '#f9d2b8',
      ...LIGHT_SURFACE,
    },
    typeScale: TYPE_COMMERCE,
    spacing: SPACING,
    radius: { card: 12, button: 8, input: 8 },
    shadow: LIGHT_SURFACE.shadow,
    shadowLg: LIGHT_SURFACE.shadowLg,
    fontStack: FONT_POPPINS,
    focusRing: focusRing('#f9d2b8'),
  },
  {
    key: 'accessible',
    name: '누구나 쓰기 쉽게',
    colors: {
      primary: '#1971C2',
      primaryHover: '#155fa6',
      primarySoft: '#e7f1fb',
      primaryBorder: '#bcd9f3',
      ...LIGHT_SURFACE,
    },
    typeScale: TYPE_ACCESSIBLE,
    spacing: SPACING,
    radius: { card: 12, button: 10, input: 10 },
    shadow: LIGHT_SURFACE.shadow,
    shadowLg: LIGHT_SURFACE.shadowLg,
    fontStack: FONT_NOTO,
    focusRing: focusRing('#bcd9f3'),
  },
  {
    key: 'dark',
    name: '어두운 화면',
    colors: {
      primary: '#7048E8',
      primaryHover: '#8c6bee',
      primarySoft: '#1e1f3a',
      primaryBorder: '#383a72',
      ...DARK_SURFACE,
    },
    typeScale: TYPE_CLEAN,
    spacing: SPACING,
    radius: { card: 12, button: 8, input: 8 },
    shadow: DARK_SURFACE.shadow,
    shadowLg: DARK_SURFACE.shadowLg,
    fontStack: FONT_INTER,
    focusRing: focusRing('#383a72'),
  },
];

/** 스킬을 고르지 않았을 때 쓰는 중립 세트 — clean 에서 색 채도만 낮춘 것. */
export const NEUTRAL_TOKEN_SET: DesignTokenSet = {
  key: 'none',
  name: '중립 기본',
  colors: {
    primary: '#4b5563',
    primaryHover: '#374151',
    primarySoft: '#f1f5f9',
    primaryBorder: '#cbd5e1',
    ...LIGHT_SURFACE,
  },
  typeScale: TYPE_CLEAN,
  spacing: SPACING,
  radius: { card: 12, button: 8, input: 8 },
  shadow: LIGHT_SURFACE.shadow,
  shadowLg: LIGHT_SURFACE.shadowLg,
  fontStack: FONT_INTER,
  focusRing: focusRing('#cbd5e1'),
};

export function findTokenSet(key: string | undefined): DesignTokenSet {
  if (!key || key === 'none') return NEUTRAL_TOKEN_SET;
  return TOKEN_SETS.find((set) => set.key === key) ?? NEUTRAL_TOKEN_SET;
}

/* ------------------------------------------------------------------ */
/* 생성기 — CSS 블록 · 프롬프트 블록 · 레시피                               */
/* ------------------------------------------------------------------ */

export function tokensToCssBlock(set: DesignTokenSet): string {
  const c = set.colors;
  const t = set.typeScale;
  const s = set.spacing;
  const r = set.radius;
  const lines = [
    `--c-primary:${c.primary};`,
    `--c-primary-hover:${c.primaryHover};`,
    `--c-primary-soft:${c.primarySoft};`,
    `--c-primary-border:${c.primaryBorder};`,
    `--c-surface:${c.surface};`,
    `--c-surface-2:${c.surface2};`,
    `--c-border:${c.border};`,
    `--c-border-strong:${c.borderStrong};`,
    `--c-fg:${c.fg};`,
    `--c-fg-muted:${c.fgMuted};`,
    `--c-danger:${c.danger};`,
    `--c-danger-soft:${c.dangerSoft};`,
    `--c-warn:${c.warn};`,
    `--c-warn-soft:${c.warnSoft};`,
    `--c-ok:${c.ok};`,
    `--c-ok-soft:${c.okSoft};`,
    `--fs-display:${t.display.size}px;`,
    `--fs-h1:${t.h1.size}px;`,
    `--fs-h2:${t.h2.size}px;`,
    `--fs-h3:${t.h3.size}px;`,
    `--fs-body:${t.body.size}px;`,
    `--fs-caption:${t.caption.size}px;`,
    `--fw-display:${t.display.weight};`,
    `--fw-h1:${t.h1.weight};`,
    `--fw-h2:${t.h2.weight};`,
    `--fw-h3:${t.h3.weight};`,
    ...s.map((value, index) => `--sp-${index + 1}:${value}px;`),
    `--r-card:${r.card}px;`,
    `--r-button:${r.button}px;`,
    `--r-input:${r.input}px;`,
    `--shadow:${set.shadow};`,
    `--shadow-lg:${set.shadowLg};`,
    `--font-sans:${set.fontStack};`,
    `--focus-ring:${set.focusRing};`,
  ];
  return `:root {\n  ${lines.join('\n  ')}\n}`;
}

/** 프롬프트에 실어 주는 컴팩트 목록 — 변수명 그대로, 1,500자 이내. */
export function tokensToPromptBlock(set: DesignTokenSet): string {
  const c = set.colors;
  const t = set.typeScale;
  const r = set.radius;
  const lines = [
    '## 디자인 토큰 (이 값들은 화면 CSS 앞에 이미 선언되어 있습니다)',
    `--c-primary:${c.primary}; --c-primary-hover:${c.primaryHover}; --c-primary-soft:${c.primarySoft}; --c-primary-border:${c.primaryBorder};`,
    `--c-surface:${c.surface}; --c-surface-2:${c.surface2}; --c-border:${c.border}; --c-border-strong:${c.borderStrong};`,
    `--c-fg:${c.fg}; --c-fg-muted:${c.fgMuted}; --c-danger:${c.danger}; --c-danger-soft:${c.dangerSoft}; --c-warn:${c.warn}; --c-warn-soft:${c.warnSoft}; --c-ok:${c.ok}; --c-ok-soft:${c.okSoft};`,
    `--fs-display:${t.display.size}px; --fs-h1:${t.h1.size}px; --fs-h2:${t.h2.size}px; --fs-h3:${t.h3.size}px; --fs-body:${t.body.size}px; --fs-caption:${t.caption.size}px; --fw-h1:${t.h1.weight}; --fw-h2:${t.h2.weight}; --fw-h3:${t.h3.weight};`,
    set.spacing.map((value, index) => `--sp-${index + 1}:${value}px`).join('; ') + ';',
    `--r-card:${r.card}px; --r-button:${r.button}px; --r-input:${r.input}px;`,
    `--font-sans:${set.fontStack};`,
    '사용 규칙 — 위 변수는 **이미 선언되어 있으므로 :root를 다시 선언하지 마세요.** 모든 색·간격·모서리·글자 크기·그림자는 var(--*) 참조만 사용하고, 색 코드·px 값을 스타일에 직접 쓰지 마세요.',
  ];
  return lines.join('\n');
}

/** 토큰 기반 컴포넌트 기준 — 모델이 재료를 헤매지 않게. */
export function componentRecipes(): string {
  return [
    '## 컴포넌트 기준 (토큰으로만)',
    '- 주요 버튼: 배경 var(--c-primary), 글자 var(--c-surface), radius var(--r-button), 높이 40px 이상, padding 0 16px, hover 는 var(--c-primary-hover). 한 화면에 주요 버튼은 하나.',
    '- 보조 버튼: 배경 투명, 1px var(--c-border-strong) 테두리, 글자 var(--c-fg).',
    '- 글자만 있는 버튼: 글자 var(--c-primary), 배경·테두리 없음.',
    '- 카드: 배경 var(--c-surface), 1px var(--c-border) 테두리, radius var(--r-card). 그림자는 모달·드롭다운에만 var(--shadow-lg).',
    '- 입력: 배경 var(--c-surface), 1px var(--c-border-strong) 테두리, radius var(--r-input), focus 시 box-shadow var(--focus-ring) + 테두리 var(--c-primary).',
    '- 표: 머리글 배경 var(--c-surface-2) + 글자 var(--c-fg-muted), 행 구분선 var(--c-border), 숫자 열 오른쪽 정렬.',
    '- 칩·배지: 배경 var(--c-primary-soft), 글자 var(--c-primary). 상태 배지는 danger var(--c-danger)/var(--c-danger-soft), warn var(--c-warn)/var(--c-warn-soft), ok var(--c-ok)/var(--c-ok-soft).',
    '- 간격: 요소 사이는 간격 스케일 값만(var(--sp-*) 사용). 그림자 대신 여백과 1px 선으로 면을 나눕니다.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 화면 CSS 조립 — 서버가 저장 직전에 토큰 블록을 심는다                        */
/* ------------------------------------------------------------------ */

const MINI_RESET = [
  '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
  'body{font-family:var(--font-sans);color:var(--c-fg);background:var(--c-surface);line-height:1.5}',
  'img,svg{display:block;max-width:100%}',
  'button,input,select,textarea{font:inherit;color:inherit}',
  'a{color:var(--c-primary);text-decoration:none}',
].join('\n');

/**
 * 모델이 만든 CSS 앞에 리셋과 토큰 블록을 붙인다.
 *
 * skillKey 가 'none' 이거나 모르는 값이면 중립 세트를 쓴다. 이 함수가
 * 저장 CSS 의 **유일한 출구**여야 한다 — 정제(재작성) 결과도 다시 이 함수를
 * 지나야 토큰 블록이 유지된다.
 */
export function composeScreenCss(skillKey: string | undefined, modelCss: string): string {
  const set = findTokenSet(skillKey);
  // 모델의 :root 는 이 출구에서 무조건 제거한다 — 서버 토큰 블록이 유일한 선언.
  return `${MINI_RESET}\n${tokensToCssBlock(set)}\n${stripRootBlocks(modelCss)}`;
}

/**
 * 모델 CSS에서 :root 블록을 지운다.
 *
 * 토큰 블록은 서버가 CSS 앞에 이미 심는다. 모델이 프롬프트 지시대로 :root 를
 * 다시 선언하면 그것이 **뒤에 와서** 서버가 심은 값을 덮어 쓴다. 그래서
 * 모델 산출물의 :root 는 값이 무엇이든 무조건 제거한다(결정적 방어).
 */
export function stripRootBlocks(css: string): string {
  return css.replace(/:root\s*\{[^}]*\}/g, '').trim();
}

/**
 * 모델이 만든 HTML 에서 <style> 블록을 지운다.
 *
 * 스타일은 css 필드의 몫이다. body 안에 <style> 이 남아 있으면 미리보기에서
 * 토큰 CSS 보다 뒤에 읽혀 같은 우선순위에서 값을 덮어 쓴다. HTML 은 구조만
 * 남기고, 스타일 출구를 하나로 강제한다.
 */
export function stripStyleTags(html: string): string {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}
