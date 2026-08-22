/**
 * qa-tokens — uniai-tokens.ts 결정적 단위 검사.
 * 실행: npx tsx scripts/qa/qa-tokens.ts
 */

import {
  NEUTRAL_TOKEN_SET,
  TOKEN_SETS,
  composeScreenCss,
  findTokenSet,
  tokensToCssBlock,
  tokensToPromptBlock,
} from '@/lib/design/uniai-tokens';
import { sanitizeUinAiCss } from '@/lib/design/uinai';

let failures = 0;

function ok(name: string, pass: boolean, detail = ''): void {
  const mark = pass ? 'ok' : 'FAIL';
  if (!pass) failures += 1;
  console.log(`${mark}  ${name}${pass || !detail ? '' : ` — ${detail}`}`);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(channels[0]) + 0.7152 * f(channels[1]) + 0.0722 * f(channels[2]);
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// 6 스킬 + 중립
ok('스킬 셋 6종 존재', TOKEN_SETS.length === 6);
const keys = TOKEN_SETS.map((set) => set.key);
ok('스킬 키 목록', keys.join(',') === 'clean,friendly,dense,commerce,accessible,dark', keys.join(','));
ok('none 은 중립 세트', findTokenSet('none') === NEUTRAL_TOKEN_SET);
ok('undefined 는 중립 세트', findTokenSet(undefined) === NEUTRAL_TOKEN_SET);
ok('모르는 키는 중립 세트', findTokenSet('bogus') === NEUTRAL_TOKEN_SET);

const allSets = [...TOKEN_SETS, NEUTRAL_TOKEN_SET];
for (const set of allSets) {
  const css = tokensToCssBlock(set);
  const prompt = tokensToPromptBlock(set);
  const varLines = css.split('\n').filter((line) => /^\s*--/.test(line.trim()));
  ok(`[${set.key}] CSS 변수 30개 이상 (실제 ${varLines.length})`, varLines.length >= 30);
  const colorVars = varLines.filter((line) => /--c-/.test(line));
  ok(`[${set.key}] 색 변수 12개 이상 (실제 ${colorVars.length})`, colorVars.length >= 12);
  const fsVars = varLines.filter((line) => /--fs-/.test(line));
  ok(`[${set.key}] 타입 스케일 5단 이상 (실제 ${fsVars.length})`, fsVars.length >= 5);
  const spVars = varLines.filter((line) => /--sp-/.test(line));
  ok(`[${set.key}] 간격 스케일 6개 이상 (실제 ${spVars.length})`, spVars.length >= 6);
  ok(`[${set.key}] CSS 블록 결정적`, tokensToCssBlock(set) === css);
  ok(`[${set.key}] 프롬프트 블록 결정적`, tokensToPromptBlock(set) === prompt);
  ok(
    `[${set.key}] 프롬프트 블록 1,500자 이내 (실제 ${prompt.length})`,
    prompt.length <= 1500,
  );
  ok(`[${set.key}] 프롬프트 블록이 변수명을 담음`, prompt.includes('--c-primary:'));
  ok(`[${set.key}] :root 블록 형식`, css.startsWith(':root {') && css.includes('--c-primary:'));
}

// accessible 대비
const accessible = findTokenSet('accessible');
const ratio = contrast(accessible.colors.fg, accessible.colors.surface);
ok(`[accessible] fg/surface 대비 4.5:1 이상 (실제 ${ratio.toFixed(2)})`, ratio >= 4.5);

// compose — 리셋 + 토큰 + 모델 CSS
const modelCss = '.screen{color:var(--c-fg)}';
const composed = composeScreenCss('clean', modelCss);
ok('compose 가 리셋으로 시작', composed.startsWith('*,*::before'));
ok('compose 에 토큰 블록 포함', composed.includes(':root {'));
ok('compose 뒤에 모델 CSS 유지', composed.endsWith(modelCss.trim()));
ok('compose 가 sanitize 통과', (() => { try { sanitizeUinAiCss(composed); return true; } catch { return false; } })());
ok('모르는 키도 compose 안전(중립)', composeScreenCss('bogus', modelCss).includes('--c-primary:#4b5563'));

// 길이: 모델 CSS 약 34K 입력에도 출력 ≤ 40K
const bigCss = `.a{color:var(--c-fg)}`.repeat(1540); // 22자 × 1540 ≈ 33.9K
const bigComposed = composeScreenCss('clean', bigCss);
ok(`34K 입력 compose 출력 ≤ 40K (실제 ${bigComposed.length})`, bigComposed.length <= 40000);

console.log(failures === 0 ? '\n모두 통과했습니다.' : `\n${failures}건 실패.`);
process.exitCode = failures === 0 ? 0 : 1;
