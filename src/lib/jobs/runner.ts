'use client';

/**
 * 생성 실행기.
 *
 * `/api/generate` 가 흘려보내는 결과를 한 줄씩 읽어 문서에 반영한다.
 *
 * **모듈 수준에서 돈다.** React 컴포넌트 안이 아니므로, 생성을 걸어 놓고 사이드바로
 * 다른 메뉴에 넘어가도 읽기가 멈추지 않는다. 페이지 자체를 떠날 때(새로고침·창 닫기)만
 * 끊기며, 단계마다 요청을 따로 보내므로 그 뒤 단계는 요청되지 않는다.
 *
 * 그때까지 받은 단계는 이미 저장돼 있고, `interrupted` 기록이 남아 돌아왔을 때
 * 남은 단계부터 이어 갈 수 있다.
 */

import { usePlannerStore } from '../store';
import { creditSnapshot, refreshCredits } from '../useCredits';
import { ARTIFACT_LABEL, type ArtifactKey, type PlanDocuments } from '../types';
import { REVIEW_COST, SPEC_DETAIL_COST, SPEC_FILL_COST, costOfArtifact, costWithEngine } from '../credits';
import { engineSnapshotFor } from '../useEngine';
import { recordCompletedTask } from '../tasks';

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
  /** 이번 한 번만 주는 지시 — "결제·환불 쪽을 더 자세히" */
  extra?: string;
  /** 기능명세서에서 이 기능들의 상세명세만 채운다 */
  specFeatureIds?: string[];
  /** 기능명세서 AI 검토만 */
  reviewFs?: boolean;
  /** 이 상세명세 한 건만 깊게 만든다 */
  deepenSpecId?: string;
}

/** 지금 도는 생성이 있는지. 한 번에 하나만 돌린다 — 앞 단계 결과를 컨텍스트로 쓰기 때문. */
let inFlight = false;

export function isRunning() {
  return inFlight;
}

/**
 * 도는 생성을 끊을 손잡이.
 *
 * 컴포넌트가 아니라 여기(모듈)에 둔다. 생성을 걸어 놓고 다른 메뉴로 넘어가도
 * 계속 도는데, 그때 멈출 방법이 사라지면 안 되기 때문이다.
 */
let running: AbortController | null = null;
/** 사용자가 스스로 멈췄는가. 연결이 끊긴 것과 구별해 알리기 위해 표시해 둔다. */
let cancelledByUser = false;

/**
 * 생성을 멈춘다.
 *
 * **이미 만들어진 단계는 그대로 남는다.** 값도 그 단계까지만 치렀다.
 * 남은 단계는 `이어서 만들기` 로 이어 갈 수 있게 기록해 둔다 —
 * 처음부터 다시 만들면 이미 낸 크레딧을 또 내야 한다.
 */
