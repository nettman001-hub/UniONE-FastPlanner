import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompts';
import { resolveProvider, type ProviderConfig } from './provider';
import { DEFAULT_ENGINE, type EngineTier } from './engines';
import type { AiConfig } from './config';
import { readAiRuntime } from '../db/ai-config';
import { generateJsonWithDeepSeek } from './deepseek';
import { AiError } from './errors';

export { resolveProvider, isAiEnabled } from './provider';
export type { ProviderConfig, ProviderId } from './provider';

export interface GenerateOptions {
  /** 작업별 시스템 역할. 생략하면 기존 서비스 기획자 역할을 쓴다. */
  system?: string;
  prompt: string;
  schema: unknown;
  /** 결과 분량에 따라 조절한다. 공급자별 상한으로 한 번 더 조인다. */
  maxTokens?: number;
  /**
   * 추론 강도. **기본이 최대다.**
   *
   * 문서를 한 번 만드는 데 몇 십 초가 걸리는 일이라, 조금 빨리 끝내려고 얕게
   * 생각하게 하는 것은 남는 장사가 아니다. 빠른 쪽이 필요하면 등급을 낮춘다.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** 어느 엔진으로 만들지. 계정 설정에서 온다. */
  engine?: EngineTier;
  /**
   * 관리자가 화면에서 고친 값. 안 주면 여기서 읽는다.
   *
   * 부르는 쪽이 이미 읽어 두었으면 넘겨서 같은 질의를 두 번 하지 않게 한다.
   */
  config?: AiConfig;
  /** 화면에서 넣어 둔 API 키. 없으면 환경변수를 쓴다. */
  apiKey?: string;
  /** 브라우저 연결이 끊기거나 작업을 멈추면 공급자 요청도 취소한다. */
  signal?: AbortSignal;
}

/**
 * 스키마에 맞는 JSON 을 생성한다.
 * 어떤 공급자를 쓰는지는 호출부가 알 필요 없다.
 */
export async function generateJson<T>(options: GenerateOptions): Promise<T> {
  const runtime = options.config ? null : await readAiRuntime();
  const over = options.config ?? runtime!.config;
  const key = options.apiKey ?? runtime?.apiKey ?? '';
  const config = resolveProvider(options.engine ?? DEFAULT_ENGINE, over, key);

  if (config.id === 'deepseek') {
    return generateJsonWithDeepSeek<T>({
      config,
      system: options.system ?? SYSTEM_PROMPT,
      prompt: options.prompt,
      schema: options.schema,
      maxTokens: options.maxTokens ?? config.maxOutputTokens,
      signal: options.signal,
    });
  }

  if (config.id === 'anthropic') {
    return generateJsonWithClaude<T>(config, options);
  }

  throw new AiError('config', 'AI 공급자가 설정되지 않았습니다.');
}

/* ------------------------------------------------------------------ */
/* 구조화 출력을 지원하는 공급자                                          */
/* ------------------------------------------------------------------ */

let cachedClaude: { key: string; baseUrl: string; client: Anthropic } | null = null;

function claudeClient(config: ProviderConfig): Anthropic {
  if (
    cachedClaude &&
    cachedClaude.key === config.apiKey &&
    cachedClaude.baseUrl === config.baseUrl
  ) {
    return cachedClaude.client;
  }
  const instance = new Anthropic({
    apiKey: config.apiKey || undefined,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
  cachedClaude = { key: config.apiKey, baseUrl: config.baseUrl, client: instance };
  return instance;
}

/** 출력이 길어질 수 있으므로 항상 스트리밍으로 호출한다. */
async function generateJsonWithClaude<T>(
  config: ProviderConfig,
  { system = SYSTEM_PROMPT, prompt, schema, maxTokens, effort = 'max', signal }: GenerateOptions,
): Promise<T> {
  const stream = claudeClient(config).messages.stream(
    {
      model: config.model,
      max_tokens: Math.min(maxTokens ?? config.maxOutputTokens, config.maxOutputTokens),
      system,
      thinking: { type: 'adaptive' },
      output_config: {
        effort,
        format: { type: 'json_schema', schema },
      },
      messages: [{ role: 'user', content: prompt }],
    } as Anthropic.MessageStreamParams,
    { signal },
  );

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') throw new AiError('refused');

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text.trim()) {
    if (message.stop_reason === 'max_tokens') throw new AiError('too-long', 'max_tokens');
    throw new AiError('format', '빈 응답');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError('format', `JSON 해석 실패 · 응답 길이 ${text.length}자`);
  }
}
