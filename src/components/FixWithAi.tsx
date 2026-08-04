'use client';

/**
 * 정합성 검사 지적을 에이전트에게 바로 넘기는 버튼.
 *
 * 누르면 **패널을 열고 요청까지 보낸다.** 지적에 이미 무엇이·왜·어느 항목인지가
 * 다 있으므로 사람이 다시 옮겨 적을 이유가 없다. `수정하러 가기` 로 화면에 도착한
 * 뒤 "그래서 뭘 고치지" 로 멈추던 자리를 메운다.
 *
 * 대화에는 보낸 요청이 그대로 남는다. 무엇을 시켰는지 나중에도 보이고,
 * 마음에 안 들면 이어서 말로 고칠 수 있다.
 */

import { useState } from 'react';
import { Wand2 } from 'lucide-react';

import { askAgent } from '@/lib/agent/runner';
import { usePlannerStore } from '@/lib/store';
import { CHAT_CREDIT_COST } from '@/lib/types';
import { Spinner, useToast } from './ui';

export function FixWithAi({
  planId,
  prompt,
  label = 'AI로 수정하기',
  className = 'btn btn-sm shrink-0',
}: {
  planId: string;
  prompt: string;
  label?: string;
  className?: string;
}) {
  /**
   * **이 버튼이** 보낸 요청이 도는 중인가.
   *
   * 스토어의 `agentBusy` 는 플랜 단위라, 그것만 보면 목록에 있는 버튼이 전부
   * 자기 일인 줄 알고 함께 돌아간다. 어느 것을 눌렀는지 알 수 없게 된다.
   * 표시는 누른 버튼만 한다.
   */
  const [sending, setSending] = useState(false);
  /** 다른 요청이 도는 중. 누를 수는 없지만 **내 일은 아니다.** */
  const planBusy = usePlannerStore((s) => s.agentBusy === planId);
  const credits = usePlannerStore((s) => s.credits);
  const setAgentOpen = usePlannerStore((s) => s.setAgentOpen);
  const toast = useToast();

  const outOfCredits = credits < CHAT_CREDIT_COST;
  const othersBusy = planBusy && !sending;

  const run = async () => {
    if (planBusy) {
      toast('앞선 요청이 끝난 뒤에 보낼 수 있습니다.', 'warn');
      return;
    }
    if (outOfCredits) {
      toast('크레딧이 부족합니다. 내일 다시 충전됩니다.', 'warn');
      return;
    }
    // 먼저 연다. 보내 놓고 아무 일도 안 일어나는 것처럼 보이면 안 된다.
    setAgentOpen(true);
    setSending(true);
    try {
      const result = await askAgent(planId, prompt);
      if (result === 'busy') toast('앞선 요청이 끝난 뒤에 보낼 수 있습니다.', 'warn');
      if (result === 'no-credits') toast('크레딧이 부족합니다. 내일 다시 충전됩니다.', 'warn');
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      className={className}
      onClick={() => void run()}
      disabled={planBusy || outOfCredits}
      title={
        outOfCredits
          ? '크레딧을 모두 사용했습니다.'
          : othersBusy
            ? '다른 요청이 진행 중입니다. 끝나면 누를 수 있습니다.'
            : `AI 에이전트에게 이 문제를 고쳐 달라고 요청합니다. (${CHAT_CREDIT_COST} 크레딧)`
      }
    >
      {sending ? <Spinner size={12} /> : <Wand2 size={12} />}
      {sending ? '보내는 중' : label}
    </button>
  );
}
