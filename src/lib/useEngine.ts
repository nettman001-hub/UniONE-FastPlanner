'use client';

/**
 * 지금 계정이 고른 만들기 등급 — **단계마다 하나씩.**
 *
 * ## 왜 따로 두나
 *
 * **값을 보여 주는 곳마다 등급이 필요하다.** 고급 엔진은 크레딧이 두 배라,
 * 등급을 모르면 화면이 `3 크레딧` 이라고 적어 놓고 실제로는 6 이 나간다.
 * 그런 어긋남은 사용자가 사용 내역을 보고 나서야 발견한다.
 *
 * 화면마다 따로 불러오면 같은 질의가 여러 번 나가고, 한 화면에서 바꾼 것이 다른
 * 화면에 안 비친다. 그래서 `useCredits` 와 같은 모양으로 **모듈에 하나만** 둔다.
 *
 * ## 왜 단계마다인가
 *
 * 프로덕트 요구사항은 촘촘하게 뽑고 정보구조도는 빠르게 넘기고 싶을 수 있다.
 * 하나로 묶어 두면 단계를 옮길 때마다 설정을 오가야 한다.
 *
 * AI 에이전트는 단계가 아니라 따로 둔다(`agentEngine`) — 대화는 다섯 산출물을
 * 넘나들며 고치므로 어느 단계에 매달 수가 없다.
 */

import { useSyncExternalStore } from 'react';

import { DEFAULT_ENGINE, isEngineTier, toEngineTier, type EngineTier } from './ai/engines';
import { ARTIFACT_KEYS, type ArtifactKey } from './types';

export type EngineMap = Record<ArtifactKey, EngineTier>;

function mapOf(engine: EngineTier): EngineMap {
  return Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, engine])) as EngineMap;
}

const FALLBACK: EngineMap = mapOf(DEFAULT_ENGINE);

let engine: EngineTier = DEFAULT_ENGINE;
let engines: EngineMap = FALLBACK;
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
    const body = (await res.json()) as {
      settings?: { engine?: unknown; engines?: unknown; agentEngine?: unknown };
    };
    /*
     * `engine` 은 **예전 값**이라 단계와 에이전트가 비어 있을 때의 기본으로만
     * 쓴다. 에이전트 값을 여기에 두면 에이전트를 바꾸는 것만으로 아직 안 건드린
     * 단계들이 함께 끌려간다.
     */
    const legacy = toEngineTier(body.settings?.engine);
    const nextEngine = isEngineTier(body.settings?.agentEngine)
      ? body.settings.agentEngine
      : legacy;
    const saved = (body.settings?.engines ?? {}) as Record<string, unknown>;
    const nextEngines = Object.fromEntries(
      ARTIFACT_KEYS.map((key) => [key, isEngineTier(saved[key]) ? saved[key] : legacy]),
    ) as EngineMap;

    if (nextEngine === engine && sameMap(nextEngines, engines)) return;
    engine = nextEngine;
    engines = nextEngines;
    emit();
  } catch {
    /* 그대로 둔다 */
  }
}

function sameMap(a: EngineMap, b: EngineMap): boolean {
  return ARTIFACT_KEYS.every((key) => a[key] === b[key]);
}

/**
 * 한 단계만 바꿔 둔다 — 저장이 돌아오기 전에 화면이 먼저 따라오게.
 *
 * **새 객체를 만든다.** 제자리에서 고치면 `useSyncExternalStore` 가 같은 참조를
 * 보고 다시 그리지 않는다.
 */
export function setEngineFor(artifact: ArtifactKey, next: EngineTier): void {
  if (engines[artifact] === next) return;
  engines = { ...engines, [artifact]: next };
  emit();
}

/** 다섯 단계를 한꺼번에. 설정 화면과 머리글 버튼이 쓴다. */
export function setEnginesLocally(next: EngineMap | EngineTier): void {
  const map = typeof next === 'string' ? mapOf(next) : next;
  if (sameMap(map, engines)) return;
  engines = map;
  emit();
}

/** AI 에이전트 등급. */
export function setEngineLocally(next: EngineTier): void {
  if (next === engine) return;
  engine = next;
  emit();
}

/** 로그아웃하면 다음 사람이 앞사람의 등급을 보면 안 된다. */
export function resetEngine(): void {
  engine = DEFAULT_ENGINE;
  engines = FALLBACK;
  loaded = false;
  emit();
}

function snapshotEngines(): EngineMap {
  return engines;
}

function snapshotEngine(): EngineTier {
  return engine;
}

/** 훅 밖(생성을 거는 자리)에서 지금 값만 필요할 때. */
export function engineSnapshotFor(artifact: ArtifactKey): EngineTier {
  return engines[artifact];
}

/** AI 에이전트 등급 — 에이전트를 거는 자리에서 쓴다. */
export function engineSnapshot(): EngineTier {
  return engine;
}

export function useEngines(): EngineMap {
  return useSyncExternalStore(subscribe, snapshotEngines, () => FALLBACK);
}

/** 이 단계의 등급 하나만 필요할 때. */
export function useEngineFor(artifact: ArtifactKey): EngineTier {
  return useEngines()[artifact];
}

/** AI 에이전트 등급. */
export function useEngine(): EngineTier {
  return useSyncExternalStore(subscribe, snapshotEngine, () => DEFAULT_ENGINE);
}
