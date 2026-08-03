import OpenAI from 'openai';
import type { ProviderConfig } from './provider';

/**
 * DeepSeek 어댑터 (OpenAI 호환 엔드포인트).
 *
 * Anthropic 의 구조화 출력(output_config.format)은 DeepSeek 에 없으므로,
 * JSON 모드(response_format: json_object) + 프롬프트에 넣은 JSON Schema 로 형식을 맞춘다.
 * 스키마를 벗어난 값이 와도 apply.ts 가 열거형·인덱스·참조를 모두 정규화하므로
 * 파이프라인이 깨지지 않는다.
 */

let cached: { key: string; baseUrl: string; client: OpenAI } | null = null;

function client(config: ProviderConfig): OpenAI {
  if (cached && cached.key === config.apiKey && cached.baseUrl === config.baseUrl) {
    return cached.client;
  }
  const instance = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    // 긴 산출물 생성이 라우트 제한(300초) 안에서 끝나도록 여유를 둔다.
    timeout: 240_000,
    maxRetries: 2,
  });
  cached = { key: config.apiKey, baseUrl: config.baseUrl, client: instance };
  return instance;
}

/** 모델이 코드펜스나 앞뒤 설명을 붙여도 JSON 본문만 뽑아낸다. */
export function extractJson(text: string): string {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  if (body.startsWith('{') && body.endsWith('}')) return body;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) return body.slice(start, end + 1);

  return body;
}

function buildUserContent(prompt: string, schema: unknown): string {
  return [
    prompt,
    '',
    '## 출력 형식',
    '아래 JSON Schema 를 만족하는 JSON 객체 하나만 출력하세요.',
    '설명 문장, 마크다운 코드펜스, 주석 없이 JSON 본문만 출력합니다.',
    'required 에 있는 키는 값이 없더라도 빈 문자열이나 빈 배열로 반드시 포함합니다.',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n');
}

export interface DeepSeekRequest {
  config: ProviderConfig;
  system: string;
  prompt: string;
  schema: unknown;
  maxTokens: number;
}

export async function generateJsonWithDeepSeek<T>({
  config,
  system,
  prompt,
  schema,
  maxTokens,
}: DeepSeekRequest): Promise<T> {
  const openai = client(config);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: buildUserContent(prompt, schema) },
  ];
  // 모델별 출력 상한을 넘기면 400 이 나므로 공급자 설정으로 한 번 더 조인다.
  const cappedMaxTokens = Math.min(maxTokens, config.maxOutputTokens);

  const call = (jsonMode: boolean) =>
    openai.chat.completions.create({
      model: config.model,
      messages,
      max_tokens: cappedMaxTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    });

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await call(true);
  } catch (error) {
    // JSON 모드를 지원하지 않는 모델이면 프롬프트만으로 다시 시도한다.
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof OpenAI.APIError && error.status === 400 && /response_format|json/i.test(message)) {
      completion = await call(false);
    } else {
      throw new Error(describeError(error, config));
    }
  }

  const choice = completion.choices[0];
  const text = choice?.message?.content ?? '';

  if (choice?.finish_reason === 'length') {
    throw new Error(
      `응답이 출력 한도(${cappedMaxTokens} 토큰)에서 잘렸습니다. DEEPSEEK_MAX_TOKENS 를 올리거나 생성 범위를 좁혀 주세요.`,
    );
  }
  if (!text.trim()) {
    throw new Error(`${config.label} 모델이 빈 응답을 반환했습니다.`);
  }

  try {
    return JSON.parse(extractJson(text)) as T;
  } catch {
    throw new Error(`${config.label} 응답을 JSON 으로 해석하지 못했습니다.`);
  }
}

function describeError(error: unknown, config: ProviderConfig): string {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401) return `${config.label} API 키가 올바르지 않습니다.`;
    if (error.status === 402) return `${config.label} 계정의 잔액이 부족합니다.`;
    if (error.status === 404) {
      return `모델 '${config.model}' 을(를) 찾을 수 없습니다. DEEPSEEK_MODEL 값을 확인해 주세요.`;
    }
    if (error.status === 429) return `${config.label} 요청이 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.`;
    return `${config.label} 호출 실패 (${error.status}): ${error.message}`;
  }
  if (error instanceof Error) return `${config.label} 호출 실패: ${error.message}`;
  return `${config.label} 호출 중 알 수 없는 오류가 발생했습니다.`;
}
