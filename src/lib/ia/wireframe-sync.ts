/**
 * 화면 구성이 바뀐 뒤 와이어프레임이 뒤처졌는지 찾아낸다.
 *
 * 기능을 정보구조도에 배치하면 그 화면에서 해야 할 일이 늘어난다. 그런데
 * 와이어프레임은 배치하기 전에 만들어진 그림이라 새 기능을 모른다. 그대로 두면
 * 개발팀은 **기능명세서에는 있는데 화면에는 없는 것**을 받게 된다.
 *
 * 두 가지를 찾는다.
 *
 *   missing — 기능이 걸린 화면인데 와이어프레임이 아예 없다 (배치로 새로 생긴 화면)
 *   changed — 와이어프레임을 만든 뒤에 기능이 더 붙었다
 *
 * `changed` 는 와이어프레임에 새겨 둔 `featureIds` 와 지금 화면의 기능을 비교해 안다.
 * 그 값이 없는(예전에 만든) 와이어프레임은 **뒤처졌다고 단정하지 않는다.**
 * 알 수 없는 것을 문제라고 하면 멀쩡한 화면까지 다시 만들게 된다.
 */

import type { IaPage, Plan, Wireframe } from '../types';

export interface StalePage {
  page: IaPage;
  wireframe?: Wireframe;
  reason: 'missing' | 'changed';
  /** 와이어프레임이 모르는 기능 이름들. 무엇 때문에 다시 만들어야 하는지 보여 준다. */
  addedFeatures: string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** 다시 만들어야 할 화면들. 정보구조도 순서대로 돌려준다. */
export function stalePages(plan: Plan): StalePage[] {
  const nameOf = new Map(plan.features.map((f) => [f.id, `${f.id} ${f.name}`]));
  const wireframeOf = new Map(plan.wireframes.map((w) => [w.pageId, w]));
  const result: StalePage[] = [];

  for (const page of plan.iaPages) {
    // 기능이 없는 화면은 와이어프레임이 없어도 문제가 아니다.
    if (page.featureIds.length === 0) continue;

    const wireframe = wireframeOf.get(page.id);
    if (!wireframe) {
      result.push({
        page,
        reason: 'missing',
        addedFeatures: page.featureIds.map((id) => nameOf.get(id) ?? id),
      });
      continue;
    }

    // 새겨 둔 값이 없으면 비교할 수 없다. 뒤처졌다고 단정하지 않는다.
    const recorded = wireframe.featureIds;
    if (!recorded || sameSet(recorded, page.featureIds)) continue;

    const known = new Set(recorded);
    const added = page.featureIds.filter((id) => !known.has(id));
    // 기능이 빠지기만 한 경우는 다시 만들 이유가 약하다 — 그림이 남아 있어도 손해가 아니다.
    if (added.length === 0) continue;

    result.push({
      page,
      wireframe,
      reason: 'changed',
      addedFeatures: added.map((id) => nameOf.get(id) ?? id),
    });
  }

  return result;
}

/**
 * 와이어프레임에 새겨 둔 기능 목록을 **지금 값으로 되돌린다.**
 *
 * 기능을 배치할 때 부른다. 배치 전의 구성을 그대로 남겨 두어야 "그 뒤에 무엇이
 * 더 붙었는지" 를 비교할 수 있다. 값이 없던(예전) 와이어프레임에도 이때 값이 생겨,
 * 그 시점부터는 뒤처짐을 알아볼 수 있게 된다.
 */
export function stampWireframes(pages: IaPage[], wireframes: Wireframe[]): Wireframe[] {
  const featuresOf = new Map(pages.map((p) => [p.id, p.featureIds]));
  return wireframes.map((wireframe) =>
    wireframe.featureIds
      ? wireframe
      : { ...wireframe, featureIds: [...(featuresOf.get(wireframe.pageId) ?? [])] },
  );
}
