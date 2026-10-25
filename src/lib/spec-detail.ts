/**
 * 상세명세의 확장 칸 — 비즈니스 규칙 · 입력 항목 · 상태 변화 · 사후 조건 · 역할별 차이.
 *
 * 이 칸이 생기기 전에 저장된 플랜과 가져온 파일에는 필드가 없다. 그래서 **읽는 쪽은 모두
 * 여기 `detailOf` 를 거쳐** 빈 배열로 다룬다.
 *
 * AI 가 낸 값을 다듬는 것도 한 곳에 둔다. 상세명세가 생기는 경로가 여럿(`applyFs`·`appendSpecs`·
 * AI 에이전트)이라, 따로 두면 한쪽만 고쳐져 칸이 비어 나온다.
 */

import type { Specification, SpecInput, SpecStateChange } from './types';

/** 한 칸에 담을 줄 수 상한. 모델이 같은 말을 늘어놓아도 화면이 무너지지 않게. */
const MAX_ROWS = 12;
/** 한 줄 길이 상한. */
const MAX_LEN = 300;

export type SpecDetail = Required<
  Pick<Specification, 'businessRules' | 'inputs' | 'stateChanges' | 'postconditions' | 'roleDifferences'>
>;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_LEN) : '';
}

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[])
    : [];
}

export function toLines(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, MAX_ROWS) : [];
}

export function toInputs(value: unknown): SpecInput[] {
  return objects(value)
    .map((r) => ({ name: clean(r.name), required: r.required === true, rule: clean(r.rule) }))
    .filter((r) => r.name)
    .slice(0, MAX_ROWS);
}

export function toStateChanges(value: unknown): SpecStateChange[] {
  return objects(value)
    .map((r) => ({ entity: clean(r.entity), from: clean(r.from), to: clean(r.to), trigger: clean(r.trigger) }))
    // 바뀐 뒤 상태가 없으면 상태 변화라고 할 수 없다.
    .filter((r) => r.to)
    .slice(0, MAX_ROWS);
}

/** AI 가 낸 값(생성 결과)을 다듬는다. 없으면 빈 배열 — `undefined` 로 남기지 않는다. */
export function toDetail(raw: Record<string, unknown> | object): SpecDetail {
  const r = raw as Record<string, unknown>;
  return {
    businessRules: toLines(r.businessRules),
    inputs: toInputs(r.inputs),
    stateChanges: toStateChanges(r.stateChanges),
    postconditions: toLines(r.postconditions),
    roleDifferences: toLines(r.roleDifferences),
  };
}

/**
 * AI 에이전트의 수정을 합친다. 에이전트가 **보낸 칸만** 바꾸고 나머지는 그대로 둔다 —
 * 다른 칸을 고치려고 보낸 응답에 이 칸이 빠졌다고 지워지면 안 된다.
 */
export function mergeDetail(raw: Record<string, unknown>, was: Specification): SpecDetail {
  const old = detailOf(was);
  return {
    businessRules: Array.isArray(raw.businessRules) ? toLines(raw.businessRules) : old.businessRules,
    inputs: Array.isArray(raw.inputs) ? toInputs(raw.inputs) : old.inputs,
    stateChanges: Array.isArray(raw.stateChanges) ? toStateChanges(raw.stateChanges) : old.stateChanges,
    postconditions: Array.isArray(raw.postconditions) ? toLines(raw.postconditions) : old.postconditions,
    roleDifferences: Array.isArray(raw.roleDifferences) ? toLines(raw.roleDifferences) : old.roleDifferences,
  };
}

/** 저장된 상세명세의 확장 칸. 예전 플랜이면 모두 빈 배열. */
export function detailOf(spec: Specification): SpecDetail {
  return {
    businessRules: spec.businessRules ?? [],
    inputs: spec.inputs ?? [],
    stateChanges: spec.stateChanges ?? [],
    postconditions: spec.postconditions ?? [],
    roleDifferences: spec.roleDifferences ?? [],
  };
}

/** "보증금 (필수) — 1만~50만 원 정수" */
export function inputLine(input: SpecInput): string {
  return `${input.name} (${input.required ? '필수' : '선택'})${input.rule ? ` — ${input.rule}` : ''}`;
}

/** "대여: 요청됨 → 수락됨 (제공자가 수락)" */
export function stateLine(change: SpecStateChange): string {
  const head = change.entity ? `${change.entity}: ` : '';
  const tail = change.trigger ? ` (${change.trigger})` : '';
  return `${head}${change.from || '(새로 생김)'} → ${change.to}${tail}`;
}

/** 검색에 걸 문장들. 화면에 보이는 칸은 검색에도 걸려야 한다. */
export function detailText(spec: Specification): string[] {
  const d = detailOf(spec);
  return [
    ...d.businessRules,
    ...d.inputs.map(inputLine),
    ...d.stateChanges.map(stateLine),
    ...d.postconditions,
    ...d.roleDifferences,
  ];
}
