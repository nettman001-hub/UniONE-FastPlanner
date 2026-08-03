/**
 * 기능명세서 트리.
 *
 * 요구사항 → 기능 → 상세명세 계층을 한 번 만들어 여러 보기(마인드맵 · 리스트 · 표)가
 * 함께 쓴다. 검색·필터가 걸리면 걸러진 결과만 남기되, **부모가 조건에 맞으면 자식은
 * 전부 남긴다.** 요구사항 이름으로 검색했을 때 그 아래가 통째로 보여야 하기 때문이다.
 */

import type { Feature, Priority, Requirement, Specification, WorkStatus } from './types';

export interface FsTreeFeature {
  feature: Feature;
  specs: Specification[];
}

export interface FsTreeNode {
  req: Requirement;
  features: FsTreeFeature[];
}

export interface FsFilter {
  query: string;
  priority: 'all' | Priority;
  status: 'all' | WorkStatus;
}

export function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order;
}

/** 검색어·우선순위·상태 중 하나라도 걸려 있으면 필터링 중으로 본다. */
export function isFiltering(filter: FsFilter) {
  return filter.query.trim() !== '' || filter.priority !== 'all' || filter.status !== 'all';
}

export function buildFsTree(
  requirements: Requirement[],
  features: Feature[],
  specifications: Specification[],
  filter: FsFilter,
): FsTreeNode[] {
  const q = filter.query.trim().toLowerCase();
  const hit = (...parts: string[]) =>
    q === '' || parts.some((part) => part.toLowerCase().includes(q));
  const prioOk = (p: Priority) => filter.priority === 'all' || filter.priority === p;
  const statusOk = (s: WorkStatus) => filter.status === 'all' || filter.status === s;

  return [...requirements]
    .sort(byOrder)
    .map((req) => {
      const reqHit = hit(req.id, req.title, req.description, req.category);
      const nodes = [...features]
        .filter((f) => f.requirementId === req.id)
        .sort(byOrder)
        .map((feature) => {
          const featureHit = reqHit || hit(feature.id, feature.name, feature.description);
          const specs = [...specifications]
            .filter((s) => s.featureId === feature.id)
            .sort(byOrder)
            .filter(
              (s) =>
                (featureHit ||
                  hit(
                    s.id,
                    s.title,
                    s.actor,
                    s.precondition,
                    ...s.mainFlow,
                    ...s.exceptions,
                    ...s.acceptanceCriteria,
                  )) &&
                prioOk(s.priority) &&
                statusOk(s.status),
            );
          return {
            feature,
            specs,
            keep: featureHit && prioOk(feature.priority) && statusOk(feature.status),
          };
        })
        .filter((node) => node.keep || node.specs.length > 0)
        .map(({ feature, specs }) => ({ feature, specs }));

      return { req, features: nodes, keep: reqHit && prioOk(req.priority) };
    })
    .filter((node) => node.keep || node.features.length > 0)
    .map(({ req, features: list }) => ({ req, features: list }));
}
