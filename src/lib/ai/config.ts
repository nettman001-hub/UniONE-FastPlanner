/**
 * 관리자가 화면에서 고치는 AI 설정.
 *
 * ## 왜 필요한가
 *
 * 공급자·모델·엔드포인트를 바꾸려면 지금까지는 **환경변수를 고치고 다시
 * 배포해야** 했다. 모델 이름 하나 바꾸는 데 배포가 한 번 도는 셈이고, 배포 권한이
 * 없는 사람은 아예 손을 못 댄다.
 *
 * ## 규칙
 *
 * **빈 칸은 "정하지 않음" 이다.** 그 자리는 환경변수를 쓰고, 환경변수도 없으면
 * 코드의 기본값을 쓴다. 지우면 예전 동작으로 정확히 돌아간다.
 *
 *     화면에 적은 값  >  환경변수  >  코드 기본값
 *
 * ## API 키
 *
 * 키도 화면에서 넣는다. 다만 **이 타입에는 키가 없다.** 이 타입은 브라우저로
 * 그대로 내려가므로, 여기에 담으면 관리자 화면을 여는 것만으로 키가 새어 나간다.
 * 꼬리표(`••••7890`)와 있는지 여부만 담고, 키 자체는 잠가서 따로 둔다
 * (`db/ai-config.ts` 의 `readAiKey`).
 *
 * 화면에서 넣지 않으면 환경변수의 키를 그대로 쓴다.
 */

import { ENGINE_TIERS, type EngineTier } from './engines';

export type ProviderChoice = 'deepseek' | 'anthropic' | 'local';

/**
 * 추론 강도로 고를 수 있는 값.
 *
 * `''` 는 **자동** — 위에서부터 시도하다 거부당하면 한 칸 내려온다.
 * `off` 는 아예 안 보낸다. 나머지는 그 값으로 못 박는다.
 */
export const EFFORT_CHOICES = ['', 'max', 'xhigh', 'high', 'medium', 'low', 'off'] as const;
export type EffortChoice = (typeof EFFORT_CHOICES)[number];

export const EFFORT_LABEL: Record<EffortChoice, string> = {
  '': '자동 (되는 만큼 가장 높게)',
  max: 'max 로 못 박기',
  xhigh: 'xhigh 로 못 박기',
  high: 'high 로 못 박기',
  medium: 'medium 으로 못 박기',
  low: 'low 로 못 박기',
  off: '보내지 않기',
};

export interface AiConfig {
  /** 빈 문자열이면 환경변수를 따른다. */
  provider: ProviderChoice | '';
  /** OpenAI 호환 엔드포인트. 빈 문자열이면 환경변수를 따른다. */
  baseUrl: string;
  /** 등급마다 부를 모델. 빈 문자열이면 환경변수를 따른다. */
  models: Record<EngineTier, string>;
  effort: EffortChoice;
  /** 요청당 출력 토큰 상한. 0 이면 환경변수를 따른다. */
  maxOutputTokens: number;
  /**
   * API 키의 **꼬리표**(`••••7890`). 키 자체가 아니다.
   *
   * 이 타입은 브라우저로 그대로 내려간다. 키를 여기에 두면 관리자 화면을 여는
   * 것만으로 키가 새어 나간다. 키는 서버에서 따로 읽는다(`readAiKey`).
   */
  apiKeyLabel: string;
  hasApiKey: boolean;
}

export const EMPTY_AI_CONFIG: AiConfig = {
  provider: '',
  baseUrl: '',
  models: { basic: '', advanced: '' },
  effort: '',
  maxOutputTokens: 0,
  apiKeyLabel: '',
  hasApiKey: false,
};

/** 모델 이름·주소가 아무리 길어도 이 이상은 실수다. */
const MAX_TEXT = 200;
/**
 * 출력 상한으로 받아 줄 범위.
 *
 * 위쪽을 넓게 잡는다. **진짜 상한은 공급자가 정하는 것**이고 그 값은 모델마다
 * 다르다(DeepSeek 은 386,000 이다). 여기서 좁게 잡아 두면 관리자가 자기 공급자의
 * 실제 상한을 못 넣는다 — 처음 200,000 으로 잡았다가 바로 그 일이 났다.
 *
 * 아래쪽만 지킨다. 너무 작으면 매 호출이 중간에 잘려 문서가 조각난다.
 */
