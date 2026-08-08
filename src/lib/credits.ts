/**
 * 크레딧 — **셈은 서버가 한다.**
 *
 * ## 왜 옮겼나
 *
 * 예전에는 브라우저(localStorage)에 잔량이 있었다. 두 가지가 문제였다.
 *
 * 1. **개발자도구로 고칠 수 있었다.** 지금은 무료라 손해가 없지만, 요금제를
 *    붙이는 순간 구멍이다.
 * 2. **`chat` 과 `place` 는 서버에서 아예 안 깎았다.** 브라우저가 안 깎으면
 *    그만이라, 사실상 무제한이었다.
 *
 * 게다가 잔량이 서버에 없으니 관리자가 조정할 대상 자체가 없었다.
 *
 * ## 어떻게 세나
 *
 * **쓴 것을 적어 두고 빼서 센다**(`credit_usage`). 잔량 하나만 들고 있는 것보다
 * 나은 점이 있다 — 무엇에 얼마를 썼는지가 그대로 남아서, 사용 내역을 따로 만들
 * 필요가 없다.
 */

import { ARTIFACT_CREDIT_COST, ARTIFACT_LABEL, type ArtifactKey } from './types';

/**
 * 일일 무료 크레딧.
 *
 * 임시로 넉넉하게 열어 둔 값이다. 정식 요금제를 붙일 때 계정별 한도로 바꾼다.
 * 화면에는 "(임시)" 표기를 함께 노출한다.
 */
export const DAILY_CREDIT_LIMIT = 200;

/** 무엇에 썼는지. 산출물 다섯 가지 + 에이전트 + 기능 배치. */
export type CreditKind = ArtifactKey | 'chat' | 'place';

export const CREDIT_KIND_LABEL: Record<CreditKind, string> = {
  ...ARTIFACT_LABEL,
  chat: 'AI 에이전트',
  place: '기능 배치',
};

export function creditKindLabel(kind: string): string {
  return CREDIT_KIND_LABEL[kind as CreditKind] ?? kind;
}

export function costOfArtifact(artifact: ArtifactKey): number {
  return ARTIFACT_CREDIT_COST[artifact];
}

/**
 * 하루의 경계.
 *
 * **한국 시각으로 가른다.** 서버는 UTC 로 도는데 그대로 쓰면 우리 시각 아침
 * 아홉 시에 크레딧이 채워진다 — 사용자에게는 하루가 엉뚱한 데서 끊긴다.
 */
export function dayKey(at: Date = new Date()): string {
  const kst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 그 날이 시작된 순간(UTC). 질의에서 이것보다 뒤에 쓴 것만 센다. */
export function dayStart(key: string): Date {
  return new Date(`${key}T00:00:00+09:00`);
}

export interface CreditState {
  /** 오늘 남은 것 */
  remaining: number;
  /** 오늘 쓴 것 */
  used: number;
  limit: number;
}

export interface CreditEntry {
  kind: string;
  amount: number;
  at: string;
}
