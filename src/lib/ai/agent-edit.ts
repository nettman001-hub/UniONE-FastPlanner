/**
 * AI 에이전트가 보낸 수정을 **기존 문서에 합친다.**
 *
 * ## 왜 필요한가
 *
 * 원래는 산출물을 통째로 갈아 끼웠다. 그래서 "FN-001·FN-003·FN-005 에 상세명세를
 * 만들어 줘" 처럼 **세 항목만 건드리는 요청**에도 요구사항 6개와 기능 22개를 빠짐없이
 * 다시 적어 보내야 했다.
 *
 * 모델은 그렇게 하지 않는다. 시킨 것만 담아 보낸다 — 사람이 보기에 그게 자연스럽다.
 * 그러면 나머지가 통째로 사라지므로 내용 손실 감시가 막아섰고, 결국 **아무것도
 * 반영되지 않았다.** 모델은 "추가했습니다" 라고 답하는데 문서는 그대로였다.
 *
 * 프롬프트로 "전부 담으라" 고 더 세게 말하는 것은 답이 아니다. 문서가 클수록
 * 다시 적어야 할 양이 늘고, 늘수록 빠뜨릴 확률이 올라간다. 출력 상한을 올려도
 * 마찬가지다 — 잘린 것이 아니라 처음부터 일부만 보낸 것이기 때문이다.
 *
 * ## 규칙
 *
 * **손댄 것만 받는다. 무엇도 지우지 않는다.**
 *
 * - 목록형(기능명세서·정보구조도·유저 플로우·와이어프레임)은 **ID 로 맞춘다.**
 *   아는 ID 는 보낸 자리만 고쳐 덮고, 모르는 것은 뒤에 붙인다.
 * - PRD 는 ID 가 없다. **보낸 항목(필드)만** 갈아 끼우고 나머지는 건드리지 않는다.
 *
 * 지우는 일은 화면에서 눈으로 보고 해야 한다. 여기서는 항목 수가 줄어들 수 없으므로
 * 내용 손실 감시에 걸릴 일도 없다. (감시는 그대로 둔다 — 마지막 그물이다.)
 *
 * ## 처음부터 만드는 초안과 구별한다
 *
 * 생성 단계의 초안은 상위 항목을 **번호**로 가리키고(`requirementIndex`·`parentIndex`)
 * ID 가 없다. 그것을 합치기로 처리하면 기존 항목을 알아보지 못해 **전부 새 항목으로
 * 붙어 문서가 두 배가 된다.** 그래서 번호로 가리키는 항목이 섞여 있으면 합치기로
 * 보지 않고, 예전처럼 통째로 갈아 끼우는 길로 보낸다.
 */

import { nextIds, uid } from '../ids';
import { WIREFRAME_BLOCK_LABEL } from '../types';
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
import type { ArtifactKey } from '../types';

/* ------------------------------------------------------------------ */
/* 작은 도구들                                                          */
/* ------------------------------------------------------------------ */

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];
function toPriority(value: unknown, fallback: Priority = 'P1'): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : fallback;
}

const PAGE_TYPES: IaPageType[] = ['page', 'modal', 'tab', 'section'];
const NODE_TYPES: FlowNodeType[] = ['start', 'screen', 'action', 'decision', 'system', 'end'];
// 종류 목록은 한 곳에서만 정한다. 여기 손으로 베껴 두면 새 블록이 생겼을 때 조용히 빠진다.
const BLOCK_TYPES = Object.keys(WIREFRAME_BLOCK_LABEL) as WireframeBlockType[];

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback;
}

/** 같은 부모 아래 마지막 순번 다음. */
function nextOrder(items: { order: number }[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map((x) => x.order)) + 1;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]) : [];
}

/** 합친 결과. 무엇이 늘고 무엇이 바뀌었는지 함께 돌려준다. */
export interface EditResult {
  patch: Partial<PlanDocuments>;
  added: number;
  updated: number;
  /** 사람이 읽을 한 줄 요약. */
  summary: string;
}

function summarize(parts: [number, string, string][]): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label, verb]) => `${label} ${n}개 ${verb}`)
    .join(' · ');
}

/* ------------------------------------------------------------------ */
/* 기능명세서                                                           */
/* ------------------------------------------------------------------ */