export const MIN_OUTPUT_TOKENS = 256;
export const MAX_OUTPUT_TOKENS = 1_000_000;

/**
 * 현재 서비스의 DeepSeek 출력 상한.
 *
 * 운영 모델이 지원하는 384K를 모든 AI 생성 경로에서 동일하게 요청한다. 관리자
 * 설정·환경변수의 과거 값은 DeepSeek 실행 시 이 값을 낮출 수 없다.
 */
export const DEEPSEEK_OUTPUT_TOKENS = 384_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

/**
 * 저장된 값을 읽을 때 쓴다. **모르는 값은 빈 칸으로 되돌린다.**
 *
 * 손으로 고쳤거나 옛 배포가 남긴 값이 섞여 있어도 생성이 멈추면 안 된다.
 * 빈 칸이면 환경변수로 돌아가므로, 최악의 경우에도 예전 동작이다.
 */
export function parseAiConfig(raw: unknown): AiConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const provider = text(value.provider);
  const effort = text(value.effort);
  const models = (value.models ?? {}) as Record<string, unknown>;
  const limit = Number(value.maxOutputTokens);

  return {
    provider:
      provider === 'deepseek' || provider === 'anthropic' || provider === 'local' ? provider : '',
    baseUrl: text(value.baseUrl),
    models: Object.fromEntries(
      ENGINE_TIERS.map((tier) => [tier, text(models[tier])]),
    ) as Record<EngineTier, string>,
    effort: (EFFORT_CHOICES as readonly string[]).includes(effort) ? (effort as EffortChoice) : '',
    maxOutputTokens:
      Number.isFinite(limit) && limit >= MIN_OUTPUT_TOKENS && limit <= MAX_OUTPUT_TOKENS
        ? Math.floor(limit)
        : 0,
    // 꼬리표는 저장된 것을 그대로 읽는다. 키 자체는 여기로 오지 않는다.
    apiKeyLabel: text(value.apiKeyLabel),
    hasApiKey: Boolean(value.apiKeyEnc),
  };
}

/**
 * 저장하기 전에 본다. **읽을 때와 달리 조용히 고치지 않는다.**
 *
 * 적어 넣은 값이 말없이 버려지면 저장이 된 줄 알고 나간다. 무엇이 잘못됐는지
 * 그 자리에서 알려 주어야 고칠 수 있다.
 */
export function aiConfigProblem(input: unknown): string | null {
  const value = (input ?? {}) as Record<string, unknown>;

  const provider = text(value.provider);
  if (provider && !['deepseek', 'anthropic', 'local'].includes(provider)) {
    return '없는 공급자입니다.';
  }

  const baseUrl = text(value.baseUrl);
  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return '엔드포인트 주소가 올바르지 않습니다. https:// 로 시작하는 전체 주소를 적어 주세요.';
    }
    // 다른 스킴(file:, data: 같은 것)으로 서버가 무엇을 부르게 만들면 안 된다.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '엔드포인트는 http:// 또는 https:// 여야 합니다.';
    }
  }

  const effort = text(value.effort);
  if (effort && !(EFFORT_CHOICES as readonly string[]).includes(effort)) {
    return '없는 추론 강도입니다.';
  }

  const limit = value.maxOutputTokens;
  if (limit !== undefined && limit !== null && limit !== '' && Number(limit) !== 0) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < MIN_OUTPUT_TOKENS || n > MAX_OUTPUT_TOKENS) {
      return `출력 상한은 ${MIN_OUTPUT_TOKENS.toLocaleString()} 에서 ${MAX_OUTPUT_TOKENS.toLocaleString()} 사이로 적어 주세요. 비우면 환경변수를 따릅니다.`;
    }
  }

  return null;
}
