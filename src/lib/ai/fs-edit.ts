/**
 * AI 에이전트가 보낸 **기능명세서 수정**을 ID 로 맞춰 합친다.
 *
 * ## 왜 따로 두는가
 *
 * 에이전트 수정은 원래 산출물을 통째로 갈아 끼우는 방식이었다. 그래서
 * "FN-001, FN-003, FN-005 에 상세명세를 만들어 줘" 처럼 **세 항목만 건드리는 요청**에도
 * 요구사항 6개와 기능 22개를 빠짐없이 다시 적어 보내야 했다.
 *
 * 모델은 그렇게 하지 않는다. 시킨 것만 담아 보낸다 — 그게 사람이 보기에 자연스럽다.
 * 그러면 나머지가 통째로 사라지므로 내용 손실 감시가 막아섰고, 결국 **아무것도
 * 반영되지 않았다.** 모델은 "추가했습니다" 라고 답하는데 문서는 그대로였다.
 *
 * 프롬프트로 "전부 담으라" 고 더 세게 말하는 것은 답이 아니다. 문서가 클수록
 * 다시 적어야 할 양이 늘고, 늘수록 빠뜨릴 확률이 올라간다. 구조가 잘못됐다.
 *
 * ## 규칙
 *
 * **손댄 것만 ID 와 함께 받는다.**
 *
 * - ID 가 이미 있는 것 → 보낸 항목만 고쳐 덮는다. 안 보낸 항목은 그대로 둔다.
 * - ID 가 없거나 모르는 것 → 새로 만들어 **뒤에 붙인다.**
 * - **무엇도 지우지 않는다.** 지우는 일은 화면에서 눈으로 보고 해야 한다.
 *
 * 이 방식은 항목 수가 줄어들 수 없다. 그래서 내용 손실 감시에 걸리지 않는다.
 * (감시는 그대로 둔다 — 다른 산출물은 아직 통째로 갈아 끼우기 때문이다.)
 */

import { nextIds } from '../ids';
import type { Feature, Plan, Priority, Requirement, Specification } from '../types';

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];
function toPriority(value: unknown, fallback: Priority = 'P1'): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : fallback;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback;
}

/** 에이전트가 보내는 기능명세서 수정안. 전부 선택이고, 손댄 것만 담는다. */
export interface FsEditDraft {
  requirements?: {
    id?: string;
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
  }[];
  features?: {
    id?: string;
    requirementId?: string;
    name?: string;
    description?: string;
    priority?: string;
  }[];
  specifications?: {
    id?: string;
    featureId?: string;
    title?: string;
    actor?: string;
    precondition?: string;
    mainFlow?: string[];
    exceptions?: string[];
    acceptanceCriteria?: string[];
    priority?: string;
  }[];
}

/**
 * 이 초안이 ID 로 맞춰 합칠 수 있는 모양인가.
 *
 * 처음부터 만드는 초안과 구별해야 한다. 그쪽은 상위 항목을 **번호**로 가리키고
 * (`requirementIndex` · `featureIndex`) ID 가 없다. 그것을 합치기로 처리하면
 * 기존 항목을 알아보지 못해 **전부 새 항목으로 뒤에 붙어 문서가 두 배가 된다.**
 * 그래서 번호로 가리키는 초안이 하나라도 섞여 있으면 합치기로 보지 않는다.
 */
export function looksLikeFsEdit(draft: unknown): draft is FsEditDraft {
  if (!draft || typeof draft !== 'object') return false;
  const d = draft as FsEditDraft & Record<string, unknown>;

  const groups = [d.requirements, d.features, d.specifications];
  if (!groups.some((g) => Array.isArray(g))) return false;

  const items = groups.flatMap((g) => (Array.isArray(g) ? g : [])) as Record<string, unknown>[];
  if (items.length === 0) return false;

  // 번호로 가리키는 항목이 하나라도 있으면 "처음부터 만드는 초안" 이다.
  if (items.some((it) => 'requirementIndex' in it || 'featureIndex' in it)) return false;

  // ID 로 가리키는 항목이 하나라도 있어야 합칠 근거가 된다.
  return items.some(
    (it) =>
      typeof it.id === 'string' ||
      typeof it.requirementId === 'string' ||
      typeof it.featureId === 'string',
  );
}

export interface FsEditResult {
  requirements: Requirement[];
  features: Feature[];
  specifications: Specification[];
  /** 무엇이 늘고 무엇이 바뀌었는지 — 로그와 검증에 쓴다. */
  added: { requirements: number; features: number; specifications: number };
  updated: { requirements: number; features: number; specifications: number };
}

export function applyFsEdit(plan: Plan, draft: FsEditDraft): FsEditResult {
  const requirements = [...(plan.requirements ?? [])];
  const features = [...(plan.features ?? [])];
  const specifications = [...(plan.specifications ?? [])];

  const added = { requirements: 0, features: 0, specifications: 0 };
  const updated = { requirements: 0, features: 0, specifications: 0 };

  /* 요구사항 --------------------------------------------------------- */
  for (const raw of draft.requirements ?? []) {
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
      updated.requirements += 1;
      continue;
    }
    if (!text(raw.title).trim()) continue; // 이름 없는 항목은 만들지 않는다
    requirements.push({
      id: nextIds('REQ', requirements, 1)[0],
      title: text(raw.title),
      description: text(raw.description),
      category: text(raw.category) || '공통',
      priority: toPriority(raw.priority),
      order: requirements.length,
      review: 'pending',
    });
    added.requirements += 1;
  }

  /* 기능 ------------------------------------------------------------- */
  const orderIn = (list: { order: number }[]) =>
    list.length === 0 ? 0 : Math.max(...list.map((x) => x.order)) + 1;

  for (const raw of draft.features ?? []) {
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
      updated.features += 1;
      continue;
    }
    if (!text(raw.name).trim()) continue;
    // 상위 요구사항을 모르면 만들지 않는다. 엉뚱한 곳에 붙으면 되돌리기 어렵다.
    const parent = requirements.find((r) => r.id === raw.requirementId);
    if (!parent) continue;
    features.push({
      id: nextIds('FN', features, 1)[0],
      requirementId: parent.id,
      name: text(raw.name),
      description: text(raw.description),
      priority: toPriority(raw.priority),
      status: '작성중',
      order: orderIn(features.filter((f) => f.requirementId === parent.id)),
      review: 'pending',
    });
    added.features += 1;
  }

  /* 상세 기능 --------------------------------------------------------- */
  for (const raw of draft.specifications ?? []) {
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
      updated.specifications += 1;
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
      order: orderIn(specifications.filter((s) => s.featureId === parent.id)),
      review: 'pending',
    });
    added.specifications += 1;
  }

  return { requirements, features, specifications, added, updated };
}

/** 무엇을 했는지 한 줄로. 아무것도 안 했으면 null. */
export function describeFsEdit(result: FsEditResult): string | null {
  const parts: string[] = [];
  const say = (n: number, label: string, verb: string) => {
    if (n > 0) parts.push(`${label} ${n}개 ${verb}`);
  };
  say(result.added.requirements, '요구사항', '추가');
  say(result.added.features, '기능', '추가');
  say(result.added.specifications, '상세 기능', '추가');
  say(result.updated.requirements, '요구사항', '수정');
  say(result.updated.features, '기능', '수정');
  say(result.updated.specifications, '상세 기능', '수정');
  return parts.length > 0 ? parts.join(' · ') : null;
}
