/**
 * 산출물이 실제로 만들어져 있는가.
 *
 * ## 왜 `plan.generated` 를 믿지 않는가
 *
 * `generated.fs` 는 **생성을 한 번 돌렸다는 기록**이다. 한 번 켜지면 다시 꺼지지 않는다.
 * 그래서 내용이 사라져도 켜진 채로 남는다 — 실제로 기능명세서가 통째로 비었는데
 * 개요 화면은 "생성 완료" 라고 표시했다. 같은 화면의 정보구조도 카드는
 * "기능명세서를 먼저 만들어 주세요" 라고 옳게 말하고 있었다.
 * **한쪽은 기록을, 다른 쪽은 내용을 보고 있었기 때문이다.**
 *
 * 사용자가 마지막 요구사항을 손으로 지워도 같은 일이 생긴다. AI 가 만들었든 손으로
 * 썼든, 화면이 답해야 할 질문은 하나다 — **지금 내용이 있는가.**
 *
 * 그래서 표시·판정은 전부 이 함수를 쓴다. `generated` 필드는 내보낸 JSON 과
 * 예전 플랜 파일에 남아 있으므로 데이터로는 계속 유지하되, **진실의 근거로 삼지 않는다.**
 */

import type { ArtifactKey, PlanDocuments } from './types';

function filled(text: unknown): boolean {
  return typeof text === 'string' && text.trim().length > 0;
}

/**
 * 목록에 항목이 있는가.
 *
 * 없는 필드를 빈 목록으로 본다. 예전 버전에서 만든 플랜, 손으로 고친 JSON,
 * 가져오기로 들어온 파일에는 필드가 통째로 빠져 있을 수 있다.
 * 이 함수는 이제 모든 화면이 그릴 때마다 부르므로, 여기서 터지면 **화면 전체가 죽는다.**
 * (실제로 `prd: {}` 인 플랜 하나 때문에 목록 화면이 통째로 안 그려졌다.)
 */
function any(list: unknown): boolean {
  return Array.isArray(list) && list.length > 0;
}

/** 이 산출물에 사람이 볼 만한 내용이 들어 있는가. */
export function hasArtifact(plan: PlanDocuments, key: ArtifactKey): boolean {
  switch (key) {
    case 'prd': {
      const prd = plan.prd as Partial<PlanDocuments['prd']> | undefined;
      if (!prd) return false;
      return (
        filled(prd.overview) ||
        filled(prd.background) ||
        any(prd.goals) ||
        any(prd.personas) ||
        any(prd.roles) ||
        any(prd.coreValues) ||
        any(prd.successMetrics) ||
        any(prd.inScope) ||
        any(prd.outOfScope) ||
        any(prd.constraints)
      );
    }
    // 요구사항 없이 기능만 남는 일은 없다. 요구사항이 뿌리다.
    case 'fs':
      return any(plan.requirements);
    case 'ia':
      return any(plan.iaPages);
    case 'flow':
      return any(plan.flows);
    case 'wireframe':
      return any(plan.wireframes);
  }
}

/** 만들어진 산출물 목록. */
export function madeArtifacts(plan: PlanDocuments): ArtifactKey[] {
  return (['prd', 'fs', 'ia', 'flow', 'wireframe'] as ArtifactKey[]).filter((key) =>
    hasArtifact(plan, key),
  );
}
