'use client';

/**
 * 크레딧 잔량 — **서버가 준 숫자를 그대로 보여 준다.**
 *
 * 여기서 세지 않는다. 예전에는 브라우저가 세고 저장까지 했는데, 개발자도구로
 * 고칠 수 있었고 무엇보다 서버가 그 값을 믿지 않으므로 **화면의 숫자와 실제가
 * 어긋났다.** 지금은 서버가 유일한 근거고 여기서는 물어보기만 한다.
 *
 * 스토어가 아니라 모듈에 두는 이유는 머리글·설정·플랜 화면이 **같은 숫자**를
 * 봐야 하기 때문이다. 한 군데서 쓰면 나머지도 함께 바뀐다.
 */

import { useSyncExternalStore } from 'react';

import { DAILY_CREDIT_LIMIT, type CreditState } from './credits';

interface Snapshot extends CreditState {
  /** 아직 물어보기 전인가. 화면에서 "0" 으로 오해하지 않게 구분한다. */
  loaded: boolean;
}

const INITIAL: Snapshot = {
  remaining: DAILY_CREDIT_LIMIT,
  used: 0,
  limit: DAILY_CREDIT_LIMIT,
  loaded: false,
};

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
/** 같은 요청이 겹쳐 나가지 않게. 생성이 끝날 때마다 부르기 때문이다. */
let inFlight: Promise<void> | null = null;

function publish(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function read(): Snapshot {
  return snapshot;
}

function serverRead(): Snapshot {
  return INITIAL;
}

/**
 * 서버에 다시 물어본다.
 *
 * 못 물어봐도 **조용히 넘어간다.** 잔량을 못 읽었다고 화면에 경고를 띄우면,
 * 정작 중요한 일(문서를 만드는 것)과 상관없는 소음이 된다. 서버가 어차피
 * 부족하면 막는다.
 */
export async function refreshCredits(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch('/api/credits', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<CreditState>;
      publish({
        remaining: Number(data.remaining ?? DAILY_CREDIT_LIMIT),
        used: Number(data.used ?? 0),
        limit: Number(data.limit ?? DAILY_CREDIT_LIMIT),
        loaded: true,
      });
    } catch {
      /* 네트워크가 잠깐 끊긴 것일 수 있다. 다음에 다시 묻는다. */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** 로그아웃하면 남의 숫자를 보여 주지 않도록 비운다. */
export function resetCredits(): void {
  publish(INITIAL);
}

/** 훅 밖에서 지금 숫자를 볼 때. 화면이 아닌 곳(러너)에서 쓴다. */
export function creditSnapshot(): Snapshot {
  return snapshot;
}

export function useCredits(): Snapshot {
  return useSyncExternalStore(subscribe, read, serverRead);
}
