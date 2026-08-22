/**
 * qa-style — uniai-style.ts 퓨샷·품질 기준 검사.
 * 실행: npx tsx scripts/qa/qa-style.ts
 */

import { sanitizeUinAiCss } from '@/lib/design/uinai';
import {
  UINAI_HARD_RULES,
  UINAI_SOFT_RULES,
  UINAI_STYLE_EXEMPLAR,
} from '@/lib/design/uniai-style';

let failures = 0;

function ok(name: string, pass: boolean, detail = ''): void {
  const mark = pass ? 'ok' : 'FAIL';
  if (!pass) failures += 1;
  console.log(`${mark}  ${name}${pass || !detail ? '' : ` — ${detail}`}`);
}

ok('퓨샷이 sanitize 통과', (() => { try { sanitizeUinAiCss(UINAI_STYLE_EXEMPLAR); return true; } catch { return false; } })());
ok(
  `퓨샷 2,500자 이내 (실제 ${UINAI_STYLE_EXEMPLAR.length})`,
  UINAI_STYLE_EXEMPLAR.length <= 2500,
);
const varUses = (UINAI_STYLE_EXEMPLAR.match(/var\(--/g) ?? []).length;
ok(`퓨샷 var(--) 사용 8회 이상 (실제 ${varUses})`, varUses >= 8);
ok('하드 규칙에 하드코딩 금지 명시', UINAI_HARD_RULES.includes('하드코딩'));
ok('하드 규칙에 토큰 참조만 사용 명시', UINAI_HARD_RULES.includes('var(--*)'));
ok('하드 규칙에 :root 재선언 금지 명시', UINAI_HARD_RULES.includes(':root를 다시 선언하지 마세요'));
const slopTerms = ['기본 파랑', '흰 카드', '중앙 정렬', '그라데이션', '이모지'];
const present = slopTerms.filter((term) => UINAI_SOFT_RULES.includes(term));
ok(
  `소프트 규칙 AI-slop 금지 항목 4개 이상 (실제 ${present.length})`,
  present.length >= 4,
  present.join('/'),
);
ok('소프트 규칙에 상태 커버리지 포함', UINAI_SOFT_RULES.includes('disabled'));
ok('소프트 규칙에 간격 리듬 포함', UINAI_SOFT_RULES.includes('간격 리듬'));

// 부정 케이스 — sanitize 가 외부 자원을 거부해야 한다
let rejected = false;
try {
  sanitizeUinAiCss('.x{background:url(https://example.com/a.png)}');
} catch {
  rejected = true;
}
ok('부정 케이스: url() 은 sanitize 가 거부', rejected);

let rejectedImport = false;
try {
  sanitizeUinAiCss("@import url('https://example.com/x.css');");
} catch {
  rejectedImport = true;
}
ok('부정 케이스: @import 는 sanitize 가 거부', rejectedImport);

console.log(failures === 0 ? '\n모두 통과했습니다.' : `\n${failures}건 실패.`);
process.exitCode = failures === 0 ? 0 : 1;
