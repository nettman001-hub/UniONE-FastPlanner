'use client';

/**
 * **AI 작업 진행 상태 및 완료 알림 관리 모듈**
 *
 * ## 기능
 * 1. 현재 진행 중인 AI 작업(산출물 생성, UniAI 화면 생성, 스티치 연동, 에이전트 대화) 추적
 * 2. 작업 완료 시 완료 알림을 등록하고 상단 우측에 표시
 * 3. 사용자가 해당 대상 페이지로 이동(방문)하면 완료 알림을 자동으로 해제(Dismiss)
 */

import { useEffect, useSyncExternalStore } from 'react';
import { usePlannerStore } from './store';
import { currentOf } from './jobs/progress';
import { noJobs, runningJobs, subscribeAll as subscribeStitch } from './design/stitch-runner';
import {
  noUinAiJobs,
  runningUinAiJobs,
  subscribeAllUinAi,
} from './design/uinai-runner';
import { ARTIFACT_LABEL, type ArtifactKey } from './types';

const STEP_PATH: Record<ArtifactKey, string> = {
  prd: '/prd',
  fs: '/fs',
  ia: '/ia',
  flow: '/flow',
  wireframe: '/wireframe',
};

export interface RunningTask {
  key: string;
  planId: string;
  type: 'generation' | 'uinai' | 'stitch' | 'agent';
  /** 표시 텍스트: 예 `기능명세서 만드는 중 (2/5)` */
  what: string;
  /** 클릭 시 이동할 URL */
  href: string;
  /** 해당 작업의 기준 경로 (정규화 비교용) */
  targetPath: string;
}

export interface CompletedTask {
  id: string;
  planId: string;
  type: 'generation' | 'uinai' | 'stitch' | 'agent';
  /** 표시 텍스트: 예 `기능명세서 생성 완료`, `5종 산출물 생성 완료` */
  title: string;
  /** 클릭 시 이동할 URL */
  href: string;
  /** 대상 페이지 경로 (이 경로에 머무르거나 진입하면 해제) */
  targetPath: string;
  completedAt: number;
}

/* ------------------------------------------------------------------ */
/* 완료 알림 전역 스토어 (메모리 + 리스너)                             */
/* ------------------------------------------------------------------ */

let completedList: CompletedTask[] = [];
const completedListeners = new Set<() => void>();

function emitChange() {
  completedListeners.forEach((listener) => listener());
}

export function subscribeCompleted(listener: () => void): () => void {
  completedListeners.add(listener);
  return () => completedListeners.delete(listener);
}

export function getCompletedSnapshot(): CompletedTask[] {
  return completedList;
}

const EMPTY_COMPLETED: CompletedTask[] = [];
export function getCompletedServerSnapshot(): CompletedTask[] {
  return EMPTY_COMPLETED;
}

/** 새로운 완료 작업 등록 */
export function recordCompletedTask(task: Omit<CompletedTask, 'id' | 'completedAt'>): void {
  const id = `${task.type}:${task.planId}:${task.targetPath}:${Date.now()}`;
  // 같은 대상 경로의 기존 완료 알림이 있다면 대체
  completedList = [
    { ...task, id, completedAt: Date.now() },
    ...completedList.filter((t) => !(t.planId === task.planId && t.targetPath === task.targetPath)),
  ].slice(0, 10); // 최대 10개 보관
  emitChange();
}

/** 특정 완료 알림 해제 */
export function dismissCompletedTask(id: string): void {
  const prevLen = completedList.length;
  completedList = completedList.filter((t) => t.id !== id);
  if (completedList.length !== prevLen) {
    emitChange();
  }
}

/** 특정 플랜 또는 전체에서 특정 경로와 일치하는 완료 알림 해제 */
export function dismissCompletedTaskByPath(pathname: string, planId?: string): void {
  const normalized = pathname.replace(/\/$/, '');
  const prevLen = completedList.length;
  completedList = completedList.filter((t) => {
    if (planId && t.planId !== planId) return true;
    const target = t.targetPath.replace(/\/$/, '');
    // 정확히 일치하거나 대상 경로의 하위 경로로 진입했을 때 해제
    return !(normalized === target || (target !== '' && normalized.startsWith(target)));
  });
  if (completedList.length !== prevLen) {
    emitChange();
  }
}

/* ------------------------------------------------------------------ */
/* 통합 훅: 진행 중 작업 + 완료된 작업                                   */
/* ------------------------------------------------------------------ */

export function useAiTasks(planId?: string) {
  const activeRun = usePlannerStore((s) => s.activeRun);
  const agentBusy = usePlannerStore((s) => s.agentBusy);
  const stitch = useSyncExternalStore(subscribeStitch, runningJobs, noJobs);
  const uinai = useSyncExternalStore(subscribeAllUinAi, runningUinAiJobs, noUinAiJobs);
  const completed = useSyncExternalStore(
    subscribeCompleted,
    getCompletedSnapshot,
    getCompletedServerSnapshot,
  );

  const running: RunningTask[] = [];

  if (activeRun && (!planId || activeRun.planId === planId)) {
    const current = currentOf(activeRun);
    const step =
      activeRun.artifacts.length > 1
        ? ` (${activeRun.done.length + 1}/${activeRun.artifacts.length})`
        : '';
    const subPath = current ? STEP_PATH[current] : '';
    const targetPath = `/plans/${activeRun.planId}${subPath}`;
    running.push({
      key: `gen:${activeRun.planId}`,
      planId: activeRun.planId,
      type: 'generation',
      what: current ? `${ARTIFACT_LABEL[current]} 생성 중${step}` : `산출물 생성 중${step}`,
      href: targetPath,
      targetPath,
    });
  }

  for (const job of stitch) {
    if (!planId || job.planId === planId) {
      const targetPath = `/plans/${job.planId}/export`;
      running.push({
        key: `stitch:${job.planId}`,
        planId: job.planId,
        type: 'stitch',
        what: `스티치 화면 생성 중 (${job.done}/${job.total})`,
        href: targetPath,
        targetPath,
      });
    }
  }

  for (const job of uinai) {
    if (!planId || job.planId === planId) {
      const targetPath = `/plans/${job.planId}/export`;
      running.push({
        key: `uinai:${job.planId}`,
        planId: job.planId,
        type: 'uinai',
        what: `UniAI 화면 생성 중 (${job.done}/${job.total})`,
        href: `/plans/${job.planId}/export?design=uinai`,
        targetPath,
      });
    }
  }

  if (agentBusy && (!planId || agentBusy === planId)) {
    const targetPath = `/plans/${agentBusy}`;
    running.push({
      key: `agent:${agentBusy}`,
      planId: agentBusy,
      type: 'agent',
      what: 'AI 에이전트 답변 중',
      href: targetPath,
      targetPath,
    });
  }

  const filteredCompleted = planId
    ? completed.filter((c) => c.planId === planId)
    : completed;

  return {
    running,
    completed: filteredCompleted,
    dismiss: dismissCompletedTask,
    dismissByPath: dismissCompletedTaskByPath,
  };
}

/** 사용자가 경로를 이동할 때 완료 알림을 자동으로 해제하는 훅 */
export function useAutoDismissCompleted(pathname: string, planId?: string) {
  useEffect(() => {
    if (!pathname) return;
    dismissCompletedTaskByPath(pathname, planId);
  }, [pathname, planId]);
}
