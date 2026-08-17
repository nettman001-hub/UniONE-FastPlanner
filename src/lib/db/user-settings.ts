/**
 * 계정마다 고른 것들.
 *
 * `users.settings` jsonb 한 칸을 읽고 쓴다. **읽을 때 모르는 값은 기본으로
 * 되돌린다** — 옛 배포가 남긴 키나 손으로 고친 값이 섞여 있어도 생성이 멈추면
 * 안 되기 때문이다. 설정을 못 읽는 것은 문서를 못 만들 이유가 되지 않는다.
 */

import { getDb } from './index';
import { DEFAULT_ENGINE, toEngineTier, type EngineTier } from '../ai/engines';

export interface UserSettings {
  /** 만들기 엔진 — 기본 / 고급 */
  engine: EngineTier;
}

export const DEFAULT_SETTINGS: UserSettings = {
  engine: DEFAULT_ENGINE,
};

function parse(raw: unknown): UserSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  return { engine: toEngineTier(value.engine) };
}

/**
 * 어떤 이유로든 못 읽으면 기본값으로 본다.
 *
 * 여기서 던지면 생성 요청 전체가 죽는다. 고른 것을 못 읽어 기본으로 만드는 편이,
 * 아무것도 못 만드는 것보다 낫다.
 */
export async function readSettings(userId: string): Promise<UserSettings> {
  try {
    const db = await getDb();
    const { rows } = await db.query<{ settings: unknown }>(
      'select settings from users where id = $1',
      [userId],
    );
    return parse(rows[0]?.settings);
  } catch (error) {
    console.error('[settings] 설정을 읽지 못했습니다:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/** 준 것만 바꾼다. 나머지 키는 건드리지 않는다. */
export async function writeSettings(
  userId: string,
  patch: Partial<UserSettings>,
): Promise<UserSettings> {
  const db = await getDb();
  const { rows } = await db.query<{ settings: unknown }>(
    `update users set settings = coalesce(settings, '{}'::jsonb) || $2::jsonb
      where id = $1
      returning settings`,
    [userId, JSON.stringify(patch)],
  );
  return parse(rows[0]?.settings);
}

/** 생성 경로에서 자주 부르는 것이라 한 줄로 둔다. */
export async function userEngine(userId: string | undefined): Promise<EngineTier> {
  if (!userId) return DEFAULT_ENGINE;
  return (await readSettings(userId)).engine;
}
