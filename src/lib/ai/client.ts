import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompts';
import { resolveProvider, type ProviderConfig } from './provider';
import { generateJsonWithDeepSeek } from './deepseek';

export { resolveProvider, isAiEnabled } from './provider';
export type { ProviderConfig, ProviderId } from './provider';

export interface GenerateOptions {
  prompt: string;
  schema: unknown;
  /** 결과 분량에 따라 조절한다. 공급자별 상한으로 한 번 더 조인다. */
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * 스키마에 맞는 JSON 을 생성한다.
 * 어떤 공급자를 쓰는지는 호출부가 알 필요 없다.
 */
export async function generateJson<T>(options: GenerateOptions): Promise<T> {
  const config = resolveProvider();

  if (config.id === 'deepseek') {
    return generateJsonWithDeepSeek<T>({
      config,
      system: SYSTEM_PROMPT,
      prompt: options.prompt,
      schema: options.schema,
      maxTokens: options.maxTokens ?? config.maxOutputTokens,
    });
  }

  if (config.id === 'anthropic') {
    return generateJsonWithClaude<T>(config, options);
  }

  throw new Error('AI 공급자가 설정되지 않았습니다.');
}

/* ------------------------------------------------------------------ */
/* Anthropic                                                            */
/* ------------------------------------------------------------------ */

let cachedClaude: { key: string; client: Anthropic } | null = null;

function claudeClient(config: ProviderConfig): Anthropic {
  if (cachedClaude && cachedClaude.key === config.apiKey) return cachedClaude.client;
  const instance = new Anthropic({
    apiKey: config.apiKey || undefined,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
  cachedClaude = { key: config.apiKey, client: instance };
  return instance;
}

/** 출력이 길어질 수 있으므로 항상 스트리밍으로 호출한다. */
async function generateJsonWithClaude<T>(
  config: ProviderConfig,
  { prompt, schema, maxTokens, effort = 'high' }: GenerateOptions,
): Promise<T> {
  const stream = claudeClient(config).messages.stream({
    model: config.model,
    max_tokens: Math.min(maxTokens ?? config.maxOutputTokens, config.maxOutputTokens),
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content: prompt }],
  } as Anthropic.MessageStreamParams);

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('모델이 요청을 거절했습니다. 서비스 아이디어를 다시 확인해 주세요.');
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text.trim()) {
    if (message.stop_reason === 'max_tokens') {
      throw new Error('생성 결과가 너무 길어 잘렸습니다. 범위를 좁혀 다시 시도해 주세요.');
    }
    throw new Error('모델이 빈 응답을 반환했습니다.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('모델 응답을 JSON 으로 해석하지 못했습니다.');
  }
}
