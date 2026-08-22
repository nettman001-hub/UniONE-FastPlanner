import OpenAI from 'openai';
import type { ProviderConfig } from './provider';
import { AiError } from './errors';

/**
 * OpenAI 호환 엔드포인트용 어댑터.
 *
 * 구조화 출력(output_config.format)이 없는 공급자라, JSON 모드
 * (response_format: json_object) + 프롬프트에 넣은 JSON Schema 로 형식을 맞춘다.
 * 스키마를 벗어난 값이 와도 apply.ts 가 열거형·인덱스·참조를 모두 정규화하므로
 * 파이프라인이 깨지지 않는다.
 *
 * **오류 문장에 공급자·모델 이름을 넣지 않는다.** 사용자 화면까지 그대로 흘러간다.
 * 분류는 `errors.ts` 가 맡고, 원인 원문은 서버 로그에만 남는다.
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

/* ------------------------------------------------------------------ */
/* 추론 강도                                                             */
/* ------------------------------------------------------------------ */

/**
 * **가장 세게 생각하도록 요청한다.**
 *
 * 문제는 이 엔드포인트가 어떤 값을 받는지 **확인할 방법이 없다**는 것이다.
 * OpenAI 호환이라 `reasoning_effort` 를 받는 것이 보통이지만, 받는 단계는
 * 공급자·모델마다 다르고 아예 안 받는 것도 있다. 모르는 값을 보내면 400 이
 * 떨어지고 **생성 자체가 실패한다** — 그것만은 안 된다.
 *
 * 그래서 사다리로 둔다. 위에서부터 시도하고, 그 값 때문에 거부당하면 한 칸
 * 내려온다. 다 떨어지면 파라미터를 빼고 부른다. 어디까지 되는지는 **기억해
 * 두어**, 서버가 사는 동안 같은 헛걸음을 반복하지 않는다.
 *
 * 확실히 아는 값이 있으면 관리자 화면(또는 `DEEPSEEK_REASONING_EFFORT`)에서 못
 * 박으면 된다. 아예 끄려면 `off`.
 */
const EFFORT_LADDER = ['max', 'xhigh', 'high'];

/**
 * 지금 쓰는 칸. **못 박은 값별로 따로 기억한다.**
 *
 * 관리자가 화면에서 값을 바꾸면 서버를 다시 띄우지 않아도 반영돼야 한다. 사다리를
 * 하나만 두면 앞 설정에서 내려온 자리를 새 설정에도 그대로 쓰게 된다.
 */
const ladders = new Map<string, string[]>();

function ladder(configured: string): string[] {
  const key = configured.trim().toLowerCase();
  const known = ladders.get(key);
  if (known) return known;
  const fresh = key === 'off' ? [] : key ? [key] : [...EFFORT_LADDER];
  ladders.set(key, fresh);
  return fresh;
}

function currentEffort(configured: string): string | null {
  return ladder(configured)[0] ?? null;
}

/** 이 값 때문에 거부당했다. 한 칸 내려온다. */
function stepDownEffort(configured: string): void {
  const key = configured.trim().toLowerCase();
  const rest = ladder(configured).slice(1);
  ladders.set(key, rest);
  console.warn(
    `[ai] 추론 강도를 낮춥니다 → ${rest[0] ?? '(사용 안 함)'} — 앞 값을 엔드포인트가 받지 않았습니다.`,
  );
}

function isEffortRejection(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError) || error.status !== 400) return false;
  return /reasoning[_ ]?effort/i.test(error.message);
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
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  signal?: AbortSignal;
  retryFormat?: boolean;
}

