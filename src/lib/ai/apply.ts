/**
 * AI/내장 생성기가 만든 초안(draft)을 도메인 객체로 변환한다.
 * ID 부여, 참조 검증, 기본값 채우기를 모두 여기서 처리한다.
 */

import { nextIds } from '../ids';
import type {
  Feature,
  FlowEdge,
  FlowNode,
  FlowNodeType,
  IaPage,
  IaPageType,
  Plan,
  PlanDocuments,
  Prd,
  Priority,
  Requirement,
  Specification,
  UserFlow,
  Wireframe,
  WireframeBlock,
  WireframeBlockType,
  WireframeDevice,
} from '../types';
import type { FlowDraft, FsDraft, IaDraft, PrdDraft, WireframeDraft } from './schemas';
import { uid } from '../ids';

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];
function toPriority(value: string | undefined): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : 'P1';
}

const PAGE_TYPES: IaPageType[] = ['page', 'modal', 'tab', 'section'];
function toPageType(value: string | undefined): IaPageType {
  return PAGE_TYPES.includes(value as IaPageType) ? (value as IaPageType) : 'page';
}

const NODE_TYPES: FlowNodeType[] = ['start', 'screen', 'action', 'decision', 'system', 'end'];
function toNodeType(value: string | undefined): FlowNodeType {
  return NODE_TYPES.includes(value as FlowNodeType) ? (value as FlowNodeType) : 'action';
}

