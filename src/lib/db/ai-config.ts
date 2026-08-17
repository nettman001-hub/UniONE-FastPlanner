/**
 * 관리자가 고친 AI 설정을 읽고 쓴다.
 *
 * **캐시하지 않는다.** 서버리스는 인스턴스가 여러 개라 캐시를 두면 인스턴스마다
 * 다른 설정으로 도는 시간이 생긴다. 고친 사람은 바로 반영됐다고 믿는데 실제로는
 * 절반만 바뀌어 있으면, 무엇이 도는지 아무도 설명할 수 없게 된다.
 *
 * 생성은 어차피 몇 십 초 걸리는 일이라, 줄 하나 읽는 값은 셈에 들지 않는다.
 */

import { getDb } from './index';
import { EMPTY_AI_CONFIG, parseAiConfig, type AiConfig } from '../ai/config';

/**
 * 어떤 이유로든 못 읽으면 **빈 설정으로 본다.**
 *
 * 빈 설정은 환경변수를 따른다는 뜻이라, 최악의 경우에도 이 기능이 생기기 전과
 * 똑같이 동작한다. 설정을 못 읽는 것이 문서를 못 만들 이유가 되면 안 된다.
 */
export async function readAiConfig(): Promise<AiConfig> {
  try {
    const db = await getDb();
    const { rows } = await db.query<{ data: unknown }>('select data from app_settings limit 1');
    return parseAiConfig((rows[0]?.data as { ai?: unknown } | undefined)?.ai);
  } catch (error) {
    console.error('[ai-config] 설정을 읽지 못했습니다:', error);
    return { ...EMPTY_AI_CONFIG, models: { ...EMPTY_AI_CONFIG.models } };
  }
}

export interface AiConfigRecord {
  config: AiConfig;
  updatedAt: string | null;
  updatedBy: string;
}

/** 화면에 "언제 누가 고쳤는지" 를 함께 보여 주려고 따로 둔다. */
export async function readAiConfigRecord(): Promise<AiConfigRecord> {
  try {
    const db = await getDb();
    const { rows } = await db.query<{ data: unknown; updated_at: string; updated_by: string }>(
      'select data, updated_at, updated_by from app_settings limit 1',
    );
    const row = rows[0];
    return {
      config: parseAiConfig((row?.data as { ai?: unknown } | undefined)?.ai),
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? '',
    };
  } catch (error) {
    console.error('[ai-config] 설정을 읽지 못했습니다:', error);
    return {
      config: { ...EMPTY_AI_CONFIG, models: { ...EMPTY_AI_CONFIG.models } },
      updatedAt: null,
      updatedBy: '',
    };
  }
}

/**
 * 저장한다. 줄이 없으면 만들고, 있으면 `ai` 자리만 갈아 끼운다.
 *
 * 여기서 나는 오류는 **삼키지 않는다.** 저장이 안 됐는데 됐다고 하면 화면과
 * 실제가 갈라진다.
 */
export async function writeAiConfig(config: AiConfig, by: string): Promise<AiConfig> {
  const db = await getDb();
  const { rows } = await db.query<{ data: unknown }>(
    `insert into app_settings (only_row, data, updated_at, updated_by)
     values (true, jsonb_build_object('ai', $1::jsonb), now(), $2)
     on conflict (only_row)
     do update set data = coalesce(app_settings.data, '{}'::jsonb) || jsonb_build_object('ai', $1::jsonb),
                   updated_at = now(),
                   updated_by = $2
     returning data`,
    [JSON.stringify(config), by],
  );
  return parseAiConfig((rows[0]?.data as { ai?: unknown } | undefined)?.ai);
}
