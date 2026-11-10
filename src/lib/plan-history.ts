'use client';

import { usePlannerStore } from './store';
import { workspaceFetch } from './admin-workspace';
import { readPlannerVersion } from './planner-storage';
import type { Plan, PlanVersion } from './types';

/** 이전 브라우저 이력과 서버 이력 모두 같은 복원·백업 경로를 사용한다. */
export async function loadPlanVersion(planId: string, versionId: string): Promise<PlanVersion> {
  const inMemory = usePlannerStore.getState().getPlan(planId)?.versions.find((version) => version.id === versionId);
  if (inMemory?.snapshot) return inMemory;
  const local = await readPlannerVersion(planId, versionId);
  if (local?.snapshot) return local;
  const response = await workspaceFetch(`/api/plans/${encodeURIComponent(planId)}/versions/${encodeURIComponent(versionId)}`, {
    cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('버전 본문을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
  const data = await response.json() as { version?: PlanVersion };
  if (!data.version?.snapshot) throw new Error('버전 본문이 없습니다.');
  return data.version;
}

/** JSON 백업과 복제는 요약만 내보내지 않고 모든 버전 본문을 포함한다. */
export async function planWithHistory(plan: Plan): Promise<Plan> {
  const versions: PlanVersion[] = [];
  for (const version of plan.versions) versions.push(version.snapshot ? version : await loadPlanVersion(plan.id, version.id));
  return { ...plan, versions };
}

export async function deleteRemotePlanVersion(planId: string, versionId: string): Promise<void> {
  const response = await workspaceFetch(`/api/plans/${encodeURIComponent(planId)}/versions/${encodeURIComponent(versionId)}`, {
    method: 'DELETE', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('버전을 삭제하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
}
