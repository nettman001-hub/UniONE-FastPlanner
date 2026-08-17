/**
 * 생성 공급자 결정.
 *
 * DeepSeek(OpenAI 호환) · Anthropic · 내장 생성기 중 무엇을 쓸지 환경변수로 정한다.
 * 서버에서만 읽는다 — 키는 절대 클라이언트로 내려가지 않는다.
 */

import { DEFAULT_ENGINE, type EngineTier } from './engines';

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

/** DeepSeek 모델의 출력 상한이 모델마다 달라 보수적으로 잡는다. 필요하면 환경변수로 올린다. */
const DEEPSEEK_DEFAULT_MAX_TOKENS = 8192;

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

/** 등급에 맞는 DeepSeek 모델 이름. 환경변수로 등급마다 따로 바꿀 수 있다. */
function deepseekModel(tier: EngineTier): string {
  if (tier === 'basic') return env('DEEPSEEK_MODEL_BASIC') || DEEPSEEK_DEFAULT_MODEL.basic;
  return env('DEEPSEEK_MODEL_ADVANCED') || env('DEEPSEEK_MODEL') || DEEPSEEK_DEFAULT_MODEL.advanced;
}

export function resolveProvider(tier: EngineTier = DEFAULT_ENGINE): ProviderConfig {
  const forced = env('AI_PROVIDER').toLowerCase();
  const deepseekKey = env('DEEPSEEK_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN');

  const deepseek = (): ProviderConfig => ({
    id: 'deepseek',
    label: 'DeepSeek',
    model: deepseekModel(tier),
    baseUrl: env('DEEPSEEK_BASE_URL') || DEEPSEEK_DEFAULT_BASE_URL,
    apiKey: deepseekKey,
    maxOutputTokens: positiveInt(env('DEEPSEEK_MAX_TOKENS'), DEEPSEEK_DEFAULT_MAX_TOKENS),
    tier,
  });

  const anthropic = (): ProviderConfig => ({
    id: 'anthropic',
    label: 'Claude',
    // 이쪽은 모델이 하나다. 등급 차이는 추론 강도로만 낸다.
    model: env('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL,
    baseUrl: env('ANTHROPIC_BASE_URL'),
    apiKey: anthropicKey,
    maxOutputTokens: positiveInt(env('ANTHROPIC_MAX_TOKENS'), ANTHROPIC_DEFAULT_MAX_TOKENS),
    tier,
  });

  const local = (): ProviderConfig => ({
    id: 'local',
    label: '내장 생성기',
    model: '',
    baseUrl: '',
    apiKey: '',
    maxOutputTokens: 0,
    tier,
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

export function isAiEnabled(): boolean {
  return resolveProvider().id !== 'local';
}
