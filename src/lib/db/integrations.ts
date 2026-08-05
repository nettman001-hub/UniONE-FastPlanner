/**
 * 바깥 서비스에 접속할 자격증명 보관.
 *
 * ## 왜 암호화하는가
 *
 * 여기 들어오는 값은 **사용자의 스티치 계정을 그대로 여는 열쇠**다. 비밀번호처럼
 * 해시로 둘 수는 없다 — 실제로 꺼내 써야 하기 때문이다. 그렇다고 평문으로 두면
 * 데이터베이스가 새는 순간 사용자 계정까지 함께 샌다.
 *
 * 그래서 `AUTH_SECRET` 에서 키를 만들어 AES-256-GCM 으로 넣는다. 데이터베이스만
 * 새면 암호문뿐이고, 여는 열쇠는 애플리케이션 환경변수에 따로 있다.
 *
 * ## 절대 브라우저로 내보내지 않는다
 *
 * 이 모듈이 돌려주는 평문은 서버 안에서 스티치를 부를 때만 쓴다. 화면에는
 * `connected` 와 `label`(끝 네 자리 같은 꼬리표)만 보낸다.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getDb } from './index';

export type IntegrationProvider = 'stitch';

/** 화면에 보내도 되는 부분만. */
export interface IntegrationStatus {
  connected: boolean;
  label: string;
  updatedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* 암호화                                                               */
/* ------------------------------------------------------------------ */

/**
 * 저장용 키.
 *
 * `AUTH_SECRET` 을 그대로 쓰지 않고 한 번 더 해싱한다. 세션 서명과 자격증명
 * 암호화가 같은 바이트를 쓰면, 한쪽이 새어도 다른 쪽이 함께 무너진다.
 */
function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // 개발 중에는 서버가 뜨긴 해야 한다. 다만 무엇이 위험한지는 남긴다.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET 이 없어 자격증명을 안전하게 보관할 수 없습니다.');
    }
    return createHash('sha256').update('unione-dev-integration-key').digest();
  }
  return createHash('sha256').update(`integration:${secret}`).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  // iv.tag.본문 — 복호화에 필요한 것을 한 문자열에 담는다.
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function decrypt(stored: string): string | null {
  const parts = stored.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // AUTH_SECRET 이 바뀌었거나 값이 망가졌다. 없는 것으로 본다 — 다시 연결하면 된다.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 읽고 쓰기                                                            */
/* ------------------------------------------------------------------ */

/** 열쇠 자체는 숨기고 어느 것인지만 알아볼 수 있게. */
export function labelFor(secret: string): string {
  const tail = secret.trim().slice(-4);
  return tail ? `••••${tail}` : '연결됨';
}

export async function saveIntegration(
  userId: string,
  provider: IntegrationProvider,
  secret: string,
): Promise<IntegrationStatus> {
  const db = await getDb();
  const label = labelFor(secret);
  await db.query(
    `insert into integrations (user_id, provider, secret, label, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (user_id, provider)
     do update set secret = excluded.secret, label = excluded.label, updated_at = now()`,
    [userId, provider, encrypt(secret), label],
  );
  return { connected: true, label, updatedAt: new Date().toISOString() };
}

/** 서버 안에서 실제로 부를 때만 쓴다. 절대 응답에 담지 않는다. */
export async function readIntegrationSecret(
  userId: string,
  provider: IntegrationProvider,
): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ secret: string }>(
    'select secret from integrations where user_id = $1 and provider = $2',
    [userId, provider],
  );
  if (rows.length === 0) return null;
  return decrypt(rows[0].secret);
}

export async function integrationStatus(
  userId: string,
  provider: IntegrationProvider,
): Promise<IntegrationStatus> {
  const db = await getDb();
  const { rows } = await db.query<{ label: string; updated_at: Date | string }>(
    'select label, updated_at from integrations where user_id = $1 and provider = $2',
    [userId, provider],
  );
  if (rows.length === 0) return { connected: false, label: '', updatedAt: null };
  const at = rows[0].updated_at;
  return {
    connected: true,
    label: rows[0].label,
    updatedAt: at instanceof Date ? at.toISOString() : String(at),
  };
}

export async function removeIntegration(
  userId: string,
  provider: IntegrationProvider,
): Promise<void> {
  const db = await getDb();
  await db.query('delete from integrations where user_id = $1 and provider = $2', [
    userId,
    provider,
  ]);
}
