/**
 * AI 에이전트가 보낸 수정안이 **기존 내용을 지우는지** 검사한다.
 *
 * ## 왜 필요한가
 *
 * 에이전트 수정은 산출물을 통째로 갈아 끼우는 방식이다. 프롬프트가 "해당 산출물
 * 전체를 새로 만들어 담으라" 고 요구하고, 받은 것을 그대로 문서에 덮어쓴다.
 *
 * 문서가 커지면 이 방식이 무너진다. 요구사항 7개·기능 19개짜리 플랜에서
 * "기능 5개에 상세 명세를 추가해 줘" 라고 하면, 모델이 **손댄 5개만** 담아 보내는
 * 일이 생긴다. 그러면 나머지가 전부 사라진다. 실제로 기능명세서가 통째로 비었다.
 *
 * 모델에게 "전부 담으라" 고 더 강하게 말하는 것으로는 못 막는다. 문서가 클수록
 * 출력이 길어지고, 길어질수록 빠뜨릴 확률이 올라가기 때문이다.
 *
 * ## 규칙
 *
 * **에이전트 수정은 항목을 줄일 수 없다.** 추가와 수정만 허용한다.
 * 지우는 일은 화면에서 직접 해야 한다 — 그쪽은 무엇이 지워지는지 눈으로 보고
 * 확인 절차도 있다.
 *
 * 판정이 다소 보수적이어서 "정말 지우려던 요청" 까지 막지만, 그 대가로
 * **조용한 데이터 손실이 불가능해진다.** 지운 것은 되돌릴 수 없고, 막힌 것은
 * 화면에서 하면 된다.
 */

import type { Plan, PlanDocuments, Prd } from '../types';

/** 통째로 갈아 끼우는 목록들. 하나라도 줄면 손실로 본다. */
const COLLECTIONS = [
  ['requirements', '요구사항'],
  ['features', '기능'],
  ['specifications', '상세 기능'],
  ['iaPages', '화면'],
  ['flows', '플로우'],
  ['wireframes', '와이어프레임'],
] as const;

/** PRD 안에서 내용이 사라졌는지 볼 항목들. */
const PRD_LISTS = [
  ['goals', '핵심 목표'],
  ['personas', '타겟 유저'],
  ['roles', '사용자 역할'],
  ['coreValues', '핵심 가치'],
  ['successMetrics', '성공 지표'],
  ['inScope', '포함 범위'],
  ['outOfScope', '제외 범위'],
  ['constraints', '제약사항'],
] as const;

const PRD_TEXTS = [
  ['overview', '제품 개요'],
  ['background', '배경 및 문제 정의'],
] as const;

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * 무엇이 얼마나 사라지는지 적어 돌려준다. 사라지는 것이 없으면 null.
 *
 * 돌려주는 문장은 그대로 사용자에게 보인다.
 */
export function describeContentLoss(before: Plan, patch: Partial<PlanDocuments>): string | null {
  const lost: string[] = [];

  for (const [key, label] of COLLECTIONS) {
    if (!(key in patch)) continue;
    const was = count(before[key]);
    const now = count(patch[key]);
    if (now < was) lost.push(`${label} ${was}개 → ${now}개`);
  }

  if (patch.prd) {
    const was = before.prd ?? ({} as Prd);
    const now = patch.prd;
    for (const [key, label] of PRD_LISTS) {
      const a = count(was[key]);
      const b = count(now[key]);
      if (b < a) lost.push(`${label} ${a}개 → ${b}개`);
    }
    for (const [key, label] of PRD_TEXTS) {
      if ((was[key] ?? '').trim() && !(now[key] ?? '').trim()) lost.push(`${label}이(가) 비워짐`);
    }
  }

  return lost.length > 0 ? lost.join(' · ') : null;
}

/** 막았을 때 사용자에게 보여 줄 안내. */
export function contentLossMessage(loss: string): string {
  return [
    '⚠️ 문서를 고치지 않았습니다.',
    '',
    `받은 수정안이 기존 내용을 지우게 되어 있어 반영하지 않았습니다. (${loss})`,
    '한 번에 다루기에 문서가 커서 일부만 돌아온 것으로 보입니다.',
    '',
    '**범위를 좁혀 다시 요청해 주세요.** 예를 들어 기능 두세 개씩 나눠서 시키면 잘 됩니다.',
    '항목을 지우려면 해당 화면에서 직접 삭제해 주세요.',
  ].join('\n');
}