const BLOCK_TYPES: WireframeBlockType[] = [
  'header',
  'nav',
  'hero',
  'search',
  'filter',
  'list',
  'card-grid',
  'table',
  'form',
  'detail',
  'tabs',
  'text',
  'image',
  'chart',
  'banner',
  'cta',
  'footer',
];
function toBlockType(value: string | undefined): WireframeBlockType {
  return BLOCK_TYPES.includes(value as WireframeBlockType)
    ? (value as WireframeBlockType)
    : 'text';
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/* ------------------------------------------------------------------ */

export function applyPrd(draft: PrdDraft): Prd {
  return {
    overview: draft.overview ?? '',
    background: draft.background ?? '',
    goals: (draft.goals ?? []).map((g) => ({ id: uid('goal'), text: g.text, metric: g.metric })),
    personas: (draft.personas ?? []).map((p) => ({
      id: uid('persona'),
      name: p.name,
      summary: p.summary,
      needs: arr(p.needs),
      painPoints: arr(p.painPoints),
    })),
    roles: (draft.roles ?? []).map((r) => ({
      id: uid('role'),
      name: r.name,
      description: r.description,
      permissions: arr(r.permissions),
    })),
    environment: {
      platforms: arr(draft.environment?.platforms),
      devices: arr(draft.environment?.devices),
      browsers: arr(draft.environment?.browsers),
    },
    coreValues: arr(draft.coreValues),
    successMetrics: (draft.successMetrics ?? []).map((m) => ({
      id: uid('metric'),
      name: m.name,
      target: m.target,
    })),
    inScope: arr(draft.inScope),
    outOfScope: arr(draft.outOfScope),
    constraints: arr(draft.constraints),
  };
}

export interface FsResult {
  requirements: Requirement[];
  features: Feature[];
  specifications: Specification[];
}

export function applyFs(draft: FsDraft): FsResult {
  const rawRequirements = draft.requirements ?? [];
  const rawFeatures = draft.features ?? [];
  const rawSpecs = draft.specifications ?? [];

  const reqIds = nextIds('REQ', [], rawRequirements.length);
  const requirements: Requirement[] = rawRequirements.map((r, i) => ({
    id: reqIds[i],
    title: r.title,
    description: r.description ?? '',
    category: r.category || '공통',
    priority: toPriority(r.priority),
    order: i,
    // AI 가 만든 항목은 검토 전이다. 사용자가 승인해야 배지가 사라진다.
    review: 'pending',
  }));

  // 상위 요구사항 인덱스가 범위를 벗어나면 첫 요구사항에 붙인다.
  const validFeatures = rawFeatures.filter(() => requirements.length > 0);
  const featureIds = nextIds('FN', [], validFeatures.length);
  const perRequirementCount = new Map<string, number>();
  const features: Feature[] = validFeatures.map((f, i) => {
    const index = Number.isInteger(f.requirementIndex) ? f.requirementIndex : 0;
    const requirement = requirements[index] ?? requirements[0];
    const order = perRequirementCount.get(requirement.id) ?? 0;
    perRequirementCount.set(requirement.id, order + 1);
    return {
      id: featureIds[i],
      requirementId: requirement.id,
      name: f.name,
      description: f.description ?? '',
      priority: toPriority(f.priority),
      status: '작성중',
      order,
      review: 'pending',
    };
  });

  const validSpecs = rawSpecs.filter(() => features.length > 0);
  const specIds = nextIds('SP', [], validSpecs.length);
  const perFeatureCount = new Map<string, number>();
  const specifications: Specification[] = validSpecs.map((s, i) => {
    const index = Number.isInteger(s.featureIndex) ? s.featureIndex : 0;
    const feature = features[index] ?? features[0];
    const order = perFeatureCount.get(feature.id) ?? 0;
    perFeatureCount.set(feature.id, order + 1);
    return {
      id: specIds[i],
      featureId: feature.id,
      title: s.title,
      actor: s.actor || '사용자',
      precondition: s.precondition ?? '',
      mainFlow: arr(s.mainFlow),
      exceptions: arr(s.exceptions),
      acceptanceCriteria: arr(s.acceptanceCriteria),
      pageIds: [],
      priority: toPriority(s.priority),
      status: '작성중',
      order,
      review: 'pending',
    };
  });

  return { requirements, features, specifications };
}

export function applyIa(draft: IaDraft, knownFeatureIds: string[]): IaPage[] {
  const raw = draft.pages ?? [];
  const ids = nextIds('PG', [], raw.length);
  const featureIdSet = new Set(knownFeatureIds);
  const orderByParent = new Map<string | null, number>();

  return raw.map((p, i) => {
    // parentIndex 는 반드시 자기보다 앞이어야 한다. 아니면 1 depth 로 올린다.
    const parentIndex =
      Number.isInteger(p.parentIndex) && p.parentIndex >= 0 && p.parentIndex < i
        ? p.parentIndex
        : -1;
    const parentId = parentIndex === -1 ? null : ids[parentIndex];
    const order = orderByParent.get(parentId) ?? 0;
    orderByParent.set(parentId, order + 1);

    return {
      id: ids[i],
      parentId,
      name: p.name,
      path: p.path || '/',
      description: p.description ?? '',
      type: toPageType(p.type),
      roles: arr(p.roles),
      featureIds: arr(p.featureIds).filter((fid) => featureIdSet.has(fid)),
      order,
    };
  });
}

export function applyFlows(draft: FlowDraft, knownPageIds: string[]): UserFlow[] {
  const raw = draft.flows ?? [];
  const ids = nextIds('FL', [], raw.length);
  const pageIdSet = new Set(knownPageIds);

  return raw.map((f, i) => {
    // 플로우 내부 key 를 전역 유일 ID 로 바꾼다.
    const keyMap = new Map<string, string>();
    const nodes: FlowNode[] = (f.nodes ?? []).map((n, ni) => {
      const nodeId = `${ids[i]}-n${ni + 1}`;
      keyMap.set(n.key, nodeId);
      return {
        id: nodeId,
        type: toNodeType(n.type),
        label: n.label,
        description: n.description || undefined,
        pageId: n.pageId && pageIdSet.has(n.pageId) ? n.pageId : null,
      };
    });

    const edges: FlowEdge[] = (f.edges ?? []).flatMap<FlowEdge>((e, ei) => {
      const from = keyMap.get(e.from);
      const to = keyMap.get(e.to);
      if (!from || !to) return [];
      return [{ id: `${ids[i]}-e${ei + 1}`, from, to, label: e.label || undefined }];
    });

    return {
      id: ids[i],
      name: f.name,
      description: f.description ?? '',
      actor: f.actor || '사용자',
      nodes,
      edges,
      order: i,
    };
  });
}

export function applyWireframes(
  draft: WireframeDraft,
  knownPageIds: string[],
  startFrom: readonly { id: string }[] = [],
  /**
   * 페이지별 기능 목록. 만들 때의 기능 구성을 와이어프레임에 새겨 둔다.
   * 나중에 그 페이지에 기능이 더 붙으면 "뒤처진 화면" 으로 찾아낼 수 있다.
   */
  featuresByPage: Record<string, string[]> = {},
): Wireframe[] {
  const raw = (draft.wireframes ?? []).filter((w) => knownPageIds.includes(w.pageId));
  const ids = nextIds('WF', startFrom, raw.length);

  return raw.map((w, i) => {
    const blocks: WireframeBlock[] = (w.blocks ?? []).map((b, bi) => ({
      id: `${ids[i]}-b${bi + 1}`,
      type: toBlockType(b.type),
      title: b.title,
      items: arr(b.items),
      note: b.note || undefined,
    }));
    return {
      id: ids[i],
      pageId: w.pageId,
      name: w.name,
      device: (w.device === 'mobile' ? 'mobile' : 'desktop') as WireframeDevice,
      blocks,
      order: i,
      featureIds: [...(featuresByPage[w.pageId] ?? [])],
    };
  });
}

/** 산출물 초안을 플랜 문서 패치로 변환한다. */
export function draftToPatch(
  artifact: 'prd' | 'fs' | 'ia' | 'flow' | 'wireframe',
  draft: unknown,
  plan: Plan,
  options?: { mergeWireframes?: boolean },
): Partial<PlanDocuments> {
  switch (artifact) {
    case 'prd':
      return { prd: applyPrd(draft as PrdDraft) };
    case 'fs': {
      const { requirements, features, specifications } = applyFs(draft as FsDraft);
      return { requirements, features, specifications };
    }
    case 'ia': {
      const iaPages = applyIa(
        draft as IaDraft,
        plan.features.map((f) => f.id),
      );
      return { iaPages };
    }
    case 'flow': {
      const flows = applyFlows(
        draft as FlowDraft,
        plan.iaPages.map((p) => p.id),
      );
      return { flows };
    }
    case 'wireframe': {
      const knownPageIds = plan.iaPages.map((p) => p.id);
      const featuresByPage = Object.fromEntries(
        plan.iaPages.map((p) => [p.id, p.featureIds]),
      );
      if (options?.mergeWireframes) {
        const incoming = applyWireframes(
          draft as WireframeDraft,
          knownPageIds,
          plan.wireframes,
          featuresByPage,
        );
        const replacedPages = new Set(incoming.map((w) => w.pageId));
        const kept = plan.wireframes.filter((w) => !replacedPages.has(w.pageId));
        return { wireframes: [...kept, ...incoming].map((w, i) => ({ ...w, order: i })) };
      }
      return {
        wireframes: applyWireframes(draft as WireframeDraft, knownPageIds, [], featuresByPage),
      };
    }
    default:
      return {};
  }
}
