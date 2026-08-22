'use client';

import type { Plan } from './types';

/**
 * 보기 전용 공유 링크.
 *
 * 서버에 저장소가 없으므로 플랜을 URL 해시에 실어 보낸다.
 * 해시는 서버로 전송되지 않으므로 문서가 서버를 거치지 않는다는 성질이 유지된다.
 */

const PREFIX = '#p=';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 공유에 불필요한 것(대화 기록, 버전 스냅샷)은 빼서 링크를 짧게 만든다. */
export function buildShareLink(plan: Plan): string {
  // 생성 코드는 길어서 URL 한계를 바로 넘는다. 공유 화면에는 기획 산출물만 보낸다.
  const payload: Plan = { ...plan, chat: [], versions: [], uinAiScreens: [] };
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${window.location.origin}/share${PREFIX}${encoded}`;
}

export function readSharedPlan(hash: string): Plan | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const plan = JSON.parse(fromBase64Url(hash.slice(PREFIX.length))) as Plan;
    if (!plan?.brief?.title) return null;
    return plan;
  } catch {
    return null;
  }
}

/** 브라우저마다 URL 길이 한계가 달라 여유 있게 잡는다. */
export const SHARE_LINK_LIMIT = 30000;
