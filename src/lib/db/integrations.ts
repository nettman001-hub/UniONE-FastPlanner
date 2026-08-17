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
 * 잠그고 푸는 일 자체는 `secret-box.ts` 가 한다 — AI API 키도 같은 자물쇠를 쓴다.
 * 두 벌로 두면 한쪽만 고쳐질 수 있고, 그런 어긋남은 조용히 지나간다.
 *
 * ## 절대 브라우저로 내보내지 않는다
 *
 * 이 모듈이 돌려주는 평문은 서버 안에서 스티치를 부를 때만 쓴다. 화면에는
 * `connected` 와 `label`(끝 네 자리 같은 꼬리표)만 보낸다.
 */

import { getDb } from './index';
import { decryptSecret, encryptSecret, labelFor } from './secret-box';

export type IntegrationProvider = 'stitch';

/** 화면에 보내도 되는 부분만. */
export interface IntegrationStatus {
  connected: boolean;
  label: string;
  updatedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* 읽고 쓰기                                                            */
/* ------------------------------------------------------------------ */

export async function saveIntegration(
  userId: string,
  provider: IntegrationProvider,
  secret: string,
  kind = '',
): Promise<IntegrationStatus> {
  const db = await getDb();
  const label = labelFor(secret);
  await db.query(
    `insert into integrations (user_id, provider, secret, label, kind, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id, provider)
     do update set secret = excluded.secret, label = excluded.label,
                   kind = excluded.kind, updated_at = now()`,
    [userId, provider, encryptSecret(secret), label, kind],
  );
  return { connected: true, label, updatedAt: new Date().toISOString() };
}

/**
 * 서버 안에서 실제로 부를 때만 쓴다. 절대 응답에 담지 않는다.
 *
 * `kind` 는 연결할 때 실제로 찔러 보고 알아낸 값이다 — 비어 있으면 그 확인을
 * 거치기 전에 저장된 것이므로, 부르는 쪽이 다시 알아내야 한다.
 */
export async function readIntegrationSecret(
  userId: string,
  provider: IntegrationProvider,
): Promise<{ secret: string; kind: string } | null> {
  const db = await getDb();
  const { rows } = await db.query<{ secret: string; kind: string | null }>(
    'select secret, kind from integrations where user_id = $1 and provider = $2',
    [userId, provider],
  );
  if (rows.length === 0) return null;
  const secret = decryptSecret(rows[0].secret);
  if (!secret) return null;
  return { secret, kind: rows[0].kind ?? '' };
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
