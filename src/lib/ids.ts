/** 산출물 ID 규칙 (REQ-001, FN-001, …) 을 관리한다. */

export type IdPrefix = 'REQ' | 'FN' | 'SP' | 'PG' | 'FL' | 'WF';

export function formatId(prefix: IdPrefix, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** 기존 ID 목록에서 다음 번호를 계산한다. 형식이 다른 ID 는 무시한다. */
export function nextId(prefix: IdPrefix, existing: readonly { id: string }[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const item of existing) {
    const m = pattern.exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatId(prefix, max + 1);
}

/** 여러 개를 한 번에 발급한다. */
export function nextIds(
  prefix: IdPrefix,
  existing: readonly { id: string }[],
  count: number,
): string[] {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const item of existing) {
    const m = pattern.exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => formatId(prefix, max + 1 + i));
}

let counter = 0;

/** 화면 내부에서만 쓰는 임시 키 (저장 대상이지만 규칙 ID 가 필요 없는 항목). */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
