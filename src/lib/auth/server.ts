/** 서버에서 "지금 누가 요청했나" 를 판단하는 곳. */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, cookieOptions, signSession, verifySession } from './session';
import type { PublicUser } from '../db/users';

/**
 * 쿠키의 세션을 확인한다.
 *
 * DB 를 보지 않는다 — 서명과 만료만으로 판단한다. 플랜 질의가 전부 `user_id` 로
 * 걸러지므로, 지워진 계정의 토큰이 남아 있어도 볼 수 있는 것이 없다.
 */
export async function currentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return { id: payload.uid, email: payload.email, name: payload.name };
}

/** 로그인하지 않았으면 401 을 돌려준다. 라우트에서 한 줄로 쓰기 위한 헬퍼. */
export async function requireUser(): Promise<
  { user: PublicUser; response: null } | { user: null; response: NextResponse }
> {
  const user = await currentUser();
  if (user) return { user, response: null };
  return {
    user: null,
    response: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }),
  };
}

export async function startSession(user: PublicUser): Promise<void> {
  const token = await signSession({ uid: user.id, email: user.email, name: user.name });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { ...cookieOptions(0), maxAge: 0 });
}

/* 로그인 시도 제한 ---------------------------------------------------- */

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * 같은 이메일로 반복해서 틀리면 잠시 막는다.
 *
 * 인스턴스 메모리에만 남으므로 서버리스에서는 완전한 방어가 아니다. 무차별 대입을
 * 어렵게 만드는 정도로 본다 — 제대로 막으려면 DB 나 Redis 로 옮겨야 한다.
 */
export function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function noteFailedAttempt(key: string): void {
  const entry = attempts.get(key);
  if (!entry || Date.now() > entry.until) {
    attempts.set(key, { count: 1, until: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