export function cancelGeneration(): boolean {
  if (!running) return false;
  cancelledByUser = true;
  running.abort();
  return true;
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
  const { applyDocuments, setActiveRun, setInterrupted } = store.getState();

  /*
   * 값은 **결과를 받았을 때** 서버가 치른다. 낼 수 있는지도 서버가 본다 —
   * 여기서 미리 걸러 주는 것은 헛걸음을 줄이려는 것일 뿐 근거가 아니다.
   * 부족하면 서버가 `error` 사건으로 알려 주고, 아래에서 그대로 알린다.
   */
  const firstCost =
    artifacts[0] === 'fs' && args.deepenSpecId
      ? costWithEngine(SPEC_DETAIL_COST, engineSnapshotFor('fs'))
      : artifacts[0] === 'fs' && (args.specFeatureIds?.length ?? 0) > 0
      ? costWithEngine(SPEC_FILL_COST, engineSnapshotFor('fs'))
      : artifacts[0] === 'fs' && args.reviewFs
        ? costWithEngine(REVIEW_COST, engineSnapshotFor('fs'))
        : costOfArtifact(artifacts[0], engineSnapshotFor(artifacts[0]));
  if (creditSnapshot().remaining < firstCost) {
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
  running = controller;
  cancelledByUser = false;

  /*
   * `AI로 채우기`·`AI 검토`·`깊게 만들기` 는 기능명세서 한 단계만 만들 때의 옵션이다. 예전에는 서버가
   * "여러 단계면 받지 않음" 으로 걸렀지만, 이제 단계마다 한 종씩 보내므로 여기서 거른다.
   */
  const stepArgs: RunArgs = pipeline
    ? { ...args, specFeatureIds: undefined, reviewFs: undefined, deepenSpecId: undefined }
    : args;

  try {
    /*
     * 전체 자동 생성도 **단계마다 요청을 따로** 보낸다.
     *
     * 한 요청에 다섯 단계를 몰아 넣으면 라우트 제한(300초)을 넘긴다 — PRD(약 80초)에
     * 기능명세서와 AI 검토(약 235초)만 더해도 넘고, 그러면 기능명세서까지 잃는다.
     * 요청을 새로 열면 단계 하나가 300초를 온전히 쓴다. 앞 단계 결과는 방금 스토어에
     * 반영했으므로 플랜을 다시 읽어 넘기면 된다.
     */
    for (const artifact of artifacts) {
      const current = store.getState().getPlan(planId) ?? plan;
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifacts: [artifact], plan: current, ...stepArgs }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        failure = data.error ?? '생성 요청에 실패했습니다.';
        break;
      }

      let stepFinished = false;
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
          // 값은 서버가 뺐다. 여기서는 바뀐 잔량을 다시 물어보기만 한다.
          void refreshCredits();
          setActiveRun({ planId, artifacts, current: null, done: [...done] });
          if (pipeline) {
            setInterrupted({
              planId,
              done: [...done],
              remaining: artifacts.filter((a) => !done.includes(a)),
            });
          }
          if (event.warning) {
            toast(`${event.warning}\n대신 기본 생성기로 만들었습니다.`, 'warn');
          }

          /*
           * 다음 단계 값을 못 내는지는 **서버가 본다.** 서버가 못 낸다고 하면
           * `error` 사건을 보내고 흐름을 멈춘다. 여기서 또 세면, 방금 빼 간
           * 값을 아직 못 받아 온 사이에 엉뚱하게 끊길 수 있다.
           */
        }

        if (event.type === 'error') {
          failure = event.message ?? '생성 중 오류가 발생했습니다.';
          break;
        }

        if (event.type === 'done') {
          stepFinished = true;
        }
      }

      // 실패했거나 `done` 없이 끝났다(대개 시간 제한·연결 문제). 다음 단계로 넘어가지 않는다.
      if (failure || !stepFinished) break;
    }
    finished = !failure && done.length === artifacts.length;
  } catch {
    // 스스로 멈춘 것은 사고가 아니다. 아래에서 따로 알린다.
    if (!failure && !cancelledByUser) failure = '연결이 끊겨 생성을 마치지 못했습니다.';
  } finally {
    inFlight = false;
    if (running === controller) running = null;
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

  /*
   * 스스로 멈춘 경우.
   *
   * 만들어진 단계는 그대로 남고 값도 거기까지만 냈다는 것을 분명히 말한다.
   * 이것을 안 알려 주면 "돈만 나가고 반쯤 만들다 말았다" 로 읽힌다.
   */
  if (cancelledByUser) {
    cancelledByUser = false;
    toast(
      done.length > 0
        ? `${done.length}단계까지 만들고 멈췄습니다. 만들어진 것은 그대로 있고, 나머지는 이어서 만들 수 있습니다.`
        : '생성을 멈췄습니다. 크레딧은 차감되지 않았습니다.',
      'warn',
    );
    return done.length > 0;
  }

  if (finished) {
    const what = pipeline ? `${done.length}종 산출물` : ARTIFACT_LABEL[artifacts[0]];
    toast(`${what}을(를) 만들었습니다.`, 'ok');
    const targetSubPath = pipeline ? (done[0] ? `/${done[0]}` : '') : `/${artifacts[0]}`;
    recordCompletedTask({
      planId,
      type: 'generation',
      title: `${what} 생성 완료`,
      href: `/plans/${planId}${targetSubPath}`,
      targetPath: `/plans/${planId}${targetSubPath}`,
    });
    return true;
  }

  // 스트림이 done 없이 끝났다 — 대개 시간 제한이나 연결 문제.
  if (done.length > 0) {
    toast(`${done.length}단계까지 만들고 멈췄습니다. 이어서 만들 수 있습니다.`, 'warn');
  } else {
    // 예전에는 여기서 아무 말 없이 끝나 사용자는 왜 안 됐는지 알 수 없었다.
    toast(`${ARTIFACT_LABEL[artifacts[0]]} 생성을 마치지 못했습니다. 잠시 뒤 다시 시도해 주세요.`, 'danger');
  }
  return done.length > 0;
}
