'use client';

/**
 * **지금 무슨 일이 돌고 있는가** — 앱 어디에서든 같은 답을 준다.
 *
 * ## 왜 필요한가
 *
 * 오래 걸리는 일들이 이제 전부 화면 밖에서 돈다. 산출물 생성도, 스티치에 화면
 * 만들기도, 에이전트 답변도 그렇다. 화면을 떠나도 계속된다.
 *
 * 그러면 **떠난 사람이 그 사실을 알 길이 있어야 한다.** 스티치에 스무 개를 걸어
 * 놓고 홈으로 나갔는데 아무 표시가 없으면, 돌고 있는 줄을 모른다. 모르면 브라우저를
 * 닫고, 닫으면 십오 분이 날아간다.
 *
 * ## 세 군데를 모은다
 *
 * | 무슨 일 | 어디에 있나 |
 * | --- | --- |
 * | 산출물 생성 | 스토어 `activeRun` (모듈 수준 러너가 갱신) |
 * | 스티치에 만들기 | `stitch-runner` 모듈 |
 * | 에이전트 답변 | 스토어 `agentBusy` |
 *
 * 셋 다 화면 밖에 있어서, 화면이 사라져도 답이 유지된다.
 */

import { useSyncExternalStore } from 'react';

import { usePlannerStore } from './store';
import { currentOf } from './jobs/progress';
import { noJobs, runningJobs, subscribeAll } from './design/stitch-runner';
import { ARTIFACT_LABEL, type ArtifactKey } from './types';

const STEP_PATH: Record<ArtifactKey, string> = {
  prd: '/prd',
  fs: '/fs',
  ia: '/ia',
  flow: '/flow',
  wireframe: '/wireframe',
};

export interface Working {
  /** 같은 일이 두 번 들어가지 않게 하는 열쇠. */
  key: string;
  planId: string;
  /** 무슨 일인지 — 플랜 이름 없이. 예: `기능명세서 만드는 중` */
  what: string;
  /** 눌렀을 때 갈 곳 — 그 일이 실제로 보이는 화면. */
  href: string;
}

/**
 * 돌고 있는 일들.
 *
 * 플랜 이름은 여기서 붙이지 않는다. 이름이 필요 없는 자리(그 플랜 안)도 있고,
 * 이름을 아는 것은 스토어를 읽는 쪽이라 화면에 맡긴다.
 */
export function useWorking(): Working[] {
  const activeRun = usePlannerStore((s) => s.activeRun);
  const agentBusy = usePlannerStore((s) => s.agentBusy);
  const stitch = useSyncExternalStore(subscribeAll, runningJobs, noJobs);

  const out: Working[] = [];

  if (activeRun) {
    const current = currentOf(activeRun);
    // 전체 자동 생성이면 몇 번째인지 함께 알린다 — 다섯 단계는 오래 걸린다.
    const step =
      activeRun.artifacts.length > 1
        ? ` (${activeRun.done.length + 1}/${activeRun.artifacts.length})`
        : '';
    out.push({
      key: `gen:${activeRun.planId}`,
      planId: activeRun.planId,
      what: current ? `${ARTIFACT_LABEL[current]} 만드는 중${step}` : `만드는 중${step}`,
      href: `/plans/${activeRun.planId}${current ? STEP_PATH[current] : ''}`,
    });
  }

  for (const job of stitch) {
    out.push({
      key: `stitch:${job.planId}`,
      planId: job.planId,
      what: `스티치에 만드는 중 (${job.done}/${job.total})`,
      href: `/plans/${job.planId}/export`,
    });
  }

  if (agentBusy) {
    out.push({
      key: `agent:${agentBusy}`,
      planId: agentBusy,
      what: 'AI 에이전트가 답하는 중',
      href: `/plans/${agentBusy}`,
    });
  }

  return out;
}
