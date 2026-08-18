/**
 * 계정마다 고른 것들.
 *
 * `users.settings` jsonb 한 칸을 읽고 쓴다. **읽을 때 모르는 값은 기본으로
 * 되돌린다** — 옛 배포가 남긴 키나 손으로 고친 값이 섞여 있어도 생성이 멈추면
 * 안 되기 때문이다. 설정을 못 읽는 것은 문서를 못 만들 이유가 되지 않는다.
 *
 * ## 엔진은 단계마다 따로 고른다
 *
 * 프로덕트 요구사항은 고급으로 촘촘하게 뽑고, 정보구조도는 기본으로 빠르게
 * 넘기고 싶을 수 있다. 하나로 묶어 두면 그때마다 설정을 오가야 한다.
 *
 * 그래서 값을 셋으로 나눈다.
 *
 * | 키 | 무엇 |
 * | --- | --- |
 * | `engines` | 다섯 단계 각각 |
 * | `agentEngine` | AI 에이전트 — 대화·기능 배치·브리프 질문 |
 * | `engine` | **예전 값.** 위 둘이 비어 있을 때의 기본으로만 쓴다 |
 *
 * `engine` 을 계속 쓰는 것은 **예전 계정이 적어 둔 값이 그 자리에 있기
 * 때문이다.** 고급을 쓰던 사람은 이 변경 뒤에도 다섯 단계와 에이전트 모두
 * 고급으로 보인다.
 *
 * 에이전트를 `engine` 에 그대로 두지 않은 이유가 있다. 그러면 에이전트 등급을
 * 바꾸는 것만으로 **아직 단계를 한 번도 안 건드린 계정의 다섯 단계가 함께
 * 끌려간다** — `engines` 가 비어 있어 `engine` 을 따라가기 때문이다. 실제로
 * 그렇게 동작해서 갈라 두었다.
 */

import { getDb } from './index';
import { DEFAULT_ENGINE, isEngineTier, toEngineTier, type EngineTier } from '../ai/engines';
import { ARTIFACT_KEYS, type ArtifactKey } from '../types';

export type EngineMap = Record<ArtifactKey, EngineTier>;

export interface UserSettings {
  /**
   * 예전 값. **아래 둘이 비어 있을 때의 기본으로만 쓴다.**
   *
   * 새로 쓰는 곳은 없다. 지우지 않는 것은 예전 계정이 여기에만 값을 적어 두어서다.
   */
  engine: EngineTier;
  /** 단계마다 고른 등급. 안 고른 단계는 `engine` 을 따른다. */
  engines: EngineMap;
  /** AI 에이전트 — 대화, 기능 배치, 브리프 질문. 없으면 `engine` 을 따른다. */
  agentEngine: EngineTier;
}

export function engineMapOf(engine: EngineTier): EngineMap {
  return Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, engine])) as EngineMap;
}

export const DEFAULT_SETTINGS: UserSettings = {
  engine: DEFAULT_ENGINE,
  engines: engineMapOf(DEFAULT_ENGINE),
  agentEngine: DEFAULT_ENGINE,
};

function parse(raw: unknown): UserSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const engine = toEngineTier(value.engine);
  const saved = (value.engines ?? {}) as Record<string, unknown>;
  /*
   * 모르는 값은 **단계 하나만** 기본으로 되돌린다. 통째로 버리면 네 단계를
   * 멀쩡히 골라 둔 사람이 한 칸 깨진 것 때문에 전부 잃는다.
   */
  const engines = Object.fromEntries(
    ARTIFACT_KEYS.map((key) => [key, isEngineTier(saved[key]) ? saved[key] : engine]),
  ) as EngineMap;
  const agentEngine = isEngineTier(value.agentEngine) ? value.agentEngine : engine;
  return { engine, engines, agentEngine };
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
    return {
      engine: DEFAULT_ENGINE,
      engines: engineMapOf(DEFAULT_ENGINE),
      agentEngine: DEFAULT_ENGINE,
    };
  }
}

export interface SettingsPatch {
  engine?: EngineTier;
  /** 준 단계만 바꾼다. 안 준 단계는 그대로 둔다. */
  engines?: Partial<EngineMap>;
  agentEngine?: EngineTier;
}

/**
 * 준 것만 바꾼다. 나머지 키는 건드리지 않는다.
 *
 * `engines` 는 **칸 안에서 다시 합친다.** 통째로 덮으면 프로덕트 요구사항 하나를
 * 바꾸는 요청이 나머지 네 단계를 지운다. 화면은 누른 단계 하나만 보내므로
 * 이걸 서버가 안 지키면 다른 단계가 소리 없이 기본으로 돌아간다.
 */
export async function writeSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const db = await getDb();
  const top = {
    ...(patch.engine === undefined ? {} : { engine: patch.engine }),
    ...(patch.agentEngine === undefined ? {} : { agentEngine: patch.agentEngine }),
  };
  const steps = patch.engines ?? {};
  const { rows } = await db.query<{ settings: unknown }>(
    `update users
        set settings = jsonb_set(
              coalesce(settings, '{}'::jsonb) || $2::jsonb,
              '{engines}',
              coalesce(settings -> 'engines', '{}'::jsonb) || $3::jsonb,
              true)
      where id = $1
      returning settings`,
    [userId, JSON.stringify(top), JSON.stringify(steps)],
  );
  return parse(rows[0]?.settings);
}

/** AI 에이전트(대화·기능 배치·브리프 질문)가 쓸 등급. */
export async function userAgentEngine(userId: string | undefined): Promise<EngineTier> {
  if (!userId) return DEFAULT_ENGINE;
  return (await readSettings(userId)).agentEngine;
}

/** 생성 경로에서 쓰는 단계별 등급. */
export async function userEngines(userId: string | undefined): Promise<EngineMap> {
  if (!userId) return engineMapOf(DEFAULT_ENGINE);
  return (await readSettings(userId)).engines;
}
