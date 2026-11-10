import type { PlanDocuments } from '../types';

/** Compare JSON document values without relying on object property order. */
function documentValuesEqual(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
      return false;
    }
    for (let index = 0; index < before.length; index += 1) {
      if (!documentValuesEqual(before[index], after[index])) return false;
    }
    return true;
  }
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return false;
  }

  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  // Optional JSON fields are equivalent whether absent or explicitly undefined.
  const previousKeys = Object.keys(previous).filter((key) => previous[key] !== undefined);
  const nextKeys = Object.keys(next).filter((key) => next[key] !== undefined);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every(
    (key) => Object.hasOwn(next, key) && documentValuesEqual(previous[key], next[key]),
  );
}

/** Keep only fields that would change the document; reuse their original values. */
export function changedDocumentPatch(
  plan: PlanDocuments,
  patch: Partial<PlanDocuments>,
): Partial<PlanDocuments> | undefined {
  const changed = { ...patch };
  let hasChanges = false;
  for (const key of Object.keys(patch) as (keyof PlanDocuments)[]) {
    if (documentValuesEqual(plan[key], patch[key])) delete changed[key];
    else hasChanges = true;
  }
  return hasChanges ? changed : undefined;
}

/** Inputs used by a functional review, excluding its previous findings. */
export function fsDocumentsEqual(before: PlanDocuments, after: PlanDocuments): boolean {
  return (['prd', 'requirements', 'features', 'specifications'] as const).every(
    (key) => documentValuesEqual(before[key], after[key]),
  );
}
