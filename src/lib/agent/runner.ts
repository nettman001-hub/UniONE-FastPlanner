'use client';

/**
 * AI 에이전트 요청 실행기.
 *
 * **컴포넌트 밖(모듈 수준)에서 돈다.** 패널이 화면에서 사라져도, 사이드바로 다른
 * 문서에 넘어가도 요청은 그대로 이어진다. 생성 파이프라인(`jobs/runner.ts`)에서
 * 같은 이유로 쓴 방식이다 — 화면 컴포넌트에 요청을 매달면 그 컴포넌트가 사라지는
 * 순간 진행 상황을 잃는다.
 *
 * 상태는 전부 스토어에 있으므로, 패널이 다시 그려지면 그때의 진행 상황이 그대로 보인다.
 */

import { usePlannerStore } from '../store';
import { CHAT_CREDIT_COST, type PlanDocuments } from '../types';

interface ChatResponse {
  reply?: string;
  changes?: string[];
  patch?: Partial<PlanDocuments>;
  error?: string;
}

/** 같은 플랜에 두 요청이 겹치지 않게 막는다. */
function isBusy(planId: string): boolean {
  return usePlannerStore.getState().agentBusy === planId;
}

export type AskResult = 'ok' | 'busy' | 'no-credits' | 'empty';

/**
 * 에이전트에게 보낸다.
 *
 * `resend` 는 이미 대화에 남아 있는 질문을 다시 보내는 경우다. 질문을 또 적지 않는다.
 */
export async function askAgent(
  planId: string,
  message: string,
  options: { resend?: boolean } = {},
): Promise<AskResult> {
  const text = message.trim();
  if (!text) return 'empty';
  if (isBusy(planId)) return 'busy';

  const store = usePlannerStore.getState();
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) return 'empty';

  // 크레딧은 **답을 받은 뒤에** 뺀다. 받지 못한 것에 값을 치르지 않는다.
  if (store.credits < CHAT_CREDIT_COST) return 'no-credits';

  if (!options.resend) store.appendChat(planId, { role: 'user', content: text });
  store.setAgentBusy(planId);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 보내는 시점의 문서를 쓴다. 대화 중에 다른 화면에서 고쳤을 수 있다.
      body: JSON.stringify({
        plan: usePlannerStore.getState().plans.find((p) => p.id === planId) ?? plan,
        message: text,
      }),
    });
    const data = (await response.json()) as ChatResponse;

    if (!response.ok || !data.reply) {
      usePlannerStore.getState().appendChat(planId, {
        role: 'assistant',
        content: data.error ?? '응답을 만들지 못했습니다.',
        failed: true,
      });
      return 'ok';
    }

    const latest = usePlannerStore.getState();
    if (data.patch && Object.keys(data.patch).length > 0) {
      /*
       * 고치기 **전에** 되돌릴 지점을 남긴다.
       *
       * 에이전트 수정은 산출물을 통째로 갈아 끼우므로, 결과가 마음에 들지 않으면
       * 손으로 되돌릴 방법이 없다. 서버가 내용 손실을 막고 있지만 그것만으로는
       * "지워지진 않았는데 엉뚱하게 바뀐" 경우를 되돌릴 수 없다.
       * 개요 화면의 버전 기록에서 언제든 이 지점으로 돌아갈 수 있다.
       */
      latest.saveVersion(planId, 'AI 에이전트 반영 전');
      usePlannerStore.getState().applyDocuments(planId, data.patch);
    }
    latest.spendCredits(CHAT_CREDIT_COST);
    latest.appendChat(planId, {
      role: 'assistant',
      content: data.reply,
      changes: data.changes,
      credits: CHAT_CREDIT_COST,
    });
    return 'ok';
  } catch {
    // 창을 새로 고치거나 연결이 끊겨 요청이 중단된 경우도 여기로 온다.
    usePlannerStore.getState().appendChat(planId, {
      role: 'assistant',
      content: '답변을 받지 못했습니다. 요청이 중단되었거나 연결이 끊겼습니다.',
      failed: true,
    });
    return 'ok';
  } finally {
    // 그 사이에 다른 플랜에서 새 요청이 시작됐다면 그쪽 표시를 지우지 않는다.
    if (usePlannerStore.getState().agentBusy === planId) {
      usePlannerStore.getState().setAgentBusy(null);
    }
  }
}

/**
 * 답을 받지 못한 마지막 질문.
 *
 * 두 가지 모양이 있다.
 *
 * - 질문만 남아 있다 — 요청이 시작되기 전에 끊긴 경우
 * - 질문 뒤에 실패 표시가 붙어 있다 — 요청이 중단되거나 서버가 거절한 경우
 *
 * 둘 다 그대로 두면 막다른 길이 된다. 그 질문을 찾아 다시 보낼 수 있게 한다.
 */
export function unansweredQuestion(
  chat: { role: string; content: string; failed?: boolean }[],
): string | null {
  const last = chat[chat.length - 1];
  if (!last) return null;
  if (last.role === 'user') return last.content;
  if (last.role !== 'assistant' || !last.failed) return null;

  // 실패 바로 앞의 질문을 찾는다.
  for (let i = chat.length - 2; i >= 0; i -= 1) {
    if (chat[i].role === 'user') return chat[i].content;
  }
  return null;
}
