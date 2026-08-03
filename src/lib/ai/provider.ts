/**
 * 생성 공급자 결정.
 *
 * DeepSeek(OpenAI 호환) · Anthropic · 내장 생성기 중 무엇을 쓸지 환경변수로 정한다.
 * 서버에서만 읽는다 — 키는 절대 클라이언트로 내려가지 않는다.
 */

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
}

const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro';
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

export function resolveProvider(): ProviderConfig {
  const forced = env('AI_PROVIDER').toLowerCase();
  const deepseekKey = env('DEEPSEEK_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN');

  const deepseek = (): ProviderConfig => ({
    id: 'deepseek',
    label: 'DeepSeek',
    model: env('DEEPSEEK_MODEL') || DEEPSEEK_DEFAULT_MODEL,
    baseUrl: env('DEEPSEEK_BASE_URL') || DEEPSEEK_DEFAULT_BASE_URL,
    apiKey: deepseekKey,
    maxOutputTokens: positiveInt(env('DEEPSEEK_MAX_TOKENS'), DEEPSEEK_DEFAULT_MAX_TOKENS),
  });

  const anthropic = (): ProviderConfig => ({
    id: 'anthropic',
    label: 'Claude',
    model: env('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL,
    baseUrl: env('ANTHROPIC_BASE_URL'),
    apiKey: anthropicKey,
    maxOutputTokens: positiveInt(env('ANTHROPIC_MAX_TOKENS'), ANTHROPIC_DEFAULT_MAX_TOKENS),
  });

  const local = (): ProviderConfig => ({
    id: 'local',
    label: '내장 생성기',
    model: '',
    baseUrl: '',
    apiKey: '',
    maxOutputTokens: 0,
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
