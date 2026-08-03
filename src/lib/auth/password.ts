/**
 * 비밀번호 해시.
 *
 * Node 표준 라이브러리의 scrypt 만 쓴다 — 외부 의존성 없이 충분히 강하다.
 * 저장 형식: `scrypt$N$r$p$소금(base64)$해시(base64)`
 * 파라미터를 문자열에 함께 담아 두면 나중에 세기를 올려도 옛 해시를 계속 검증할 수 있다.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

/** 입력 정규화 — 한글 자모 조합이 달라도 같은 비밀번호로 보이게 한다. */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(normalize(password), salt, KEY_LENGTH, COST);
  return [
    'scrypt',
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scryptAsync(normalize(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  // 길이가 같을 때만 비교한다 — timingSafeEqual 은 길이가 다르면 던진다.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