export async function generateJsonWithDeepSeek<T>({
  config,
  system,
  prompt,
  schema,
  maxTokens,
  effort,
  signal,
  retryFormat = true,
}: DeepSeekRequest): Promise<T> {
  const openai = client(config);
  // 모델별 출력 상한을 넘기면 400 이 나므로 공급자 설정으로 한 번 더 조인다.
  const cappedMaxTokens = Math.min(maxTokens, config.maxOutputTokens);
  // 관리자가 값을 못 박았으면 그것을 우선하고, 작업별 요청은 빈 설정일 때만 쓴다.
  const effortSetting = config.effort || effort || '';

  const call = (jsonMode: boolean, extra?: string) => {
    const current = currentEffort(effortSetting);
    return openai.chat.completions.create(
      {
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildUserContent(prompt, schema) },
          ...(extra ? [{ role: 'user' as const, content: extra }] : []),
        ],
        max_tokens: cappedMaxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        // SDK 타입에 아직 없을 수 있어 따로 얹는다. 값은 위 사다리가 정한다.
        ...(current ? { reasoning_effort: current } : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
  };

  /**
   * 추론 강도 때문에 거부당하면 **한 칸 내려 같은 요청을 다시** 보낸다.
   *
   * 사다리는 부를 때마다 짧아지고, 다 떨어지면 `currentEffort()` 가 null 이라
   * 더 돌지 않는다. 다른 오류는 그대로 올려보낸다.
   */
  const sendWithEffortFallback = async (jsonMode: boolean, extra?: string) => {
    for (;;) {
      try {
        return await call(jsonMode, extra);
      } catch (error) {
        if (isEffortRejection(error) && currentEffort(effortSetting) !== null) {
          stepDownEffort(effortSetting);
          continue;
        }
        throw error;
      }
    }
  };

  const once = async (extra?: string): Promise<T> => {
    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await sendWithEffortFallback(true, extra);
    } catch (error) {
      // JSON 모드를 지원하지 않는 모델이면 프롬프트만으로 다시 시도한다.
      const message = error instanceof Error ? error.message : String(error);
      if (
        error instanceof OpenAI.APIError &&
        error.status === 400 &&
        /response_format|json/i.test(message)
      ) {
        completion = await sendWithEffortFallback(false, extra);
      } else {
        throw classify(error);
      }
    }

    const choice = completion.choices[0];
    const text = choice?.message?.content ?? '';

    if (choice?.finish_reason === 'length') {
      throw new AiError('too-long', `출력 상한 ${cappedMaxTokens} 토큰에서 잘림`);
    }
    if (!text.trim()) throw new AiError('format', '빈 응답');

    try {
      return JSON.parse(extractJson(text)) as T;
    } catch {
      throw new AiError('format', `JSON 해석 실패 · 응답 길이 ${text.length}자`);
    }
  };

  try {
    return await once();
  } catch (error) {
    /*
     * 형식이 어긋난 것은 **한 번 더 해 보면 대개 풀린다.** 모델이 설명 문장을 덧붙이거나
     * 코드펜스를 씌우는 일이 가끔 있다. 사용자가 같은 요청을 다시 적게 하는 대신
     * 여기서 한 번 조용히 다시 시도한다. 설정 문제(키·잔액)나 길이 초과는 다시 해도
     * 같은 결과라 재시도하지 않는다.
     */
    if (retryFormat && error instanceof AiError && error.kind === 'format') {
      return once(
        '앞선 응답이 형식을 벗어났습니다. 이번에는 설명 문장·코드펜스 없이 JSON 객체 하나만 출력하세요.',
      );
    }
    throw error;
  }
}

/** 공급자 오류를 사용자에게 보여도 되는 종류로 나눈다. 원문은 로그로만 간다. */
function classify(error: unknown): AiError {
  if (error instanceof OpenAI.APIError) {
    // 401 키 오류 · 402 잔액 부족 · 404 모델 이름 — 전부 배포 설정 문제다.
    if (error.status === 401 || error.status === 402 || error.status === 404) {
      return new AiError('config', `HTTP ${error.status}: ${error.message}`);
    }
    if (error.status === 429) return new AiError('busy', error.message);
    return new AiError('unknown', `HTTP ${error.status}: ${error.message}`);
  }
  return new AiError('unknown', error);
}
