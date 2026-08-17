'use client';

/**
 * 지금 계정이 고른 만들기 등급.
 *
 * ## 왜 따로 두나
 *
 * **값을 보여 주는 곳마다 등급이 필요하다.** 고급 엔진은 크레딧이 두 배라,
 * 등급을 모르면 화면이 `3 크레딧` 이라고 적어 놓고 실제로는 6 이 나간다.
 * 그런 어긋남은 사용자가 사용 내역을 보고 나서야 발견한다.
 *
 * 화면마다 따로 불러오면 같은 질의가 여러 번 나가고, 한 화면에서 바꾼 것이 다른
 * 화면에 안 비친다. 그래서 `useCredits` 와 같은 모양으로 **모듈에 하나만** 둔다.
 */

import { useSyncExternalStore } from 'react';

import { DEFAULT_ENGINE, toEngineTier, type EngineTier } from './ai/engines';

let current: EngineTier = DEFAULT_ENGINE;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // 처음 쓰는 화면이 뜰 때 한 번만 불러온다.
  if (!loaded) {
    loaded = true;
    void refreshEngine();
  }
  return () => listeners.delete(fn);
}

/**
 * 서버에서 다시 읽는다.
 *
 * 못 읽으면 **가만히 둔다.** 여기서 실패했다고 기본값으로 되돌리면, 고급을 쓰던
 * 사람에게 잠깐 낮은 값이 보였다가 바뀐다 — 그 깜빡임이 더 헷갈린다.
 */
export async function refreshEngine(): Promise<void> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { settings?: { engine?: unknown } };
    const next = toEngineTier(body.settings?.engine);
    if (next === current) return;
    current = next;
    emit();
  } catch {
    /* 그대로 둔다 */
  }
}

/** 설정 화면에서 바꾼 직후, 다시 불러오기를 기다리지 않고 바로 반영한다. */
export function setEngineLocally(next: EngineTier): void {
  if (next === current) return;
  current = next;
  emit();
}

/** 로그아웃하면 다음 사람이 앞사람의 등급을 보면 안 된다. */
export function resetEngine(): void {
  current = DEFAULT_ENGINE;
  loaded = false;
  emit();
}

function snapshot(): EngineTier {
  return current;
}

/** 훅 밖(생성을 거는 자리)에서 지금 값만 필요할 때. */
export function engineSnapshot(): EngineTier {
  return current;
}

export function useEngine(): EngineTier {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_ENGINE);
}
