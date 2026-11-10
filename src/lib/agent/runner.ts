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
import { workspaceFetch as fetch } from '@/lib/admin-workspace';
import { creditSnapshot, refreshCredits } from '../useCredits';
import { engineSnapshot } from '../useEngine';
import { costWithEngine } from '../credits';
import { CHAT_CREDIT_COST, type ChatMessage, type PlanDocuments, type ReviewNote } from '../types';
import { recordCompletedTask } from '../tasks';
import { changedDocumentPatch, fsDocumentsEqual } from '../ai/document-patch';
import { planForAi } from '../plan-transport';

interface ChatResponse {
  reply?: string;
  changes?: string[];
  patch?: Partial<PlanDocuments>;
  error?: string;
  credits?: number;
}

/** Apply review outcomes only to findings that have not been changed or dismissed meanwhile. */
function mergeReviewNotes(
  before: PlanDocuments,
  current: ReviewNote[],
  reviewed: ReviewNote[],
): ReviewNote[] {
  const original = new Map((before.reviewNotes ?? []).map((note) => [note.id, note]));
  const outcomes = new Map(reviewed.map((note) => [note.id, note]));
  return current.flatMap((note) => {
    const previous = original.get(note.id);
    if (!previous || changedDocumentPatch({ ...before, reviewNotes: [previous] }, { reviewNotes: [note] })) {
      return [note];
    }
    const outcome = outcomes.get(note.id);
    return outcome ? [outcome] : [];
  });
}

/** 같은 플랜에 두 요청이 겹치지 않게 막는다. */
function isBusy(planId: string): boolean {
  return usePlannerStore.getState().agentBusy === planId;
}

/**
 * 지금 도는 요청을 끊을 손잡이. 플랜마다 하나다.
 *
 * 컴포넌트가 아니라 여기(모듈)에 둔다. 패널을 닫거나 다른 문서로 넘어가도
 * 요청은 계속 도는데, 그때 끊을 방법이 사라지면 안 되기 때문이다.
 */
const inFlight = new Map<string, AbortController>();
const requestOwners = new WeakMap<AbortController, string | null>();

/** 지금 이 플랜의 요청을 멈출 수 있는가. */
export function canCancel(planId: string): boolean {
  return inFlight.has(planId) || isBusy(planId);
}

/**
 * 도는 요청을 멈춘다.
 *
 * 서버에서 이미 끝낸 작업의 차감은 되돌리지 않는다. 늦게 도착한 수정안은 반영하지 않는다.
 */
export function cancelAgent(planId: string): boolean {
  const controller = inFlight.get(planId);
  if (controller) {
    controller.abort(new DOMException('User cancelled request', 'AbortError'));
    if (requestOwners.get(controller) === usePlannerStore.getState().owner) return true;
    // A previous account's request does not own the current account's busy state.
    if (inFlight.get(planId) === controller) inFlight.delete(planId);
  }
  if (!isBusy(planId)) return false;
  // 준비 중 실패해 실행 손잡이 없이 상태만 남았어도 멈추기로 복구한다.
  try { usePlannerStore.getState().setAgentBusy(null); } catch { /* 상태 갱신 후 저장소 실패 */ }
  return true;
}

export const AGENT_REQUEST_TIMEOUT_MS = 290_000;
export type AskResult = 'ok' | 'busy' | 'no-credits' | 'empty' | 'cancelled' | 'already-resolved' | 'failed';
interface AskOptions { resend?: boolean; reviewNoteIds?: string[]; recheckOnly?: boolean }

/** Also bounds readers that ignore AbortSignal, consuming any late rejection. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
    if (signal.aborted) abort();
  });
}

function appendFailure(planId: string, content: string, cancelled = false): void {
  try {
    usePlannerStore.getState().appendChat(planId, {
      role: 'assistant', content, failed: true, ...(cancelled ? { cancelled: true } : {}),
    });
  } catch { /* Reporting a storage failure must still release the lock. */ }
}

/** Tests inject a short deadline into the same executor used in production. */
export function createAgentExecutor({ timeoutMs }: { timeoutMs: number }) {
  const timeout = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(timeoutMs, AGENT_REQUEST_TIMEOUT_MS))
    : AGENT_REQUEST_TIMEOUT_MS;
  return (planId: string, message: string, options: AskOptions = {}) => executeAgent(planId, message, options, timeout);
}

/**
 * 에이전트에게 보낸다.
 *
 * `resend` 는 이미 대화에 남아 있는 질문을 다시 보내는 경우다. 질문을 또 적지 않는다.
 */
export async function askAgent(
  planId: string,
  message: string,
  options: AskOptions = {},
): Promise<AskResult> {
  return executeAgent(planId, message, options, AGENT_REQUEST_TIMEOUT_MS);
}

