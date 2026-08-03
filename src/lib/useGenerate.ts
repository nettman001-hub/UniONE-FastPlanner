'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlannerStore } from './store';
import { isJobRunning, isPipeline, remainingOf, type JobProgress } from './jobs/progress';
import {
  ARTIFACT_CREDIT_COST,
  ARTIFACT_LABEL,
  type ArtifactKey,
  type Plan,
} from './types';
import { useToast } from '@/components/ui';

export type AiMode = 'ai' | 'local' | 'unknown';
export type ProviderId = 'deepseek' | 'anthropic' | 'local';

export interface AiStatus {
  mode: AiMode;
  provider: ProviderId | null;
  /** 공급자 표시명 (DeepSeek / Claude / 내장 생성기) */
  label: string;
  model: string | null;
}

const UNKNOWN: AiStatus = { mode: 'unknown', provider: null, label: '확인 중', model: null };
const OFFLINE: AiStatus = { mode: 'local', provider: 'local', label: '내장 생성기', model: null };

/** 헤더 등에서 현재 생성 공급자를 보여주기 위한 훅. */
export function useAiMode(): AiStatus {
  const [state, setState] = useState<AiStatus>(UNKNOWN);

  useEffect(() => {
    let alive = true;
    fetch('/api/status')
      .then((r) => r.json())
      .then((data: Partial<AiStatus>) => {
        if (!alive) return;
        setState({
          mode: data.mode ?? 'local',
          provider: data.provider ?? 'local',
          label: data.label ?? OFFLINE.label,
          model: data.model ?? null,
        });
      })
      .catch(() => {
        if (alive) setState(OFFLINE);
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

interface GenerateArgs {
  pageIds?: string[];
  merge?: boolean;
  extra?: string;
}

/** 전체 자동 생성 순서. */
export const PIPELINE_ORDER: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

/**
 * 산출물 생성 훅.
 *
 * **작업을 서버 큐에 맡기기만 한다.** 결과를 받아 오는 폴링은 `JobWatcher` 가 한다.
 * 그래서 요청을 건 화면이 사라져도, 심지어 탭을 닫았다가 다시 열어도 작업은 끝까지 돌고
 * 결과는 돌아왔을 때 반영된다.
 */
export function useGenerate(plan: Plan | undefined) {
  const jobs = usePlannerStore((s) => s.jobs);
  const spendCredits = usePlannerStore((s) => s.spendCredits);
  const refundCredits = usePlannerStore((s) => s.refundCredits);
  const trackJob = usePlannerStore((s) => s.trackJob);
  const toast = useToast();

  const planId = plan?.id;

  const untrackJob = usePlannerStore((s) => s.untrackJob);

  /** 이 플랜에서 도는 작업. */
  const job = useMemo(
    () => Object.values(jobs).find((j) => j.planId === planId && isJobRunning(j)),
    [jobs, planId],
  );

  /**
   * 브라우저가 사라져 멈춰 둔 작업.
   *
   * 만들어진 단계는 이미 반영돼 있고, 남은 단계를 이어서 만들 수 있다.
   */
  const pausedJob = useMemo(
    () => Object.values(jobs).find((j) => j.planId === planId && j.status === 'paused'),
    [jobs, planId],
  );

  /**
   * 지금 만들고 있는 산출물.
   *
   * 아직 시작 전(queued)이면 첫 번째 산출물을 가리켜, 버튼을 누른 직후에도
   * 곧바로 진행 표시가 뜨게 한다.
   */
  const pending: ArtifactKey | null = job
    ? (job.current ?? job.artifacts.find((a) => !job.done.includes(a)) ?? null)
    : null;

  /** 전체 자동 생성이 도는 중인지. */
  const autoRunning = job ? isPipeline(job) : false;

  const enqueue = useCallback(
    async (artifacts: ArtifactKey[], args: GenerateArgs = {}) => {
      if (!planId) return false;

      // 한 플랜에서 두 작업을 동시에 돌리지 않는다 — 앞 단계 결과를 컨텍스트로 쓰기 때문.
      if (usePlannerStore.getState().isPlanBusy(planId)) return false;

      const cost = artifacts.reduce((sum, a) => sum + ARTIFACT_CREDIT_COST[a], 0);
      if (!spendCredits(cost)) {
        toast(
          `크레딧이 부족합니다. ${artifacts.length > 1 ? '전체 자동 생성' : ARTIFACT_LABEL[artifacts[0]]} 에는 ${cost} 크레딧이 필요합니다. 내일 다시 충전됩니다.`,
          'warn',
        );
        return false;
      }

      // 보낼 문서는 **지금** 스토어에서 읽는다. 클로저에 갇힌 옛 스냅샷을 보내지 않는다.
      const current = usePlannerStore.getState().getPlan(planId);
      if (!current) {
        refundCredits(cost);
        return false;
      }

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ artifacts, plan: current, ...args }),
        });
        const data = (await response.json()) as { jobId?: string; error?: string };

        if (!response.ok || !data.jobId) {
          refundCredits(cost);
          toast(data.error ?? '생성 요청에 실패했습니다.', 'danger');
          return false;
        }

        trackJob({
          id: data.jobId,
          planId,
          artifacts,
          current: null,
          done: [],
          status: 'queued',
          cost,
        });
        return true;
      } catch {
        refundCredits(cost);
        toast('네트워크 오류로 생성 요청에 실패했습니다.', 'danger');
        return false;
      }
    },
    [planId, spendCredits, refundCredits, trackJob, toast],
  );

  const generate = useCallback(
    (artifact: ArtifactKey, args: GenerateArgs = {}) => enqueue([artifact], args),
    [enqueue],
  );

  /** PRD 부터 와이어프레임까지 한 작업으로 맡긴다. 이어 달리는 것은 서버가 한다. */
  const generateAll = useCallback(() => enqueue(PIPELINE_ORDER), [enqueue]);

  /** 서버에서 멈춘 작업을 정리한다. 이어서 만들 때도, 그만둘 때도 거친다. */
  const dropPaused = useCallback(
    async (target: JobProgress) => {
      untrackJob(target.id);
      await fetch(`/api/jobs/${target.id}`, { method: 'DELETE' }).catch(() => {});
    },
    [untrackJob],
  );

  /**
   * 멈춘 지점부터 이어서 만든다.
   *
   * 만들어진 단계는 이미 문서에 반영돼 있으므로, **남은 단계만** 새 작업으로 맡긴다.
   * 그래서 앞부분을 다시 만들지 않고 크레딧도 남은 만큼만 든다.
   */
  const resume = useCallback(async () => {
    if (!pausedJob) return false;
    const rest = remainingOf(pausedJob);
    await dropPaused(pausedJob);
    if (rest.length === 0) return true;
    return enqueue(rest);
  }, [pausedJob, dropPaused, enqueue]);

  /** 이어서 만들지 않고 멈춘 작업을 버린다. 만들어진 것은 그대로 남는다. */
  const discardPaused = useCallback(async () => {
    if (!pausedJob) return;
    await dropPaused(pausedJob);
  }, [pausedJob, dropPaused]);

  return { generate, generateAll, pending, autoRunning, job, pausedJob, resume, discardPaused };
}
