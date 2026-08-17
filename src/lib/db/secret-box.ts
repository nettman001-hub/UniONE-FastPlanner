/**
 * 비밀값을 데이터베이스에 넣기 전에 잠그는 자물쇠.
 *
 * 스티치 자격증명과 AI API 키가 같이 쓴다. 원래 `integrations.ts` 안에만 있던
 * 것을 꺼냈다 — 두 벌로 두면 한쪽만 고쳐질 수 있고, 그런 어긋남은 조용히 지나간다.
 *
 * **데이터베이스가 통째로 새도 이 값들은 그대로 새지 않는다**는 것이 요점이다.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 저장용 키.
 *
 * `AUTH_SECRET` 을 그대로 쓰지 않고 한 번 더 해싱한다. 세션 서명과 비밀값
 * 암호화가 같은 바이트를 쓰면, 한쪽이 새어도 다른 쪽이 함께 무너진다.
 */
function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // 개발 중에는 서버가 뜨긴 해야 한다. 다만 무엇이 위험한지는 남긴다.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET 이 없어 비밀값을 안전하게 보관할 수 없습니다.');
    }
    return createHash('sha256').update('unione-dev-integration-key').digest();
  }
  return createHash('sha256').update(`integration:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  // iv.tag.본문 — 복호화에 필요한 것을 한 문자열에 담는다.
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string): string | null {
  const parts = stored.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // AUTH_SECRET 이 바뀌었거나 값이 망가졌다. 없는 것으로 본다 — 다시 넣으면 된다.
    return null;
  }
}

/** 열쇠 자체는 숨기고 **어느 것인지만** 알아볼 수 있게. */
export function labelFor(secret: string): string {
  const tail = secret.trim().slice(-4);
  return tail ? `••••${tail}` : '설정됨';
}
