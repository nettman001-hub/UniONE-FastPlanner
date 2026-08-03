'use client';

/**
 * 생성 실행기.
 *
 * `/api/generate` 가 흘려보내는 결과를 한 줄씩 읽어 문서에 반영한다.
 *
 * **모듈 수준에서 돈다.** React 컴포넌트 안이 아니므로, 생성을 걸어 놓고 사이드바로
 * 다른 메뉴에 넘어가도 읽기가 멈추지 않는다. 페이지 자체를 떠날 때(새로고침·창 닫기)만
 * 끊기며, 그때는 서버도 `signal.aborted` 를 보고 다음 단계로 넘어가지 않는다.
 *
 * 그때까지 받은 단계는 이미 저장돼 있고, `interrupted` 기록이 남아 돌아왔을 때
 * 남은 단계부터 이어 갈 수 있다.
 */

import { usePlannerStore } from '../store';
import { ARTIFACT_CREDIT_COST, ARTIFACT_LABEL, type ArtifactKey, type PlanDocuments } from '../types';

type Toast = (message: string, tone?: 'ok' | 'warn' | 'danger') => void;

interface StreamEvent {
  type: 'start' | 'step' | 'done' | 'error';
  artifact?: ArtifactKey;
  patch?: Partial<PlanDocuments>;
  source?: 'ai' | 'local';
  warning?: string;
  message?: string;
}

export interface RunArgs {
  pageIds?: string[];
  merge?: boolean;
  extra?: string;
}

/** 지금 도는 생성이 있는지. 한 번에 하나만 돌린다 — 앞 단계 결과를 컨텍스트로 쓰기 때문. */
let inFlight = false;

export function isRunning() {
  return inFlight;
}

/** NDJSON 스트림을 한 줄씩 흘려 준다. */
async function* readLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield line;
      }
    }
    const rest = buffer.trim();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

export async function runGeneration(
  planId: string,
  artifacts: ArtifactKey[],
  args: RunArgs,
  toast: Toast,
): Promise<boolean> {
  if (inFlight) return false;

  const store = usePlannerStore;
  const { spendCredits, applyDocuments, setActiveRun, setInterrupted } = store.getState();

  /*
   * 값은 **결과를 받았을 때** 치른다.
   *
   * 시작할 때 미리 빼면, 그 단계가 끝나기 전에 창을 닫았을 때 받지도 못한 것에 값을
   * 치른 셈이 된다. 시작 전에는 낼 수 있는지만 확인한다.
   */
  const firstCost = ARTIFACT_CREDIT_COST[artifacts[0]];
  if (store.getState().credits < firstCost) {
    toast(
      `크레딧이 부족합니다. ${ARTIFACT_LABEL[artifacts[0]]} 생성에는 ${firstCost} 크레딧이 필요합니다. 내일 다시 충전됩니다.`,
      'warn',
    );
    return false;
  }

  const plan = store.getState().getPlan(planId);
  if (!plan) return false;

  inFlight = true;
  const done: ArtifactKey[] = [];
  const pipeline = artifacts.length > 1;

  setActiveRun({ planId, artifacts, current: artifacts[0], done: [] });
  // 시작하자마자 적어 둔다. 탭이 갑자기 사라져도 이 기록이 남아 이어 갈 수 있다.
  if (pipeline) setInterrupted({ planId, done: [], remaining: [...artifacts] });

  let finished = false;
  let failure: string | null = null;
  /** 중간에 그만둘 때 서버도 멈추도록. */
  const controller = new AbortController();

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifacts, plan, ...args }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      failure = data.error ?? '생성 요청에 실패했습니다.';
    } else {
      for await (const line of readLines(response.body)) {
        let event: StreamEvent;
        try {
          event = JSON.parse(line) as StreamEvent;
        } catch {
          continue;
        }

        if (event.type === 'start' && event.artifact) {
          setActiveRun({ planId, artifacts, current: event.artifact, done: [...done] });
        }

        if (event.type === 'step' && event.artifact && event.patch) {
          applyDocuments(planId, event.patch, [event.artifact]);
          done.push(event.artifact);
          // 받은 것에만 값을 치른다.
          spendCredits(ARTIFACT_CREDIT_COST[event.artifact]);
          setActiveRun({ planId, artifacts, current: null, done: [...done] });
          if (pipeline) {
            setInterrupted({
              planId,
              done: [...done],
              remaining: artifacts.filter((a) => !done.includes(a)),
            });
          }
          if (event.warning) {
            toast(`AI 호출에 실패해 내장 생성기로 만들었습니다.\n${event.warning}`, 'warn');
          }

          // 다음 단계 값을 못 내면 여기서 그만둔다. 서버도 함께 멈춘다.
          const next = artifacts.find((a) => !done.includes(a));
          if (next && store.getState().credits < ARTIFACT_CREDIT_COST[next]) {
            failure = `크레딧이 부족해 ${ARTIFACT_LABEL[next]} 부터는 만들지 못했습니다. 내일 다시 충전됩니다.`;
            controller.abort();
            break;
          }
        }

        if (event.type === 'error') {
          failure = event.message ?? '생성 중 오류가 발생했습니다.';
          break;
        }

        if (event.type === 'done') {
          finished = true;
        }
      }
    }
  } catch {
    if (!failure) failure = '연결이 끊겨 생성을 마치지 못했습니다.';
  } finally {
    inFlight = false;
    setActiveRun(null);
    if (finished || done.length === artifacts.length) {
      setInterrupted(null);
    } else if (pipeline) {
      setInterrupted({
        planId,
        done: [...done],
        remaining: artifacts.filter((a) => !done.includes(a)),
      });
    }
  }

  if (failure) {
    toast(failure, 'danger');
    return false;
  }

  if (finished) {
    const what = pipeline ? `${done.length}종 산출물` : ARTIFACT_LABEL[artifacts[0]];
    toast(`${what}을(를) 만들었습니다.`, 'ok');
    return true;
  }

  // 스트림이 done 없이 끝났다 — 대개 시간 제한이나 연결 문제.
  if (done.length > 0) {
    toast(`${done.length}단계까지 만들고 멈췄습니다. 이어서 만들 수 있습니다.`, 'warn');
  }
  return done.length > 0;
}