function isFsEdit(draft: Record<string, unknown>): boolean {
  const items = [...rows(draft.requirements), ...rows(draft.features), ...rows(draft.specifications)];
  if (items.length === 0) return false;
  // 번호로 가리키면 처음부터 만드는 초안이다.
  if (items.some((it) => 'requirementIndex' in it || 'featureIndex' in it)) return false;
  return items.some(
    (it) =>
      typeof it.id === 'string' ||
      typeof it.requirementId === 'string' ||
      typeof it.featureId === 'string',
  );
}

function mergeFs(plan: Plan, draft: Record<string, unknown>): EditResult {
  const requirements = [...(plan.requirements ?? [])];
  const features = [...(plan.features ?? [])];
  const specifications = [...(plan.specifications ?? [])];
  const add = { req: 0, fn: 0, sp: 0 };
  const upd = { req: 0, fn: 0, sp: 0 };

  for (const raw of rows(draft.requirements)) {
    const at = requirements.findIndex((r) => r.id === raw.id);
    if (at >= 0) {
      const was = requirements[at];
      requirements[at] = {
        ...was,
        title: text(raw.title, was.title),
        description: text(raw.description, was.description),
        category: text(raw.category, was.category) || '공통',
        priority: toPriority(raw.priority, was.priority),
      };
      upd.req += 1;
      continue;
    }
    if (!text(raw.title).trim()) continue;
    requirements.push({
      id: nextIds('REQ', requirements, 1)[0],
      title: text(raw.title),
      description: text(raw.description),
      category: text(raw.category) || '공통',
      priority: toPriority(raw.priority),
      order: nextOrder(requirements),
      review: 'pending',
    } satisfies Requirement);
    add.req += 1;
  }

  for (const raw of rows(draft.features)) {
    const at = features.findIndex((f) => f.id === raw.id);
    if (at >= 0) {
      const was = features[at];
      const parent = requirements.find((r) => r.id === raw.requirementId);
      features[at] = {
        ...was,
        requirementId: parent ? parent.id : was.requirementId,
        name: text(raw.name, was.name),
        description: text(raw.description, was.description),
        priority: toPriority(raw.priority, was.priority),
      };
      upd.fn += 1;
      continue;
    }
    if (!text(raw.name).trim()) continue;
    // 상위를 모르면 만들지 않는다. 엉뚱한 곳에 붙으면 되돌리기 어렵다.
    const parent = requirements.find((r) => r.id === raw.requirementId);
    if (!parent) continue;
    features.push({
      id: nextIds('FN', features, 1)[0],
      requirementId: parent.id,
      name: text(raw.name),
      description: text(raw.description),
      priority: toPriority(raw.priority),
      status: '작성중',
      order: nextOrder(features.filter((f) => f.requirementId === parent.id)),
      review: 'pending',
    } satisfies Feature);
    add.fn += 1;
  }

  for (const raw of rows(draft.specifications)) {
    const at = specifications.findIndex((s) => s.id === raw.id);
    if (at >= 0) {
      const was = specifications[at];
      const parent = features.find((f) => f.id === raw.featureId);
      specifications[at] = {
        ...was,
        featureId: parent ? parent.id : was.featureId,
        title: text(raw.title, was.title),
        actor: text(raw.actor, was.actor) || '사용자',
        precondition: text(raw.precondition, was.precondition),
        mainFlow: list(raw.mainFlow, was.mainFlow),
        exceptions: list(raw.exceptions, was.exceptions),
        acceptanceCriteria: list(raw.acceptanceCriteria, was.acceptanceCriteria),
        priority: toPriority(raw.priority, was.priority),
      };
      upd.sp += 1;
      continue;
    }
    if (!text(raw.title).trim()) continue;
    const parent = features.find((f) => f.id === raw.featureId);
    if (!parent) continue;
    specifications.push({
      id: nextIds('SP', specifications, 1)[0],
      featureId: parent.id,
      title: text(raw.title),
      actor: text(raw.actor) || '사용자',
      precondition: text(raw.precondition),
      mainFlow: list(raw.mainFlow),
      exceptions: list(raw.exceptions),
      acceptanceCriteria: list(raw.acceptanceCriteria),
      pageIds: [],
      priority: toPriority(raw.priority),
      status: '작성중',
      order: nextOrder(specifications.filter((s) => s.featureId === parent.id)),
      review: 'pending',
    } satisfies Specification);
    add.sp += 1;
  }

  return {
    patch: { requirements, features, specifications },
    added: add.req + add.fn + add.sp,
    updated: upd.req + upd.fn + upd.sp,
    summary: summarize([
      [add.req, '요구사항', '추가'], [add.fn, '기능', '추가'], [add.sp, '상세 기능', '추가'],
      [upd.req, '요구사항', '수정'], [upd.fn, '기능', '수정'], [upd.sp, '상세 기능', '수정'],
    ]),
  };
}

