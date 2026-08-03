/**
 * 생성 진행 상태.
 *
 * 이 파일은 서버 코드를 끌어오지 않아야 한다 — 스토어가 import 한다.
 */

import type { ArtifactKey } from '../types';

/** 지금 도는 생성. 저장하지 않는다. */
export interface ActiveRun {
  planId: string;
  /** 이 생성이 만들 산출물. 전체 자동 생성이면 5개 */
  artifacts: ArtifactKey[];
  /** 지금 만들고 있는 것 */
  current: ArtifactKey | null;
  /** 끝난 것 */
  done: ArtifactKey[];
}

/**
 * 다 만들지 못하고 끊긴 전체 자동 생성. **저장한다.**
 *
 * 시작할 때 적어 두고 단계마다 갱신하므로, 탭이 갑자기 사라져도 기록이 남는다.
 * 다 끝나면 지운다.
 */
export interface InterruptedRun {
  planId: string;
  /** 만들어 놓은 것 */
  done: ArtifactKey[];
  /** 아직 못 만든 것 — 이어서 만들 대상 */
  remaining: ArtifactKey[];
}

/** 전체 자동 생성인지 (여러 단계를 이어서 도는 생성) */
export function isPipeline(run: { artifacts: ArtifactKey[] }) {
  return run.artifacts.length > 1;
}

/** 진행 표시에 쓸 "지금 만드는 것". 아직 시작 전이면 첫 대상을 가리킨다. */
export function currentOf(run: ActiveRun): ArtifactKey | null {
  return run.current ?? run.artifacts.find((a) => !run.done.includes(a)) ?? null;
}
