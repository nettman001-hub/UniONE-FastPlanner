'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlannerStore } from './store';
import { ARTIFACT_CREDIT_COST, ARTIFACT_LABEL, type ArtifactKey, type Plan, type PlanDocuments } from './types';
import { useToast } from '@/components/ui';

export type AiMode = 'ai' | 'local' | 'unknown';

/** 헤더 등에서 현재 생성 모드를 보여주기 위한 훅. */
export function useAiMode(): { mode: AiMode; model: string | null } {
  const [state, setState] = useState<{ mode: AiMode; model: string | null }>({
    mode: 'unknown',
    model: null,
  });

  useEffect(() => {
    let alive = true;
    fetch('/api/status')
      .then((r) => r.json())
      .then((data: { mode: AiMode; model: string | null }) => {
        if (alive) setState({ mode: data.mode, model: data.model });
      })
      .catch(() => {
        if (alive) setState({ mode: 'local', model: null });
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

export function useGenerate(plan: Plan | undefined) {
  const [pending, setPending] = useState<ArtifactKey | null>(null);
  const applyDocuments = usePlannerStore((s) => s.applyDocuments);
  const spendCredits = usePlannerStore((s) => s.spendCredits);
  const toast = useToast();

  const generate = useCallback(
    async (artifact: ArtifactKey, args: GenerateArgs = {}) => {
      if (!plan) return false;
      if (pending) return false;

      const cost = ARTIFACT_CREDIT_COST[artifact];
      if (!spendCredits(cost)) {
        toast(
          `크레딧이 부족합니다. ${ARTIFACT_LABEL[artifact]} 생성에는 ${cost} 크레딧이 필요합니다. 내일 다시 충전됩니다.`,
          'warn',
        );
        return false;
      }

      setPending(artifact);
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ artifact, plan, ...args }),
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

        applyDocuments(plan.id, data.patch, [artifact]);

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
        setPending(null);
      }
    },
    [plan, pending, applyDocuments, spendCredits, toast],
  );

  return { generate, pending };
}
