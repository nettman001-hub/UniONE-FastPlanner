/**
 * 생성 공급자 결정.
 *
 * DeepSeek(OpenAI 호환) · Anthropic · 내장 생성기 중 무엇을 쓸지 환경변수로 정한다.
 * 서버에서만 읽는다 — 키는 절대 클라이언트로 내려가지 않는다.
 */

import { DEFAULT_ENGINE, type EngineTier } from './engines';
import { EMPTY_AI_CONFIG, type AiConfig } from './config';

export type ProviderId = 'deepseek' | 'anthropic' | 'local';

export interface ProviderConfig {
  id: ProviderId;
  /** 화면에 표시할 이름 */
  label: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** 요청당 출력 토큰 상한 */
  maxOutputTokens: number;
  /** 어느 등급으로 고른 것인가. 관리자 점검 화면에서 짝을 보여 줄 때 쓴다. */
  tier: EngineTier;
  /**
   * 추론 강도로 못 박은 값. 빈 문자열이면 자동(사다리), `off` 면 안 보낸다.
   * 어댑터(`deepseek.ts`)가 이 값을 본다 — 환경변수를 직접 읽지 않는다.
   */
  effort: string;
}

const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

/**
 * 등급별 모델.
 *
 * **모델 이름은 여기에만 있다.** 브라우저로 가는 파일(`engines.ts`)에는 등급
 * 이름만 두어, 어떤 모델을 쓰는지가 화면으로 새지 않게 한다.
 *
 * `DEEPSEEK_MODEL` 은 등급이 생기기 전에 쓰던 이름이다. 지우면 이미 그 값을
 * 넣어 둔 배포가 조용히 다른 모델로 바뀌므로, **고급 쪽 기본값**으로 살려 둔다.
 */
const DEEPSEEK_DEFAULT_MODEL: Record<EngineTier, string> = {
  basic: 'deepseek-v4-flash',
  advanced: 'deepseek-v4-pro',
};

/**
 * DeepSeek 요청 하나가 뽑을 수 있는 출력 토큰 수.
 *
 * 이 값은 **상한이자 기준**이다. `lib/jobs/queue.ts` 의 `maxTokensFor` 가 이 값에
 * 비례해 산출물별 요청량을 늘리므로, 올리면 결과물이 실제로 길어진다.
 *
 * 모델이 받는 것보다 크게 잡으면 400 이 떨어진다. 필요하면 관리자 화면이나
 * `DEEPSEEK_MAX_TOKENS` 로 내린다.
 */
const DEEPSEEK_DEFAULT_MAX_TOKENS = 128000;

const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';
const ANTHROPIC_DEFAULT_MAX_TOKENS = 32000;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let warned = false;

/**
 * 등급에 맞는 DeepSeek 모델 이름.
 *
 * 고르는 차례는 **관리자 화면 > 환경변수 > 코드 기본값** 이다. 화면에서 비우면
 * 그 자리는 환경변수로 정확히 되돌아간다.
 */
function deepseekModel(tier: EngineTier, over: AiConfig): string {
  if (over.models[tier]) return over.models[tier];
  if (tier === 'basic') return env('DEEPSEEK_MODEL_BASIC') || DEEPSEEK_DEFAULT_MODEL.basic;
  return env('DEEPSEEK_MODEL_ADVANCED') || env('DEEPSEEK_MODEL') || DEEPSEEK_DEFAULT_MODEL.advanced;
}

/**
 * 지금 무엇으로 도는지 정한다.
 *
 * `over` 는 관리자가 화면에서 고친 값이다. 안 주면 환경변수만 본다 — 데이터베이스
 * 없이 도는 자리(설치 점검 같은 것)에서 그대로 쓸 수 있어야 한다.
 */
export function resolveProvider(
  tier: EngineTier = DEFAULT_ENGINE,
  over: AiConfig = EMPTY_AI_CONFIG,
  savedKey = '',
): ProviderConfig {
  const forced = (over.provider || env('AI_PROVIDER')).toLowerCase();
  /*
   * 화면에서 넣은 키가 환경변수보다 앞선다. 넣지 않았으면(`savedKey` 가 빈
   * 문자열) 예전처럼 환경변수를 쓴다.
   *
   * 키는 **공급자마다 따로 두지 않는다.** 한 배포가 동시에 두 공급자를 쓰는 일이
   * 없고, 자리를 나누면 "어느 칸에 넣어야 하지" 를 매번 묻게 된다. 지금 고른
   * 공급자의 키라고 본다.
   */
  const deepseekKey = savedKey || env('DEEPSEEK_API_KEY');
  const anthropicKey = savedKey || env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN');

  const deepseek = (): ProviderConfig => ({
    id: 'deepseek',
    label: 'DeepSeek',
    model: deepseekModel(tier, over),
    baseUrl: over.baseUrl || env('DEEPSEEK_BASE_URL') || DEEPSEEK_DEFAULT_BASE_URL,
    apiKey: deepseekKey,
    maxOutputTokens:
      over.maxOutputTokens ||
      positiveInt(env('DEEPSEEK_MAX_TOKENS'), DEEPSEEK_DEFAULT_MAX_TOKENS),
    tier,
    effort: over.effort || env('DEEPSEEK_REASONING_EFFORT'),
  });

  const anthropic = (): ProviderConfig => ({
    id: 'anthropic',
    label: 'Claude',
    // 이쪽은 모델이 하나다. 등급 차이는 추론 강도로만 낸다.
    model: over.models[tier] || env('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL,
    baseUrl: over.baseUrl || env('ANTHROPIC_BASE_URL'),
    apiKey: anthropicKey,
    maxOutputTokens:
      over.maxOutputTokens ||
      positiveInt(env('ANTHROPIC_MAX_TOKENS'), ANTHROPIC_DEFAULT_MAX_TOKENS),
    tier,
    effort: over.effort || env('DEEPSEEK_REASONING_EFFORT'),
  });

  const local = (): ProviderConfig => ({
    id: 'local',
    label: '내장 생성기',
    model: '',
    baseUrl: '',
    apiKey: '',
    maxOutputTokens: 0,
    tier,
    effort: '',
  });

  if (forced === 'local') return local();

  if (forced === 'deepseek') {
    if (deepseekKey) return deepseek();
    if (!warned) {
      warned = true;
      console.warn('[ai] AI_PROVIDER=deepseek 인데 DEEPSEEK_API_KEY 가 없어 내장 생성기로 동작합니다.');
    }
    return local();
  }

  if (forced === 'anthropic') {
    if (anthropicKey) return anthropic();
    if (!warned) {
      warned = true;
      console.warn('[ai] AI_PROVIDER=anthropic 인데 ANTHROPIC_API_KEY 가 없어 내장 생성기로 동작합니다.');
    }
    return local();
  }

  // 지정이 없으면 DeepSeek → Anthropic → 내장 순으로 고른다.
  if (deepseekKey) return deepseek();
  if (anthropicKey) return anthropic();
  return local();
}

export function isAiEnabled(over: AiConfig = EMPTY_AI_CONFIG, savedKey = ''): boolean {
  return resolveProvider(DEFAULT_ENGINE, over, savedKey).id !== 'local';
}
