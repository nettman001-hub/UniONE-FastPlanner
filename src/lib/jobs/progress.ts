/**
 * 브라우저가 들고 있는 작업 진행 사본.
 *
 * 서버의 `Job` 에서 화면에 필요한 것만 뽑았다. 문서 본문(patch)은 받자마자
 * 스토어에 반영하고 버리므로 여기에 두지 않는다.
 *
 * 이 파일은 서버 코드(`node:fs` 등)를 끌어오지 않아야 한다 — 스토어가 import 한다.
 */

import type { ArtifactKey } from '../types';

/**
 * `paused` — 브라우저가 사라져 이어 갈 곳이 없어진 상태.
 * 진행 중이던 단계까지 마치고 결과를 보관한 채 멈춘다. 돌아오면 다음 단계부터 이어 간다.
 */
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error';

export interface JobProgress {
  id: string;
  planId: string;
  /** 이 작업이 만들 산출물. 전체 자동 생성이면 5개 */
  artifacts: ArtifactKey[];
  /** 지금 만들고 있는 것 */
  current: ArtifactKey | null;
  /** 끝난 것 */
  done: ArtifactKey[];
  status: JobStatus;
  /** 이 작업에 쓴 크레딧. 실패하면 이만큼 돌려준다. */
  cost: number;
}

export function isJobFinished(job: JobProgress) {
  return job.status === 'done' || job.status === 'error';
}

/** 지금 돌고 있는가. 멈춘 작업은 진행 중이 아니다. */
export function isJobRunning(job: JobProgress) {
  return job.status === 'queued' || job.status === 'running';
}

/** 이어서 만들 산출물. */
export function remainingOf(job: JobProgress) {
  return job.artifacts.filter((a) => !job.done.includes(a));
}

/** 전체 자동 생성인지 (여러 단계를 이어서 도는 작업) */
export function isPipeline(job: JobProgress) {
  return job.artifacts.length > 1;
}