async function executeAgent(planId: string, message: string, options: AskOptions, timeoutMs: number): Promise<AskResult> {
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let requestOwner: string | null | undefined;
  let phase: 'setup' | 'request' | 'response' | 'apply' = 'setup';
  try {
    const text = message.trim();
    if (!text) return 'empty';
    const store = usePlannerStore.getState();
    requestOwner = store.owner;
    const previousRequest = inFlight.get(planId);
    if (previousRequest) {
      if (requestOwners.get(previousRequest) === requestOwner) return 'busy';
      previousRequest.abort(new DOMException('Account changed', 'AbortError'));
      if (inFlight.get(planId) === previousRequest) inFlight.delete(planId);
    }
    if (isBusy(planId)) cancelAgent(planId);
    const plan = store.plans.find((p) => p.id === planId);
    if (!plan) return 'empty';

    const existingNotes = new Set((plan.reviewNotes ?? []).map((note) => note.id));
    const reviewNoteIds = options.reviewNoteIds?.filter((id) => existingNotes.has(id));
    if (options.reviewNoteIds?.length && reviewNoteIds?.length === 0) return 'already-resolved';

    /*
     * 낼 수 있는지는 **서버가 본다**(402). 여기서는 화면에 있는 숫자로 미리
     * 걸러 주기만 한다 — 이 숫자도 서버가 준 것이라 대개 맞지만, 근거는 아니다.
     */
    // 등급에 따라 값이 다르다. 서버가 깎는 것과 같은 함수로 센다.
    const cost = costWithEngine(CHAT_CREDIT_COST, engineSnapshot());
    if (creditSnapshot().remaining < cost) return 'no-credits';

    controller = new AbortController();
    requestOwners.set(controller, requestOwner);
    inFlight.set(planId, controller);
    const deadline = Date.now() + timeoutMs;
    timer = setTimeout(() => {
      timedOut = true;
      controller?.abort(new DOMException('Agent request timed out', 'TimeoutError'));
    }, timeoutMs);
    store.setAgentBusy(planId);
    if (!options.resend) store.appendChat(planId, {
      role: 'user',
      content: text,
      reviewNoteIds,
      recheckOnly: options.recheckOnly,
    });
    const current = usePlannerStore.getState().plans.find((p) => p.id === planId) ?? plan;
    const sentPlan = structuredClone(planForAi(current));
    const body = JSON.stringify({ plan: sentPlan, message: text, reviewNoteIds, recheckOnly: options.recheckOnly });
    if (Date.now() >= deadline) {
      timedOut = true;
      controller.abort(new DOMException('Agent preparation timed out', 'TimeoutError'));
    }
    controller.signal.throwIfAborted();
    phase = 'request';
    const response = await untilAborted(fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      // 보내는 시점의 문서를 쓴다. 대화 중에 다른 화면에서 고쳤을 수 있다.
      body,
    }), controller.signal);
    if (usePlannerStore.getState().owner !== requestOwner) return 'cancelled';
    controller.signal.throwIfAborted();
    phase = 'response';

    /*
     * 서버가 크레딧이 없다고 하면 대화에 실패 말풍선을 남기지 않는다 —
     * 이건 답을 못 만든 것이 아니라 아예 걸지 못한 것이라, 알림으로 알려야 한다.
     */
    if (response.status === 402) {
      void refreshCredits();
      return 'no-credits';
    }

    let data: ChatResponse;
    try {
      data = (await untilAborted(response.json(), controller.signal)) as ChatResponse;
    } catch {
      if (usePlannerStore.getState().owner !== requestOwner) return 'cancelled';
      controller.signal.throwIfAborted();
      appendFailure(planId, response.status === 413
        ? '요청 문서가 서버 허용 크기를 초과했습니다. 현재 문서를 내보내 보관한 뒤 지원을 요청해 주세요.'
        : response.ok
          ? '서버 응답을 읽지 못했습니다. 크레딧 사용 내역을 확인한 뒤 다시 시도해 주세요.'
          : `서버가 요청을 처리하지 못했습니다. (HTTP ${response.status}) 잠시 뒤 다시 시도해 주세요.`);
      void refreshCredits();
      return 'failed';
    }
    if (usePlannerStore.getState().owner !== requestOwner) return 'cancelled';
    controller.signal.throwIfAborted();

    if (!response.ok || !data || typeof data.reply !== 'string' || !data.reply) {
      appendFailure(planId, data?.error ?? (response.status === 413
        ? '요청 문서가 서버 허용 크기를 초과했습니다.'
        : `응답을 만들지 못했습니다. (HTTP ${response.status})`));
      void refreshCredits();
      return 'failed';
    }

    phase = 'apply';
    const latest = usePlannerStore.getState();
    const currentPlan = latest.plans.find((p) => p.id === planId);
    let reply = data.reply;
    let changes = data.changes;
    if (data.patch && Object.keys(data.patch).length > 0) {
      if (
        !currentPlan ||
        !fsDocumentsEqual(sentPlan, currentPlan) ||
        JSON.stringify(sentPlan.brief) !== JSON.stringify(currentPlan.brief)
      ) {
        data.patch = undefined;
        changes = [];
        reply = '답변을 기다리는 동안 최신 문서가 변경되어 수정안과 검토 결과를 반영하지 않았습니다. 현재 문서를 기준으로 다시 요청해 주세요.';
      } else {
        if (data.patch.reviewNotes !== undefined) {
          data.patch = {
            ...data.patch,
            reviewNotes: mergeReviewNotes(sentPlan, currentPlan.reviewNotes ?? [], data.patch.reviewNotes),
          };
        }
        data.patch = changedDocumentPatch(currentPlan, data.patch);
      }
    }
    if (!data.patch) changes = [];
    if (data.patch) {
      /*
       * 고치기 **전에** 되돌릴 지점을 남긴다.
       *
       * 에이전트 수정은 산출물을 통째로 갈아 끼우므로, 결과가 마음에 들지 않으면
       * 손으로 되돌릴 방법이 없다. 서버가 내용 손실을 막고 있지만 그것만으로는
       * "지워지진 않았는데 엉뚱하게 바뀐" 경우를 되돌릴 수 없다.
       * 개요 화면의 버전 기록에서 언제든 이 지점으로 돌아갈 수 있다.
       */
      latest.saveVersion(planId, 'AI 에이전트 반영 전');
      controller.signal.throwIfAborted();
      usePlannerStore.getState().applyDocuments(planId, data.patch);
    }
    // 값은 서버가 뺐다. 여기서는 바뀐 잔량을 다시 물어보기만 한다.
    void refreshCredits();
    latest.appendChat(planId, {
      role: 'assistant',
      content: reply,
      changes,
      credits: data.credits ?? cost,
    });
    recordCompletedTask({
      planId,
      type: 'agent',
      title: 'AI 에이전트 답변 완료',
      href: `/plans/${planId}`,
      targetPath: `/plans/${planId}`,
    });
    return 'ok';
  } catch (error) {
    // Same IDs and identical document bodies can exist under the next signed-in account.
    if (requestOwner !== undefined && usePlannerStore.getState().owner !== requestOwner) return 'cancelled';
    /*
     * 사용자가 멈춘 것과 연결이 끊긴 것을 구별한다.
     *
     * 스스로 멈춰 놓고 "연결이 끊겼습니다" 를 보면 앱이 고장 난 줄 안다.
     * 둘 다 답을 못 받은 것은 같으므로 `failed` 로 남겨, 다시 보내기가 뜨게 한다.
     */
    const cancelled = !timedOut && controller?.signal.aborted === true;
    const quota = error instanceof Error && (error.name === 'QuotaExceededError' || /quota/i.test(error.message));
    const content = timedOut
      ? '응답 제한 시간을 초과해 대기를 끝냈습니다. 크레딧 사용 내역을 확인한 뒤 다시 시도해 주세요.'
      : cancelled
        ? '요청 대기를 멈췄습니다. 늦게 도착하는 응답은 반영하지 않습니다. 이미 처리된 크레딧은 사용 내역에서 확인할 수 있습니다.'
        : phase === 'setup'
          ? quota
            ? '브라우저 저장 공간이 부족해 요청을 준비하지 못했습니다. 현재 문서를 내보내 보관한 뒤 다시 시도해 주세요.'
            : '문서에서 AI 요청을 준비하지 못했습니다. 현재 문서를 보관하고 다시 열어 시도해 주세요.'
          : phase === 'apply'
            ? '응답을 받았지만 문서 반영을 마치지 못했습니다. 현재 문서와 크레딧 사용 내역을 확인해 주세요.'
            : '서버 응답을 받지 못했습니다. 크레딧 사용 내역을 확인한 뒤 다시 시도해 주세요.';
    appendFailure(planId, content, cancelled);
    if (phase !== 'setup') void refreshCredits();
    return cancelled ? 'cancelled' : 'failed';
  } finally {
    if (timer) clearTimeout(timer);
    // 그 사이에 새 요청이 시작됐다면 그쪽 손잡이를 지우지 않는다.
    const owned = controller !== undefined && inFlight.get(planId) === controller;
    if (owned) inFlight.delete(planId);
    // 그 사이에 다른 플랜에서 새 요청이 시작됐다면 그쪽 표시를 지우지 않는다.
    // A new owner's real request has a different controller; an inherited old flag can be cleared.
    if (owned && usePlannerStore.getState().agentBusy === planId) {
      try { usePlannerStore.getState().setAgentBusy(null); } catch { /* Persistence failure must not strand the lock. */ }
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
type ResendMessage = Pick<ChatMessage, 'content' | 'failed' | 'reviewNoteIds' | 'recheckOnly'> & {
  role: string;
};

export function unansweredRequest(chat: ResendMessage[]): ResendMessage | null {
  const last = chat[chat.length - 1];
  if (!last) return null;
  if (last.role === 'user') return last;
  if (last.role !== 'assistant' || !last.failed) return null;

  // 실패 바로 앞의 질문을 찾는다.
  for (let i = chat.length - 2; i >= 0; i -= 1) {
    if (chat[i].role === 'user') return chat[i];
  }
  return null;
}

export function unansweredQuestion(chat: ResendMessage[]): string | null {
  return unansweredRequest(chat)?.content ?? null;
}
