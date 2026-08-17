/**
 * 만들기 엔진 — **기본**과 **고급** 둘.
 *
 * ## 이름을 이렇게 붙인 이유
 *
 * 화면에는 `기본 엔진` · `고급 엔진` 만 보인다. **어느 회사의 어떤 모델인지는
 * 사용자에게 내보내지 않는다.** 알아도 할 수 있는 일이 없고, 대신 서비스 내부
 * 구성이 드러난다. 모델을 갈아 끼우면 그 이름이 적힌 화면·문서·안내를 전부
 * 따라 고쳐야 하는 것도 문제다.
 *
 * 그래서 **고르는 기준을 모델이 아니라 결과로 적는다** — 빠른 쪽인가, 꼼꼼한
 * 쪽인가. 실제 모델 이름은 서버에서만 아는 값이라 `provider.ts` 에 둔다.
 * 이 파일은 브라우저에도 실리므로 여기에는 이름을 적지 않는다.
 */

export type EngineTier = 'basic' | 'advanced';

export const ENGINE_TIERS: EngineTier[] = ['basic', 'advanced'];

export const ENGINE_LABEL: Record<EngineTier, string> = {
  basic: '기본 엔진',
  advanced: '고급 엔진',
};

/** 고를 때 읽는 한 줄. 무엇이 달라지는지를 **결과로** 적는다. */
export const ENGINE_WHAT: Record<EngineTier, string> = {
  basic: '빠르게 만듭니다. 대부분의 기획에는 이걸로 충분합니다.',
  advanced: '더 오래 생각해서 촘촘하게 만듭니다. 대신 느립니다.',
};

/** 언제 쓰면 좋은지 — 골라 놓고 후회하지 않도록. */
export const ENGINE_WHEN: Record<EngineTier, string[]> = {
  basic: [
    '아이디어를 빠르게 훑어볼 때',
    '만들었다 지우기를 반복하며 방향을 잡을 때',
    '문서를 다시 만드는 일이 잦을 때',
  ],
  advanced: [
    '실제로 남길 문서를 만들 때',
    '요구사항이 많고 서로 얽혀 있을 때',
    '기본 엔진 결과가 얕게 느껴질 때',
  ],
};

/**
 * 아무것도 안 고른 계정이 쓰는 것.
 *
 * `기본` 이라는 이름 그대로 기본값으로 둔다. 처음 쓰는 사람은 대개 만들었다
 * 지우기를 반복하는데, 그때 매번 오래 기다리게 하면 손이 묶인다. 오래 걸려도
 * 촘촘한 쪽이 필요해지는 시점은 **본인이 안다** — 그때 설정에서 바꾸면 된다.
 */
export const DEFAULT_ENGINE: EngineTier = 'basic';

export function isEngineTier(value: unknown): value is EngineTier {
  return value === 'basic' || value === 'advanced';
}

/** 어디서 왔든(쿠키·본문·DB) 모르는 값이면 기본으로 되돌린다. */
export function toEngineTier(value: unknown): EngineTier {
  return isEngineTier(value) ? value : DEFAULT_ENGINE;
}
