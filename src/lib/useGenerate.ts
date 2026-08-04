'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlannerStore } from './store';
import { currentOf, isPipeline } from './jobs/progress';
import { cancelGeneration, runGeneration, type RunArgs } from './jobs/runner';
import { type ArtifactKey, type Plan } from './types';
import { useToast } from '@/components/ui';

export type AiMode = 'ai' | 'local' | 'unknown';

export interface AiStatus {
  mode: AiMode;
}

/**
 * 지금 AI 생성이 가능한 상태인지만 알아 온다.
 *
 * **어떤 공급자·모델을 쓰는지는 받아 오지 않는다.** 서버가 아예 내보내지 않고,
 * 화면도 필요로 하지 않는다. 사용자에게 쓸모없는 정보이면서 내부 구성을 알려 준다.
 */
export function useAiMode(): AiStatus {
  const [state, setState] = useState<AiStatus>({ mode: 'unknown' });

  useEffect(() => {
    let alive = true;
    fetch('/api/status')
      .then((r) => r.json())
      .then((data: Partial<AiStatus>) => {
        if (alive) setState({ mode: data.mode ?? 'local' });
      })
      .catch(() => {
        if (alive) setState({ mode: 'local' });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/** 전체 자동 생성 순서. */
export const PIPELINE_ORDER: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

/**
 * 산출물 생성 훅.
 *
 * 실제 실행은 모듈 수준의 `runGeneration` 이 맡는다. 그래서 이 훅을 쓰던 화면이
 * 사라져도 생성은 계속되고, 진행 상태는 스토어를 통해 어느 화면에서든 같게 보인다.
 */
export function useGenerate(plan: Plan | undefined) {
  const activeRun = usePlannerStore((s) => s.activeRun);
  const interrupted = usePlannerStore((s) => s.interrupted);
  const setInterrupted = usePlannerStore((s) => s.setInterrupted);
  const toast = useToast();

  const planId = plan?.id;

  const run = activeRun?.planId === planId ? activeRun : null;

  /** 지금 만들고 있는 산출물. */
  const pending: ArtifactKey | null = run ? currentOf(run) : null;

  /** 전체 자동 생성이 도는 중인지. */
  const autoRunning = run ? isPipeline(run) : false;

  /**
   * 다 만들지 못하고 끊긴 전체 자동 생성.
   * 지금 돌고 있는 중이면 보여 줄 이유가 없다.
   */
  const interruptedRun =
    !run && interrupted && interrupted.planId === planId && interrupted.remaining.length > 0
      ? interrupted
      : null;

  const start = useCallback(
    async (artifacts: ArtifactKey[], args: RunArgs = {}) => {
      if (!planId) return false;
      return runGeneration(planId, artifacts, args, toast);
    },
    [planId, toast],
  );

  const generate = useCallback(
    (artifact: ArtifactKey, args: RunArgs = {}) => start([artifact], args),
    [start],
  );

  /** PRD 부터 와이어프레임까지. 서버가 한 요청 안에서 이어서 만든다. */
  const generateAll = useCallback(() => start(PIPELINE_ORDER), [start]);

  /**
   * 끊긴 지점부터 이어서 만든다.
   *
   * 만들어진 단계는 이미 문서에 반영돼 있으므로 **남은 단계만** 다시 맡긴다.
   * 그래서 앞부분을 다시 만들지 않고 크레딧도 남은 만큼만 든다.
   */
  const resume = useCallback(async () => {
    if (!interruptedRun) return false;
    return start(interruptedRun.remaining);
  }, [interruptedRun, start]);

  /**
   * 도는 생성을 멈춘다.
   *
   * 만들어진 단계는 그대로 남고, 남은 단계는 `이어서 만들기` 로 이어 간다.
   */
  const cancel = useCallback(() => {
    if (cancelGeneration()) toast('생성을 멈추는 중입니다…', 'warn');
  }, [toast]);

  /** 이어서 만들지 않고 안내를 없앤다. 만들어진 것은 그대로 남는다. */
  const discardInterrupted = useCallback(() => {
    if (!interruptedRun) return;
    setInterrupted(null);
  }, [interruptedRun, setInterrupted]);

  return {
    generate,
    generateAll,
    pending,
    autoRunning,
    cancel,
    interrupted: interruptedRun,
    resume,
    discardInterrupted,
  };
}
