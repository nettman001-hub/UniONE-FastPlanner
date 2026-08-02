import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompts';

export const MODEL = 'claude-opus-5';

/** API 키가 있으면 실제 모델을, 없으면 내장 생성기를 쓴다. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let cached: Anthropic | null = null;

function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

export interface GenerateOptions {
  prompt: string;
  schema: unknown;
  /** 결과 분량에 따라 조절한다. */
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * 스키마에 맞는 JSON 을 생성한다.
 * 출력이 길어질 수 있으므로 항상 스트리밍으로 호출한다.
 */
export async function generateJson<T>({
  prompt,
  schema,
  maxTokens = 32000,
  effort = 'high',
}: GenerateOptions): Promise<T> {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
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