/* ------------------------------------------------------------------ */
/* PRD                                                                  */
/* ------------------------------------------------------------------ */

/** PRD 에서 갈아 끼울 수 있는 칸들. */
const PRD_FIELDS = [
  'overview', 'background', 'goals', 'personas', 'roles',
  'environment', 'coreValues', 'successMetrics', 'inScope', 'outOfScope', 'constraints',
] as const;

const PRD_LABEL: Record<(typeof PRD_FIELDS)[number], string> = {
  overview: '제품 개요', background: '배경', goals: '핵심 목표', personas: '타겟 유저',
  roles: '사용자 역할', environment: '사용 환경', coreValues: '핵심 가치',
  successMetrics: '성공 지표', inScope: '포함 범위', outOfScope: '제외 범위',
  constraints: '제약사항',
};

/**
 * PRD 는 ID 가 없다. **보낸 칸만** 갈아 끼운다.
 *
 * 개요 한 줄을 고치라고 했을 때 목표·페르소나·역할까지 다시 적어 보내야 하는 것이
 * 문제였다. 안 보낸 칸은 손대지 않으므로 그런 요구가 사라진다.
 * 보낸 칸 **안에서** 항목이 줄어드는 것은 여전히 손실 감시가 본다.
 */
function isPrdEdit(draft: Record<string, unknown>): boolean {
  const touched = PRD_FIELDS.filter((f) => f in draft);
  // 전부 보냈으면 예전처럼 통째로 갈아 끼워도 결과가 같다. 합치기는 일부일 때 의미가 있다.
  return touched.length > 0 && touched.length < PRD_FIELDS.length;
}

function mergePrd(plan: Plan, draft: Record<string, unknown>): EditResult {
  const was = (plan.prd ?? {}) as Prd;
  const next = { ...was } as Prd;
  const touched: string[] = [];

  for (const field of PRD_FIELDS) {
    if (!(field in draft)) continue;
    const value = draft[field];
    if (value === null || value === undefined) continue;
    if (field === 'environment') {
      const env = value as Partial<Prd['environment']>;
      next.environment = {
        platforms: list(env?.platforms, was.environment?.platforms ?? []),
        devices: list(env?.devices, was.environment?.devices ?? []),
        browsers: list(env?.browsers, was.environment?.browsers ?? []),
      };
    } else if (field === 'overview' || field === 'background') {
      if (typeof value !== 'string') continue;
      next[field] = value;
    } else {
      if (!Array.isArray(value)) continue;
      // 타입은 화면 편집기와 같은 모양을 그대로 받는다.
      (next as unknown as Record<string, unknown>)[field] = value;
    }
    touched.push(PRD_LABEL[field]);
  }

  return {
    patch: { prd: next },
    added: 0,
    updated: touched.length,
    summary: touched.length > 0 ? `${touched.join(' · ')} 수정` : '',
  };
}

/* ------------------------------------------------------------------ */
/* 정보구조도                                                           */
/* ------------------------------------------------------------------ */

function isIaEdit(draft: Record<string, unknown>): boolean {
  const items = rows(draft.pages ?? draft.iaPages);
  if (items.length === 0) return false;
  // 번호로 부모를 가리키면 처음부터 만드는 초안이다.
  if (items.some((it) => 'parentIndex' in it)) return false;
  return items.some((it) => typeof it.id === 'string' || 'parentId' in it);
}

