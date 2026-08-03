/**
 * 세션 토큰.
 *
 * 서버에 세션 표를 두지 않고 서명한 값을 쿠키에 담는다. 서버리스에서는 인스턴스가
 * 매번 달라지므로 "어느 인스턴스가 기억하고 있나" 를 따질 수 없기 때문이다.
 * 서명만 맞으면 어느 인스턴스가 받아도 같은 결론을 낸다.
 *
 * Web Crypto 만 쓴다 — Node 런타임과 Edge(미들웨어) 양쪽에서 그대로 돈다.
 */

export const SESSION_COOKIE = 'fp_session';

/** 30일. 다시 로그인하라고 자주 묻지 않을 만큼 길고, 영원하지는 않은 값. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  /** 만료 시각 (초). */
  exp: number;
}

/** 개발 편의를 위한 값. 배포에서는 절대 쓰이지 않는다 (아래에서 막는다). */
const DEV_SECRET = 'unione-fastplaner-development-only-secret';

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === 'production') {
    // 여기서 개발용 기본값으로 넘어가면 누구나 세션을 위조할 수 있다.
    throw new Error(
      'AUTH_SECRET 환경변수가 없습니다. 16자 이상의 임의 문자열을 설정해야 로그인이 동작합니다.',
    );
  }
  return DEV_SECRET;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  // Uint8Array.from 은 SharedArrayBuffer 를 품을 수 있는 타입이라 crypto.subtle 이 받지 않는다.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(
  payload: Omit<SessionPayload, 'exp'>,
  maxAge = SESSION_MAX_AGE,
): Promise<string> {
  const body: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + maxAge };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(),
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

/** 서명과 만료를 모두 확인한다. 조금이라도 어긋나면 null — 부분 신뢰는 없다. */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(),
      fromBase64Url(signature),
      new TextEncoder().encode(encoded),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (typeof payload.uid !== 'string' || !payload.uid) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 쿠키에 담을 때 쓰는 공통 옵션. */
export function cookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
