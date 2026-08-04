/**
 * 정합성 검사에서 잡힌 문제를 **에이전트에게 시킬 문장**으로 바꾼다.
 *
 * ## 왜 필요한가
 *
 * 지적을 보고 `수정하러 가기` 를 눌러 해당 화면에 도착해도, 거기서부터 막막하다.
 * 지적은 "무엇이 잘못됐는지" 만 말하고 화면은 "어디를 고쳐야 하는지" 를 말해 주지
 * 않는다. 항목이 스무 개 넘게 있는 표에서 지적된 다섯 개를 눈으로 찾아내는 일이
 * 남는다 — 그 사이가 비어 있어서 대부분 그냥 넘어간다.
 *
 * 지적에는 이미 필요한 것이 다 있다. 무엇이 문제인지(title), 왜 문제인지(detail),
 * 어느 항목인지(targets). 사람이 다시 옮겨 적을 이유가 없다.
 */

import { ARTIFACT_LABEL, type ArtifactKey } from '../types';

export interface FixableIssue {
  id: string;
  artifact: ArtifactKey;
  title: string;
  detail: string;
  targets: string[];
}

/** 한 번에 넘길 대상 수. 너무 많으면 하나하나가 얕아진다. */
const MAX_TARGETS = 12;

/**
 * 지적 하나를 고쳐 달라는 요청문.
 *
 * 대상 ID 를 그대로 넘긴다. 에이전트는 ID 로 항목을 맞춰 고치므로,
 * 이름으로 뭉뚱그리는 것보다 정확하고 엉뚱한 항목을 건드릴 일이 없다.
 */
export function issueFixPrompt(issue: FixableIssue): string {
  const shown = issue.targets.slice(0, MAX_TARGETS);
  const rest = issue.targets.length - shown.length;

  const lines = [
    `${ARTIFACT_LABEL[issue.artifact]}에서 아래 문제를 고쳐 주세요.`,
    '',
    `문제: ${issue.title}`,
    `이유: ${issue.detail}`,
  ];

  if (shown.length > 0) {
    lines.push('', '해당 항목:');
    lines.push(...shown.map((t) => `- ${t}`));
    if (rest > 0) {
      lines.push(`- 외 ${rest}건 (먼저 위 ${MAX_TARGETS}개부터 고쳐 주세요)`);
    }
  }

  lines.push(
    '',
    '해당 항목만 고치고 나머지는 그대로 두세요. 무엇도 지우지 마세요.',
  );

  return lines.join('\n');
}

/**
 * 한 산출물의 지적을 **한꺼번에** 고쳐 달라는 요청문.
 *
 * 지적이 여러 개일 때 하나씩 시키면 크레딧도 시간도 여러 배로 든다.
 * 앞의 것을 고치다가 뒤의 것이 함께 풀리는 경우도 많다.
 */
export function issuesFixPrompt(artifact: ArtifactKey, issues: FixableIssue[]): string {
  if (issues.length === 1) return issueFixPrompt(issues[0]);

  const lines = [`${ARTIFACT_LABEL[artifact]}에서 아래 문제들을 고쳐 주세요.`, ''];

  issues.forEach((issue, index) => {
    const shown = issue.targets.slice(0, MAX_TARGETS);
    const rest = issue.targets.length - shown.length;
    lines.push(`${index + 1}. ${issue.title}`);
    lines.push(`   ${issue.detail}`);
    if (shown.length > 0) {
      lines.push(`   해당 항목: ${shown.join(', ')}${rest > 0 ? ` 외 ${rest}건` : ''}`);
    }
    lines.push('');
  });

  lines.push('해당 항목만 고치고 나머지는 그대로 두세요. 무엇도 지우지 마세요.');
  return lines.join('\n');
}