function mergeIa(plan: Plan, draft: Record<string, unknown>): EditResult {
  const pages = [...(plan.iaPages ?? [])];
  const featureIds = new Set((plan.features ?? []).map((f) => f.id));
  let added = 0;
  let updated = 0;

  for (const raw of rows(draft.pages ?? draft.iaPages)) {
    const at = pages.findIndex((p) => p.id === raw.id);
    // 부모는 **이미 있는 화면**만 가리킬 수 있다. 모르면 최상위로 둔다.
    const parentId =
      typeof raw.parentId === 'string' && pages.some((p) => p.id === raw.parentId)
        ? raw.parentId
        : null;

    if (at >= 0) {
      const wasPage = pages[at];
      pages[at] = {
        ...wasPage,
        // 자기 자신을 부모로 두면 트리가 끊긴다.
        parentId: 'parentId' in raw && parentId !== wasPage.id ? parentId : wasPage.parentId,
        name: text(raw.name, wasPage.name),
        path: text(raw.path, wasPage.path),
        description: text(raw.description, wasPage.description),
        type: PAGE_TYPES.includes(raw.type as IaPageType) ? (raw.type as IaPageType) : wasPage.type,
        roles: list(raw.roles, wasPage.roles),
        featureIds: Array.isArray(raw.featureIds)
          ? list(raw.featureIds).filter((id) => featureIds.has(id))
          : wasPage.featureIds,
      };
      updated += 1;
      continue;
    }
    if (!text(raw.name).trim()) continue;
    pages.push({
      id: nextIds('PG', pages, 1)[0],
      parentId,
      name: text(raw.name),
      path: text(raw.path) || '/',
      description: text(raw.description),
      type: PAGE_TYPES.includes(raw.type as IaPageType) ? (raw.type as IaPageType) : 'page',
      roles: list(raw.roles),
      featureIds: list(raw.featureIds).filter((id) => featureIds.has(id)),
      order: nextOrder(pages.filter((p) => p.parentId === parentId)),
    } satisfies IaPage);
    added += 1;
  }

  return {
    patch: { iaPages: pages },
    added,
    updated,
    summary: summarize([[added, '화면', '추가'], [updated, '화면', '수정']]),
  };
}

/* ------------------------------------------------------------------ */
/* 유저 플로우                                                          */
/* ------------------------------------------------------------------ */

function isFlowEdit(draft: Record<string, unknown>): boolean {
  const items = rows(draft.flows);
  if (items.length === 0) return false;
  return items.some((it) => typeof it.id === 'string');
}

/**
 * 플로우 하나는 통째로 갈아 끼운다.
 *
 * 단계와 연결선은 서로 얽혀 있어 한 개만 바꾸는 것이 의미가 없다. 대신 **플로우
 * 단위**로는 손댄 것만 받는다 — 플로우 하나는 다시 적기에 충분히 작다.
 */
function buildFlow(id: string, raw: Record<string, unknown>, order: number, pageIds: Set<string>): UserFlow {
  const keyMap = new Map<string, string>();
  const nodes: FlowNode[] = rows(raw.nodes).map((n, i) => {
    const nodeId = `${id}-n${i + 1}`;
    keyMap.set(text(n.key) || text(n.id) || `k${i}`, nodeId);
    const pageId = text(n.pageId);
    return {
      id: nodeId,
      type: NODE_TYPES.includes(n.type as FlowNodeType) ? (n.type as FlowNodeType) : 'action',
      label: text(n.label),
      description: text(n.description) || undefined,
      pageId: pageId && pageIds.has(pageId) ? pageId : null,
    };
  });
  const edges: FlowEdge[] = rows(raw.edges).flatMap<FlowEdge>((e, i) => {
    const from = keyMap.get(text(e.from));
    const to = keyMap.get(text(e.to));
    if (!from || !to) return [];
    return [{ id: `${id}-e${i + 1}`, from, to, label: text(e.label) || undefined }];
  });
  return {
    id,
    name: text(raw.name) || '이름 없는 플로우',
    description: text(raw.description),
    actor: text(raw.actor) || '사용자',
    nodes,
    edges,
    order,
  };
}

function mergeFlow(plan: Plan, draft: Record<string, unknown>): EditResult {
  const flows = [...(plan.flows ?? [])];
  const pageIds = new Set((plan.iaPages ?? []).map((p) => p.id));
  let added = 0;
  let updated = 0;

  for (const raw of rows(draft.flows)) {
    const at = flows.findIndex((f) => f.id === raw.id);
    if (at >= 0) {
      // 단계를 안 보냈으면 이름·설명만 고치려는 뜻이다. 그림을 지우지 않는다.
      const keepGraph = rows(raw.nodes).length === 0;
      const wasFlow = flows[at];
      flows[at] = keepGraph
        ? {
            ...wasFlow,
            name: text(raw.name, wasFlow.name),
            description: text(raw.description, wasFlow.description),
            actor: text(raw.actor, wasFlow.actor),
          }
        : { ...buildFlow(wasFlow.id, raw, wasFlow.order, pageIds) };
      updated += 1;
      continue;
    }
    if (rows(raw.nodes).length === 0) continue; // 단계 없는 새 플로우는 만들지 않는다
    const id = nextIds('FL', flows, 1)[0];
    flows.push(buildFlow(id, raw, nextOrder(flows), pageIds));
    added += 1;
  }

  return {
    patch: { flows },
    added,
    updated,
    summary: summarize([[added, '플로우', '추가'], [updated, '플로우', '수정']]),
  };
}

