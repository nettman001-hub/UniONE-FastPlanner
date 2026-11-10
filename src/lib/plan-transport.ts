import { pickDocuments, type Plan, type PlanVersion } from './types';

/** 작업본·목록에는 버전 이름과 시각만 싣고 스냅샷은 별도로 운반한다. */
export function versionSummary(version: PlanVersion): PlanVersion {
  const summary = { ...version };
  delete summary.snapshot;
  return summary;
}

export function compactPlan(plan: Plan): Plan {
  return { ...plan, versions: (plan.versions ?? []).map(versionSummary) };
}

/** AI에게 필요한 현재 문서만 보낸다. 대화·버전·생성 이미지 복사본은 제외한다. */
export function planForAi(plan: Plan): Plan {
  return {
    id: plan.id, brief: plan.brief,
    createdAt: plan.createdAt, updatedAt: plan.updatedAt, generated: plan.generated,
    ...pickDocuments(plan),
    chat: [], comments: [], versions: [], uinAiScreens: [],
  };
}
