'use client';

/**
 * 생성 작업 감시자.
 *
 * 플랜 화면에 하나만 떠 있으면서 서버 큐를 주기적으로 확인하고, 끝난 작업의 결과를
 * 스토어에 반영한다. 폴링을 여기 한 곳에 모았기 때문에 다음이 모두 같은 경로를 탄다.
 *
 * - 생성을 걸어 놓고 다른 메뉴로 이동
 * - 새로고침
 * - 탭을 닫았다가 나중에 다시 열기
 *
 * 화면을 열 때 `/api/jobs?planId=` 로 **아직 도는 작업이 있는지 서버에 물어본다.**
 * 그래서 브라우저가 없던 사이에 끝난 결과도 돌아오면 받아 간다.
 */

import { useEffect, useRef } from 'react';
import { useToast } from './ui';
import { usePlannerStore } from '@/lib/store';
import { isPipeline, type JobProgress } from '@/lib/jobs/progress';
import { ARTIFACT_LABEL, type ArtifactKey, type PlanDocuments } from '@/lib/types';

/** 진행 중인 작업이 있을 때 확인 간격. */
const POLL_MS = 1500;

interface JobResponse extends JobProgress {
  patch?: Partial<PlanDocuments>;
  warnings?: string[];
  error?: string;
  gone?: boolean;
}

export function JobWatcher({ planId }: { planId: string }) {
  const toast = useToast();
  /** 이미 결과를 반영한 작업. 두 번 토스트하지 않기 위해. */
  const settled = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const store = usePlannerStore;

    /** 서버가 끝났다고 알려 준 작업을 스토어에 반영한다. */
    const settle = (job: JobResponse) => {
      if (settled.current.has(job.id)) return;
      settled.current.add(job.id);

      const { applyDocuments, refundCredits, untrackJob } = store.getState();

      if (job.patch && job.done.length > 0) {
        applyDocuments(planId, job.patch, job.done);
      }

      if (job.status === 'error') {
        // 못 만든 단계의 크레딧만 돌려준다. 만들어진 것은 값을 했으므로 차감을 유지한다.
        const unfinished = job.artifacts.filter((a) => !job.done.includes(a));
        const refund = unfinished.reduce((sum, a) => sum + store.getState().costOf(a), 0);
        if (refund > 0) refundCredits(refund);
        toast(
          job.error ?? '생성에 실패했습니다.' + (refund > 0 ? ` (${refund} 크레딧 반환)` : ''),
          'danger',
        );
      } else if (job.warnings && job.warnings.length > 0) {
        toast(`AI 호출에 실패해 내장 생성기로 만들었습니다.\n${job.warnings[0]}`, 'warn');
      } else {
        const what = isPipeline(job)
          ? `${job.done.length}종 산출물`
          : ARTIFACT_LABEL[job.done[0] as ArtifactKey];
        toast(`${what}을(를) 만들었습니다.`, 'ok');
      }

      untrackJob(job.id);
    };

    /** 서버에서 사라진 작업 — 재시작·보관 만료. 진행 표시를 풀고 크레딧을 돌려준다. */
    const drop = (job: JobProgress) => {
      if (settled.current.has(job.id)) return;
      settled.current.add(job.id);
      const { refundCredits, untrackJob } = store.getState();
      if (job.cost > 0) refundCredits(job.cost);
      toast(
        `생성 작업을 찾을 수 없어 중단했습니다. 서버가 다시 시작된 것 같습니다.${
          job.cost > 0 ? ` (${job.cost} 크레딧 반환)` : ''
        }`,
        'warn',
      );
      untrackJob(job.id);
    };

    const poll = async () => {
      if (!alive) return;

      const tracked = Object.values(store.getState().jobs).filter((j) => j.planId === planId);

      for (const job of tracked) {
        try {
          const response = await fetch(`/api/jobs/${job.id}`);
          if (response.status === 404) {
            drop(job);
            continue;
          }
          const data = (await response.json()) as JobResponse;
          if (!alive) return;

          if (data.status === 'done' || data.status === 'error') {
            settle(data);
          } else {
            store.getState().trackJob({
              id: data.id,
              planId,
              artifacts: data.artifacts,
              current: data.current,
              done: data.done,
              status: data.status,
              cost: job.cost,
            });
          }
        } catch {
          // 일시적인 네트워크 오류. 다음 차례에 다시 물어본다.
        }
      }

      if (!alive) return;
      const stillRunning = Object.values(store.getState().jobs).some((j) => j.planId === planId);
      timer = setTimeout(poll, stillRunning ? POLL_MS : POLL_MS * 4);
    };

    /** 화면을 열 때 서버에 남아 있는 작업을 찾아 다시 따라간다. */
    const rediscover = async () => {
      try {
        const response = await fetch(`/api/jobs?planId=${encodeURIComponent(planId)}`);
        const data = (await response.json()) as { jobs?: JobResponse[] };
        if (!alive) return;
        for (const job of data.jobs ?? []) {
          if (settled.current.has(job.id)) continue;
          if (job.status === 'done' || job.status === 'error') {
            settle(job);
          } else {
            store.getState().trackJob({
              id: job.id,
              planId,
              artifacts: job.artifacts,
              current: job.current,
              done: job.done,
              status: job.status,
              cost: job.cost,
            });
          }
        }
      } catch {
        // 서버에 못 물어봐도 화면은 정상 동작해야 한다.
      }
      void poll();
    };

    void rediscover();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [planId, toast]);

  return null;
}
