/**
 * AI 제안 검토 (승인 / 거절).
 *
 * AI 가 기능명세서를 만들면 요구사항·기능·상세명세에 `review: 'pending'` 이 붙는다.
 * 사용자는 항목마다 **승인**(표시를 지움)하거나 **거절**(항목을 지움)한다.
 *
 * 삭제 캐스케이드가 여기 있는 이유: 거절은 결국 삭제이고, 일반 삭제와 **똑같이**
 * 동작해야 한다. 두 곳에 나눠 두면 한쪽만 고쳐져 IA 의 기능 연결이 남는 식으로 어긋난다.
 */

import type { Feature, Plan, Requirement, Reviewable, Specification } from './types';

export type ReviewKind = 'requirement' | 'feature' | 'specification';

export interface ReviewTarget {
  kind: ReviewKind;
  id: string;
}

/** 검토 대기 항목 하나. 하단 바에서 순서대로 넘겨 볼 때 쓴다. */
export interface PendingItem extends ReviewTarget {
  label: string;
  /** REQ-001 같은 표시용 ID */
  tag: string;
}

export function isPending(item: Reviewable) {
  return item.review === 'pending';
}

/** 승인 = 표시를 지운다. 필드가 없는 상태가 곧 승인된 상태다. */
export function stripReview<T extends Reviewable>(item: T): T {
  if (item.review === undefined) return item;
  const next = { ...item };
  delete next.review;
  return next;
}

/* 삭제 캐스케이드 --------------------------------------------------- */

export function removeRequirementFrom(plan: Plan, id: string) {
  const featureIds = plan.features.filter((f) => f.requirementId === id).map((f) => f.id);
  plan.requirements = plan.requirements.filter((r) => r.id !== id);
  plan.features = plan.features.filter((f) => f.requirementId !== id);
  plan.specifications = plan.specifications.filter((s) => !featureIds.includes(s.featureId));
  plan.iaPages = plan.iaPages.map((p) => ({
    ...p,
    featureIds: p.featureIds.filter((fid) => !featureIds.includes(fid)),
  }));
}

export function removeFeatureFrom(plan: Plan, id: string) {
  plan.features = plan.features.filter((f) => f.id !== id);
  plan.specifications = plan.specifications.filter((s) => s.featureId !== id);
  plan.iaPages = plan.iaPages.map((p) => ({
    ...p,
    featureIds: p.featureIds.filter((fid) => fid !== id),
  }));
}

export function removeSpecificationFrom(plan: Plan, id: string) {
  plan.specifications = plan.specifications.filter((s) => s.id !== id);
}

/* 승인 / 거절 ------------------------------------------------------- */

export function approveIn(plan: Plan, target: ReviewTarget) {
  switch (target.kind) {
    case 'requirement':
      plan.requirements = plan.requirements.map((r) => (r.id === target.id ? stripReview(r) : r));
      return;
    case 'feature':
      plan.features = plan.features.map((f) => (f.id === target.id ? stripReview(f) : f));
      return;
    case 'specification':
      plan.specifications = plan.specifications.map((s) =>
        s.id === target.id ? stripReview(s) : s,
      );
  }
}

export function rejectIn(plan: Plan, target: ReviewTarget) {
  switch (target.kind) {
    case 'requirement':
      return removeRequirementFrom(plan, target.id);
    case 'feature':
      return removeFeatureFrom(plan, target.id);
    case 'specification':
      return removeSpecificationFrom(plan, target.id);
  }
}

/* 목록 --------------------------------------------------------------- */

const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

/**
 * 검토 대기 항목을 트리 순서(요구사항 → 그 기능 → 그 명세)로 늘어놓는다.
 * 하단 검토 바의 `1 / 12` 순서가 화면에 보이는 순서와 같아야 하기 때문이다.
 */
export function collectPending(
  requirements: Requirement[],
  features: Feature[],
  specifications: Specification[],
): PendingItem[] {
  const out: PendingItem[] = [];

  for (const req of [...requirements].sort(byOrder)) {
    if (isPending(req)) {
      out.push({ kind: 'requirement', id: req.id, label: req.title, tag: req.id });
    }
    for (const feature of features.filter((f) => f.requirementId === req.id).sort(byOrder)) {
      if (isPending(feature)) {
        out.push({ kind: 'feature', id: feature.id, label: feature.name, tag: feature.id });
      }
      for (const spec of specifications.filter((s) => s.featureId === feature.id).sort(byOrder)) {
        if (isPending(spec)) {
          out.push({ kind: 'specification', id: spec.id, label: spec.title, tag: spec.id });
        }
      }
    }
  }

  return out;
}
