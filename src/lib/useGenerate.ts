'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlannerStore } from './store';
import { ARTIFACT_CREDIT_COST, ARTIFACT_LABEL, type ArtifactKey, type Plan, type PlanDocuments } from './types';
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

/**
 * 산출물 생성 훅.
 *
 * 진행 상태는 **스토어**에 있다. 생성 중에 사이드바로 다른 메뉴에 넘어가도
 * 요청은 계속 돌고, 옮겨 간 화면에서도 같은 진행 표시를 본다.
 * (예전에는 지역 `useState` 라 페이지가 언마운트되면서 멈춘 것처럼 보였다.)
 */
export function useGenerate(plan: Plan | undefined) {
  const generating = usePlannerStore((s) => s.generating);
  const applyDocuments = usePlannerStore((s) => s.applyDocuments);
  const spendCredits = usePlannerStore((s) => s.spendCredits);
  const beginGenerate = usePlannerStore((s) => s.beginGenerate);
  const endGenerate = usePlannerStore((s) => s.endGenerate);
  const toast = useToast();

  const pending = useMemo<ArtifactKey | null>(() => {
    if (!plan) return null;
    const hit = generating.find((key) => key.startsWith(`${plan.id}:`));
    return hit ? (hit.slice(plan.id.length + 1) as ArtifactKey) : null;
  }, [generating, plan]);

  const planId = plan?.id;

  const generate = useCallback(
    async (artifact: ArtifactKey, args: GenerateArgs = {}) => {
      if (!planId) return false;

      // 자리를 먼저 원자적으로 잡는다. 클로저에 갇힌 옛 pending 값을 보지 않으므로
      // 화면을 옮겨 다녀도 중복 실행이 생기지 않는다.
      if (!beginGenerate(planId, artifact)) return false;

      const cost = ARTIFACT_CREDIT_COST[artifact];
      if (!spendCredits(cost)) {
        endGenerate(planId, artifact);
        toast(
          `크레딧이 부족합니다. ${ARTIFACT_LABEL[artifact]} 생성에는 ${cost} 크레딧이 필요합니다. 내일 다시 충전됩니다.`,
          'warn',
        );
        return false;
      }

      try {
        /*
         * 보낼 문서는 **호출 직전에 스토어에서 읽는다.**
         *
         * 클로저에 담긴 스냅샷을 보내면 앞 단계 결과가 빠진 채로 나간다.
         * 전체 자동 생성 도중 다른 메뉴로 넘어가면 개요가 언마운트되면서
         * 스냅샷이 그 시점에 얼어붙어, 정보구조도 차례에 "기능명세서를 먼저
         * 생성해 주세요"(409) 로 파이프라인이 끊겼다.
         */
        const current = usePlannerStore.getState().getPlan(planId);
        if (!current) return false;

        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ artifact, plan: current, ...args }),
        });
        const data = (await response.json()) as {
          patch?: Partial<PlanDocuments>;
          source?: string;
          warning?: string;
          error?: string;
        };

        if (!response.ok || !data.patch) {
          toast(data.error ?? '생성에 실패했습니다.', 'danger');
          return false;
        }

        applyDocuments(planId, data.patch, [artifact]);

        if (data.warning) {
          toast(`AI 호출에 실패해 내장 생성기로 만들었습니다.\n${data.warning}`, 'warn');
        } else {
          toast(
            `${ARTIFACT_LABEL[artifact]}을(를) ${data.source === 'ai' ? 'AI로' : '내장 생성기로'} 만들었습니다. (-${cost} 크레딧)`,
            'ok',
          );
        }
        return true;
      } catch {
        toast('네트워크 오류로 생성에 실패했습니다.', 'danger');
        return false;
      } finally {
        endGenerate(planId, artifact);
      }
    },
    [planId, applyDocuments, spendCredits, beginGenerate, endGenerate, toast],
  );

  return { generate, pending };
}
