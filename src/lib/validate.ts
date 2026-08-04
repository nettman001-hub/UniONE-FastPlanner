/**
 * 정합성 검사.
 *
 * 산출물끼리 연결이 끊긴 곳, 논리적으로 빈 곳을 찾아낸다.
 * 기획 문서는 서로 참조하기 때문에 한쪽만 고치면 조용히 깨지는데, 이걸 잡아 준다.
 */

import { ARTIFACT_LABEL, type ArtifactKey, type Plan } from './types';
import { stalePages } from './ia/wireframe-sync';
import { hasArtifact } from './artifact-status';

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  id: string;
  level: IssueLevel;
  /** 어느 산출물의 문제인지 */
  artifact: ArtifactKey;
  title: string;
  detail: string;
  /** 문제가 있는 항목 ID 들 */
  targets: string[];
  /** 이동할 경로 (플랜 기준 상대 경로) */
  href: string;
}

export const LEVEL_LABEL: Record<IssueLevel, string> = {
  error: '오류',
  warn: '경고',
  info: '제안',
};

export function validatePlan(plan: Plan): Issue[] {
  const issues: Issue[] = [];
  /** 대상이 하나도 없는 규칙은 통과한 것이므로 보고하지 않는다. */
  const add = (issue: Issue) => {
    if (issue.targets.length > 0) issues.push(issue);
  };

  /* PRD ------------------------------------------------------------ */
  if (hasArtifact(plan, 'prd')) {
    if (!plan.prd.overview.trim()) {
      issues.push({
        id: 'prd-overview-empty',
        level: 'error',
        artifact: 'prd',
        title: '제품 개요가 비어 있습니다',
        detail: '개요는 이후 모든 산출물 생성의 기준이 됩니다. 먼저 채워 주세요.',
        targets: ['overview'],
        href: '/prd',
      });
    }
    const goalsWithoutMetric = plan.prd.goals.filter((g) => !g.metric?.trim()).map((g) => g.text);
    add({
      id: 'prd-goal-no-metric',
      level: 'warn',
      artifact: 'prd',
      title: '판단 지표가 없는 핵심 목표',
      detail: '목표에 지표가 없으면 달성 여부를 확인할 수 없습니다.',
      targets: goalsWithoutMetric,
      href: '/prd',
    });
    if (plan.prd.roles.length === 0) {
      issues.push({
        id: 'prd-no-roles',
        level: 'warn',
        artifact: 'prd',
        title: '사용자 역할이 정의되지 않았습니다',
        detail: '역할이 없으면 정보구조도에서 화면별 접근 권한을 정할 수 없습니다.',
        targets: ['roles'],
        href: '/prd',
      });
    }
  }

  /* 기능명세서 ------------------------------------------------------ */
  const emptyRequirements = plan.requirements
    .filter((req) => !plan.features.some((f) => f.requirementId === req.id))
    .map((req) => `${req.id} ${req.title}`);
  add({
    id: 'fs-requirement-no-feature',
    level: 'warn',
    artifact: 'fs',
    title: '하위 기능이 없는 요구사항',
    detail: '요구사항은 최소 1개 이상의 기능으로 구현되어야 합니다.',
    targets: emptyRequirements,
    href: '/fs',
  });

  const orphanFeatures = plan.features
    .filter((f) => !plan.requirements.some((r) => r.id === f.requirementId))
    .map((f) => `${f.id} ${f.name}`);
  add({
    id: 'fs-orphan-feature',
    level: 'error',
    artifact: 'fs',
    title: '상위 요구사항이 사라진 기능',
    detail: '참조하는 요구사항이 삭제되었습니다. 다른 요구사항으로 옮기거나 삭제하세요.',
    targets: orphanFeatures,
    href: '/fs',
  });

  const p0WithoutSpec = plan.features
    .filter(
      (f) => f.priority === 'P0' && !plan.specifications.some((s) => s.featureId === f.id),
    )
    .map((f) => `${f.id} ${f.name}`);
  add({
    id: 'fs-p0-no-spec',
    level: 'warn',
    artifact: 'fs',
    title: '상세 명세가 없는 필수 기능',
    detail: '필수(P0) 기능은 개발 착수 전에 상세 명세가 있어야 합니다.',
    targets: p0WithoutSpec,
    href: '/fs',
  });

  const specWithoutCriteria = plan.specifications
    .filter((s) => s.acceptanceCriteria.length === 0)
    .map((s) => `${s.id} ${s.title}`);
  add({
    id: 'fs-spec-no-criteria',
    level: 'warn',
    artifact: 'fs',
    title: '인수 조건이 없는 상세 명세',
    detail: 'QA 가 검증할 기준이 없습니다.',
    targets: specWithoutCriteria,
    href: '/fs',
  });

  /* 정보구조도 ------------------------------------------------------ */
  if (hasArtifact(plan, 'ia')) {
    const pageIds = new Set(plan.iaPages.map((p) => p.id));

    const brokenParents = plan.iaPages
      .filter((p) => p.parentId && !pageIds.has(p.parentId))
      .map((p) => `${p.id} ${p.name}`);
    add({
      id: 'ia-broken-parent',
      level: 'error',
      artifact: 'ia',
      title: '상위 페이지가 사라진 페이지',
      detail: '부모 페이지가 삭제되어 트리에서 떨어져 나왔습니다.',
      targets: brokenParents,
      href: '/ia',
    });

    const linkedFeatureIds = new Set(plan.iaPages.flatMap((p) => p.featureIds));
    const unlinkedFeatures = plan.features
      .filter((f) => !linkedFeatureIds.has(f.id))
      .map((f) => `${f.id} ${f.name}`);
    add({
      id: 'ia-feature-not-placed',
      level: 'warn',
      artifact: 'ia',
      title: '어느 화면에도 배치되지 않은 기능',
      detail: '기능이 실제로 어느 화면에서 쓰이는지 연결해야 개발 범위가 명확해집니다.',
      targets: unlinkedFeatures,
      href: '/ia',
    });

    const duplicatePaths = Object.entries(
      plan.iaPages.reduce<Record<string, string[]>>((acc, page) => {
        (acc[page.path] ??= []).push(`${page.id} ${page.name}`);
        return acc;
      }, {}),
    )
      .filter(([, list]) => list.length > 1)
      .map(([path, list]) => `${path} — ${list.join(', ')}`);
    add({
      id: 'ia-duplicate-path',
      level: 'warn',
      artifact: 'ia',
      title: '경로가 중복된 페이지',
      detail: '같은 경로를 쓰는 화면이 둘 이상입니다.',
      targets: duplicatePaths,
      href: '/ia',
    });
  }

  /* 유저 플로우 ----------------------------------------------------- */
  for (const flow of plan.flows) {
    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const edge of flow.edges) {
      outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }

    const dangling = flow.edges
      .filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to))
      .map((e) => `${flow.id} ${e.from} → ${e.to}`);
    add({
      id: `flow-dangling-${flow.id}`,
      level: 'error',
      artifact: 'flow',
      title: `${flow.name}: 끊어진 연결선`,
      detail: '존재하지 않는 노드를 가리키는 연결선이 있습니다.',
      targets: dangling,
      href: '/flow',
    });

    const unreachable = flow.nodes
      .filter((n) => n.type !== 'start' && (incoming.get(n.id) ?? 0) === 0)
      .map((n) => `${flow.name} — ${n.label}`);
    add({
      id: `flow-unreachable-${flow.id}`,
      level: 'warn',
      artifact: 'flow',
      title: `${flow.name}: 도달할 수 없는 단계`,
      detail: '들어오는 연결선이 없어 이 단계에 도달할 방법이 없습니다.',
      targets: unreachable,
      href: '/flow',
    });

    const deadEnds = flow.nodes
      .filter((n) => n.type !== 'end' && (outgoing.get(n.id) ?? 0) === 0)
      .map((n) => `${flow.name} — ${n.label}`);
    add({
      id: `flow-dead-end-${flow.id}`,
      level: 'warn',
      artifact: 'flow',
      title: `${flow.name}: 빠져나갈 수 없는 단계`,
      detail: '나가는 연결선이 없는데 종료 노드도 아닙니다. 엣지 케이스가 누락됐을 수 있습니다.',
      targets: deadEnds,
      href: '/flow',
    });

    const lonelyDecisions = flow.nodes
      .filter((n) => n.type === 'decision' && (outgoing.get(n.id) ?? 0) < 2)
      .map((n) => `${flow.name} — ${n.label}`);
    add({
      id: `flow-decision-single-${flow.id}`,
      level: 'warn',
      artifact: 'flow',
      title: `${flow.name}: 분기가 하나뿐인 조건`,
      detail: '분기 노드에는 최소 두 갈래가 있어야 합니다. 실패·거절 경로가 빠졌는지 확인하세요.',
      targets: lonelyDecisions,
      href: '/flow',
    });
  }

  if (hasArtifact(plan, 'flow')) {
    const flowsWithoutEnd = plan.flows
      .filter((f) => !f.nodes.some((n) => n.type === 'end'))
      .map((f) => `${f.id} ${f.name}`);
    add({
      id: 'flow-no-end',
      level: 'warn',
      artifact: 'flow',
      title: '종료 지점이 없는 플로우',
      detail: '플로우가 어디서 끝나는지 정의되어 있지 않습니다.',
      targets: flowsWithoutEnd,
      href: '/flow',
    });
  }

  /* 와이어프레임 ---------------------------------------------------- */
  if (hasArtifact(plan, 'wireframe')) {
    const covered = new Set(plan.wireframes.map((w) => w.pageId));
    const uncoveredPages = plan.iaPages
      .filter((p) => p.type === 'page' && !covered.has(p.id) && p.featureIds.length > 0)
      .map((p) => `${p.id} ${p.name}`);
    add({
      id: 'wf-page-uncovered',
      level: 'info',
      artifact: 'wireframe',
      title: '와이어프레임이 없는 기능 화면',
      detail: '기능이 연결된 화면인데 아직 와이어프레임이 없습니다.',
      targets: uncoveredPages,
      href: '/wireframe',
    });

    /*
     * 화면에 기능이 더 붙었는데 그림은 그대로인 경우.
     *
     * 정보구조도에서 기능을 배치한 뒤 여기가 뒤처지면, 개발팀은
     * "기능명세서에는 있는데 화면에는 없는 것" 을 받는다. 개발 중에 발견되면
     * 화면을 다시 그려야 해서 일정이 밀린다.
     */
    const outdated = stalePages(plan)
      .filter((s) => s.reason === 'changed')
      .map((s) => `${s.page.id} ${s.page.name} — ${s.addedFeatures.join(', ')}`);
    add({
      id: 'wf-outdated',
      level: 'warn',
      artifact: 'wireframe',
      title: '기능이 더 붙었는데 그림은 그대로인 화면',
      detail: '와이어프레임을 만든 뒤에 이 화면에 기능이 추가되었습니다. 다시 만들어 반영하세요.',
      targets: outdated,
      href: '/wireframe',
    });

    const orphanWireframes = plan.wireframes
      .filter((w) => !plan.iaPages.some((p) => p.id === w.pageId))
      .map((w) => `${w.id} ${w.name}`);
    add({
      id: 'wf-orphan',
      level: 'error',
      artifact: 'wireframe',
      title: '대상 화면이 사라진 와이어프레임',
      detail: '연결된 IA 페이지가 삭제되었습니다.',
      targets: orphanWireframes,
      href: '/wireframe',
    });

    const emptyWireframes = plan.wireframes
      .filter((w) => w.blocks.length === 0)
      .map((w) => `${w.id} ${w.name}`);
    add({
      id: 'wf-empty',
      level: 'warn',
      artifact: 'wireframe',
      title: '블록이 없는 와이어프레임',
      detail: '화면 구성이 비어 있습니다.',
      targets: emptyWireframes,
      href: '/wireframe',
    });
  }

  /* 미생성 산출물 --------------------------------------------------- */
  const missing = (Object.keys(ARTIFACT_LABEL) as ArtifactKey[]).filter(
    (key) => !hasArtifact(plan, key),
  );
  if (missing.length > 0) {
    issues.push({
      id: 'plan-missing-artifacts',
      level: 'info',
      artifact: missing[0],
      title: '아직 만들지 않은 산출물이 있습니다',
      detail: missing.map((k) => ARTIFACT_LABEL[k]).join(', '),
      targets: missing.map((k) => ARTIFACT_LABEL[k]),
      href: '',
    });
  }

  return issues;
}

export function issueSummary(issues: Issue[]) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warn: issues.filter((i) => i.level === 'warn').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}