/* ------------------------------------------------------------------ */
/* 와이어프레임                                                         */
/* ------------------------------------------------------------------ */

function isWireframeEdit(draft: Record<string, unknown>): boolean {
  const items = rows(draft.wireframes);
  return items.length > 0 && items.some((it) => typeof it.pageId === 'string' || typeof it.id === 'string');
}

function toBlocks(raw: unknown): WireframeBlock[] {
  return rows(raw).map((b) => ({
    id: uid(),
    type: BLOCK_TYPES.includes(b.type as WireframeBlockType) ? (b.type as WireframeBlockType) : 'text',
    title: text(b.title),
    items: list(b.items),
    note: text(b.note) || undefined,
  }));
}

/**
 * 화면 하나가 단위다. 같은 페이지의 그림이 있으면 **그 자리에서** 갈아 끼운다.
 *
 * 예전에는 갈아 끼울 때도 새 WF 번호를 붙여, 손댄 적 없는 화면의 번호까지 밀렸다.
 * 기존 ID 를 그대로 쓰면 내보낸 문서에서 화면을 계속 같은 이름으로 부를 수 있다.
 */
function mergeWireframe(plan: Plan, draft: Record<string, unknown>): EditResult {
  const wireframes = [...(plan.wireframes ?? [])];
  const pages = plan.iaPages ?? [];
  const featuresByPage = new Map(pages.map((p) => [p.id, p.featureIds]));
  let added = 0;
  let updated = 0;

  for (const raw of rows(draft.wireframes)) {
    const pageId = text(raw.pageId);
    const at = wireframes.findIndex(
      (w) => (typeof raw.id === 'string' && w.id === raw.id) || (pageId && w.pageId === pageId),
    );
    const blocks = toBlocks(raw.blocks);

    if (at >= 0) {
      const wasWf = wireframes[at];
      wireframes[at] = {
        ...wasWf,
        name: text(raw.name, wasWf.name),
        device: raw.device === 'desktop' || raw.device === 'mobile'
          ? (raw.device as WireframeDevice)
          : wasWf.device,
        blocks: blocks.length > 0 ? blocks : wasWf.blocks,
        featureIds: featuresByPage.get(wasWf.pageId) ?? wasWf.featureIds,
      };
      updated += 1;
      continue;
    }
    // 정보구조도에 없는 화면의 그림은 만들지 않는다.
    if (!pageId || !pages.some((p) => p.id === pageId)) continue;
    if (blocks.length === 0) continue;
    wireframes.push({
      id: nextIds('WF', wireframes, 1)[0],
      pageId,
      name: text(raw.name) || pages.find((p) => p.id === pageId)?.name || '화면',
      device: raw.device === 'desktop' ? 'desktop' : 'mobile',
      blocks,
      order: nextOrder(wireframes),
      featureIds: featuresByPage.get(pageId) ?? [],
    } satisfies Wireframe);
    added += 1;
  }

  return {
    patch: { wireframes },
    added,
    updated,
    summary: summarize([[added, '와이어프레임', '추가'], [updated, '와이어프레임', '수정']]),
  };
}

/* ------------------------------------------------------------------ */

/**
 * 합칠 수 있으면 합쳐 돌려주고, 합칠 모양이 아니면 null.
 *
 * null 이면 부르는 쪽이 예전처럼 통째로 갈아 끼우는 길로 보낸다. 그 길에는
 * 내용 손실 감시가 그대로 서 있으므로, 판단이 빗나가도 조용히 지워지는 일은 없다.
 */
export function applyAgentEdit(
  plan: Plan,
  artifact: ArtifactKey,
  draft: unknown,
): EditResult | null {
  if (!draft || typeof draft !== 'object') return null;
  const d = draft as Record<string, unknown>;

  const result = (() => {
    switch (artifact) {
      case 'fs':
        return isFsEdit(d) ? mergeFs(plan, d) : null;
      case 'prd':
        return isPrdEdit(d) ? mergePrd(plan, d) : null;
      case 'ia':
        return isIaEdit(d) ? mergeIa(plan, d) : null;
      case 'flow':
        return isFlowEdit(d) ? mergeFlow(plan, d) : null;
      case 'wireframe':
        return isWireframeEdit(d) ? mergeWireframe(plan, d) : null;
    }
  })();

  // 맞춰 붙일 것이 하나도 없었다면 문서를 건드리지 않는다.
  if (!result || (result.added === 0 && result.updated === 0)) return null;
  return result;
}
