/**
 * 구글 스티치에 화면을 **실제로 만들어 넣는다.**
 *
 * ## 무엇에 대고 말하는가
 *
 * 스티치는 원격 MCP 서버(`https://stitch.googleapis.com/mcp`)를 공개해 두었다.
 * JSON-RPC 2.0 한 겹이라 SDK 없이 `fetch` 로 부른다. 서버에서 부르므로 사용자
 * 브라우저에는 자격증명이 지나가지 않는다.
 *
 * ## 자격증명
 *
 * `Authorization: Bearer <액세스 토큰>` 또는 `X-Goog-Api-Key: <키>` 둘 중 하나다.
 * 어느 쪽인지는 값만 보고 알 수 없으므로 **부르는 쪽이 정해서 넘긴다.**
 *
 * ## 응답 모양
 *
 * MCP 는 결과를 `content[].text` 에 문자열로 담아 준다. 그 안에 JSON 이 들어
 * 있기도 하고 아니기도 하다. 게다가 서버가 오류를 **HTTP 200 + isError** 로
 * 돌려주므로, 상태 코드만 보고 성공했다고 믿으면 안 된다.
 */

const ENDPOINT = process.env.STITCH_MCP_URL || 'https://stitch.googleapis.com/mcp';

export type StitchCredentialKind = 'oauth' | 'apikey';

export interface StitchCredential {
  kind: StitchCredentialKind;
  secret: string;
  /** 쿼터를 물릴 구글 클라우드 프로젝트. OAuth 일 때만 의미가 있다. */
  quotaProject?: string;
}

/** 사용자에게 그대로 보여 줘도 되는 실패. */
export class StitchError extends Error {
  readonly kind: 'auth' | 'quota' | 'input' | 'server';
  constructor(kind: StitchError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

function authHeaders(cred: StitchCredential): Record<string, string> {
  if (cred.kind === 'apikey') return { 'X-Goog-Api-Key': cred.secret };
  const headers: Record<string, string> = { Authorization: `Bearer ${cred.secret}` };
  if (cred.quotaProject) headers['X-Goog-User-Project'] = cred.quotaProject;
  return headers;
}

/**
 * 실패 문구를 사용자 말로 바꾼다.
 *
 * 구글이 주는 원문은 영어인 데다 `developers.google.com/identity/...` 같은
 * 링크가 붙어 있어 그대로 보여 주면 무엇을 해야 할지 알 수 없다.
 */
function translate(raw: string): StitchError {
  const text = raw || '스티치가 응답하지 않았습니다.';
  if (/API keys are not supported/i.test(text)) {
    return new StitchError('auth', '이 방식의 키는 스티치가 받지 않습니다. 구글 계정으로 다시 연결해 주세요.');
  }
  /*
   * 만료와 "애초에 안 맞는 값" 은 사용자가 할 일이 다르다.
   * 만료면 다시 받아 오면 되고, 안 맞는 값이면 다른 것을 가져와야 한다.
   * 구글은 둘 다 같은 문구로 주므로 여기서 뭉뚱그리지 말고 부르는 쪽이 가른다.
   */
  if (/missing required authentication|invalid authentication|UNAUTHENTICATED|401/i.test(text)) {
    return new StitchError('auth', '스티치가 이 값을 받아 주지 않습니다. 만료됐거나 다른 종류의 값일 수 있습니다. 다시 연결해 주세요.');
  }
  if (/PERMISSION_DENIED|not been used in project|is disabled|403/i.test(text)) {
    return new StitchError('auth', '스티치를 쓸 권한이 없습니다. 연결한 계정에서 스티치를 한 번 열어 보신 뒤 다시 시도해 주세요.');
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(text)) {
    return new StitchError('quota', '스티치 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  /*
   * 구글은 이 오류를 **사람 말로** 준다 — "Request contains an invalid argument."
   * 열거형 이름(`INVALID_ARGUMENT`)만 찾고 있었더니 여기서 안 걸리고 아래
   * "문제가 생겼습니다" 로 떨어졌다. 그래서 사용자에게 무엇이 문제인지도,
   * 우리에게 어떻게 고칠지도 안 보였다.
   */
  if (/INVALID_ARGUMENT|invalid argument|400/i.test(text)) {
    return new StitchError('input', `스티치가 이 요청을 받지 않았습니다. ${text.slice(0, 160)}`);
  }
  return new StitchError('server', `스티치에서 문제가 생겼습니다. ${text.slice(0, 160)}`);
}

/** MCP 가 돌려준 `content[].text` 를 이어 붙인다. */
function textOf(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * 결과에서 JSON 을 꺼낸다.
 *
 * `structuredContent` 가 있으면 그걸 쓰고, 없으면 텍스트를 파싱해 본다.
 * 스티치는 설명 문장 뒤에 JSON 을 붙여 주기도 해서 첫 중괄호부터 잘라 본다.
 */
function jsonOf(result: unknown): Record<string, unknown> | null {
  const structured = (result as { structuredContent?: unknown })?.structuredContent;
  if (structured && typeof structured === 'object') return structured as Record<string, unknown>;

  const text = textOf(result);
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

let nextId = 1;

/**
 * 한 번 부를 때 기다려 줄 시간.
 *
 * 화면 하나에 수십 초가 걸리므로 넉넉해야 한다. 그렇다고 없으면 저쪽이 응답을
 * 안 줄 때 **영원히 매달린다** — 사용자 화면에는 `만드는 중` 이 끝없이 돈다.
 */
const CALL_TIMEOUT_MS = Number(process.env.STITCH_CALL_TIMEOUT_MS) || 150_000;

/** 사용자가 멈춘 것과 시간이 다 된 것을 하나로 묶는다. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timer = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

/** 도구 하나를 부른다. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  cred: StitchCredential,
  signal?: AbortSignal,
): Promise<{ json: Record<string, unknown> | null; text: string }> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: withTimeout(signal, CALL_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...authHeaders(cred),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (error) {
    // 사용자가 멈춘 것은 그대로 올려 보낸다. 시간 초과는 실패로 알린다.
    if (error instanceof DOMException && error.name === 'AbortError' && signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new StitchError(
        'server',
        '스티치가 제때 답하지 않았습니다. 화면이 만들어졌을 수도 있으니 스티치에서 확인해 주세요.',
      );
    }
    throw new StitchError('server', '스티치에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  }

  const body = await response.text();
  let envelope: { result?: unknown; error?: { message?: string } };
  try {
    envelope = JSON.parse(body) as typeof envelope;
  } catch {
    throw translate(body.slice(0, 200));
  }

  if (envelope.error) throw translate(envelope.error.message ?? '');

  // 오류를 HTTP 200 안에 담아 보낸다. 여기를 안 보면 실패를 성공으로 읽는다.
  const result = envelope.result;
  if ((result as { isError?: boolean })?.isError) throw translate(textOf(result));
  if (!response.ok) throw translate(textOf(result) || body.slice(0, 200));

  return { json: jsonOf(result), text: textOf(result) };
}

/* ------------------------------------------------------------------ */
/* 어떤 값인지 알아내기                                                   */
/* ------------------------------------------------------------------ */

/**
 * 값 모양만 보고 방식을 짐작하지 않는다 — **실제로 찔러 본다.**
 *
 * 처음에는 `AIza…` 면 API 키, 아니면 토큰으로 갈랐다. 그런데 스티치가 발급하는
 * 키가 그 모양이 아니면 엉뚱한 헤더로 나가고, 사용자는 "연결은 됐는데 만들면
 * 실패한다" 는 영문 모를 상태에 빠진다. 저장할 때 한 번 확인해 두면 그 자리에서
 * 알 수 있다.
 *
 * 되는 쪽을 돌려주고, 둘 다 안 되면 마지막 이유를 담아 던진다.
 */
export async function detectCredential(
  secret: string,
  quotaProject?: string,
  signal?: AbortSignal,
): Promise<StitchCredentialKind> {
  // 그럴듯한 쪽을 먼저 본다. 맞으면 한 번으로 끝난다.
  const order: StitchCredentialKind[] = /^AIza[0-9A-Za-z_-]{10,}$/.test(secret)
    ? ['apikey', 'oauth']
    : ['oauth', 'apikey'];

  let last: unknown = null;
  for (const kind of order) {
    try {
      await callTool('list_projects', {}, { kind, secret, quotaProject }, signal);
      return kind;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // 자격증명 문제가 아니면 값 자체는 맞다는 뜻이다. 더 시도할 이유가 없다.
      if (error instanceof StitchError && error.kind !== 'auth') return kind;
      last = error;
    }
  }
  throw last instanceof StitchError
    ? last
    : new StitchError('auth', '스티치가 이 값을 받아 주지 않았습니다.');
}

/* ------------------------------------------------------------------ */
/* 쓰는 쪽에서 필요한 만큼만                                              */
/* ------------------------------------------------------------------ */

/** 응답 어디에 있든 id 로 보이는 값을 찾아온다. 스티치가 감싸는 모양을 자주 바꾼다. */
function digId(value: unknown, keys: string[], depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  for (const k of keys) {
    const found = record[k];
    if (typeof found === 'string' && found.trim()) {
      // `projects/123` 처럼 접두사가 붙어 오면 뒤쪽만 쓴다.
      return found.includes('/') ? found.split('/').pop()!.trim() : found.trim();
    }
  }
  for (const nested of Object.values(record)) {
    const found = digId(nested, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function createProject(
  title: string,
  cred: StitchCredential,
  signal?: AbortSignal,
): Promise<string> {
  const { json, text } = await callTool('create_project', { title }, cred, signal);
  const id = digId(json, ['projectId', 'project_id', 'id', 'name']);
  if (!id) throw new StitchError('server', `스티치가 프로젝트 번호를 주지 않았습니다. ${text.slice(0, 120)}`);
  return id;
}

export type StitchDevice = 'MOBILE' | 'DESKTOP' | 'TABLET' | 'AGNOSTIC';

/**
 * 디자인 시스템을 만들어 두고 화면마다 물린다.
 *
 * 화면마다 요청문에 "파란색 쓰세요" 를 반복하는 것과 다르다. 스티치가 이걸
 * 하나의 체계로 잡아 두고 이후 화면들이 전부 따르게 한다. 지침 문서(`designMd`)는
 * 통째로 들어간다.
 *
 * **실패해도 화면 만들기는 계속돼야 한다.** 색·글꼴이 조금 제각각인 것과 화면이
 * 아예 안 만들어지는 것 중에는 앞이 낫다. 그래서 여기서는 던지지 않고 null 을 준다.
 */
export async function createDesignSystem(
  projectId: string,
  spec: {
    displayName: string;
    colorMode: string;
    headlineFont: string;
    bodyFont: string;
    roundness: string;
    customColor: string;
    designMd: string;
  },
  cred: StitchCredential,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { json } = await callTool(
      'create_design_system',
      {
        projectId,
        designSystem: {
          displayName: spec.displayName,
          theme: {
            colorMode: spec.colorMode,
            headlineFont: spec.headlineFont,
            bodyFont: spec.bodyFont,
            roundness: spec.roundness,
            customColor: spec.customColor,
            designMd: spec.designMd,
          },
        },
      },
      cred,
      signal,
    );
    return digId(json, ['assetId', 'asset_id', 'designSystemId', 'id', 'name']);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 고를 수 있는 모델                                                     */
/* ------------------------------------------------------------------ */

export interface StitchModel {
  id: string;
  /** 사람이 읽을 이름. 스티치가 주는 설명을 그대로 쓴다. */
  label: string;
  /** 느리지만 결과가 나은 쪽인가 — 월 사용 횟수가 적다는 안내를 붙인다. */
  heavy: boolean;
}

/**
 * 목록을 **박아 두지 않고 스티치에서 받아 온다.**
 *
 * 저쪽이 모델을 더하거나 뺄 때마다 우리 코드를 고쳐야 한다면, 새 모델이 나와도
 * 사용자는 한참 못 쓴다. `tools/list` 는 자격증명 없이도 답하므로 그냥 물어본다.
 *
 * 폐기된 것과 `MODEL_ID_UNSPECIFIED` 는 뺀다 — 고를 이유가 없다.
 */
const FALLBACK_MODELS: StitchModel[] = [
  { id: 'GEMINI_3_FLASH', label: 'Gemini 3 Flash', heavy: false },
  { id: 'GEMINI_3_1_PRO', label: 'Gemini 3.1 Pro', heavy: true },
];

let modelCache: { at: number; models: StitchModel[] } | null = null;
const MODEL_TTL_MS = 60 * 60 * 1000;

export async function listModels(signal?: AbortSignal): Promise<StitchModel[]> {
  if (modelCache && Date.now() - modelCache.at < MODEL_TTL_MS) return modelCache.models;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: withTimeout(signal, 15_000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = (await response.json()) as {
      result?: { tools?: Array<{ name?: string; inputSchema?: unknown }> };
    };
    const tool = body.result?.tools?.find((t) => t.name === 'generate_screen_from_text');
    const schema = (tool?.inputSchema as { properties?: Record<string, unknown> })?.properties
      ?.modelId as
      | {
          enum?: string[];
          'x-google-enum-deprecated'?: boolean[];
          'x-google-enum-descriptions'?: string[];
        }
      | undefined;

    const ids = schema?.enum ?? [];
    const dead = schema?.['x-google-enum-deprecated'] ?? [];
    const notes = schema?.['x-google-enum-descriptions'] ?? [];

    const models = ids
      .map((id, i) => ({
        id,
        // 설명이 곧 사람이 읽을 이름이다 ("Gemini 3.1 Pro."). 끝의 마침표만 뗀다.
        label: (notes[i] || id).replace(/\.$/, ''),
        heavy: /pro/i.test(id),
        dead: Boolean(dead[i]) || id === 'MODEL_ID_UNSPECIFIED',
      }))
      .filter((m) => !m.dead)
      .map(({ id, label, heavy }) => ({ id, label, heavy }));

    if (models.length === 0) return FALLBACK_MODELS;
    modelCache = { at: Date.now(), models };
    return models;
  } catch {
    // 못 물어봤다고 기능을 막지는 않는다. 아는 만큼으로 굴린다.
    return FALLBACK_MODELS;
  }
}

/** 사용자가 보낸 모델이 실제로 고를 수 있는 것인지. */
export async function resolveModel(id: string | undefined): Promise<string> {
  const models = await listModels();
  const found = models.find((m) => m.id === id);
  // 모르는 값이면 가벼운 쪽으로 — 횟수를 아끼는 쪽이 안전하다.
  return found?.id ?? models.find((m) => !m.heavy)?.id ?? models[0]?.id ?? 'GEMINI_3_FLASH';
}

export interface GeneratedScreen {
  screenId: string;
  /** 결과를 볼 수 있는 주소. 못 찾으면 프로젝트 주소로 대신한다. */
  url: string;
  imageUrl: string | null;
}

export async function generateScreen(
  projectId: string,
  prompt: string,
  device: StitchDevice,
  modelId: string,
  designSystem: string | null,
  cred: StitchCredential,
  signal?: AbortSignal,
): Promise<GeneratedScreen> {
  const { json } = await callTool(
    'generate_screen_from_text',
    {
      projectId,
      prompt,
      deviceType: device,
      modelId,
      // 스티치 설명: 화면끼리 결을 맞추려면 늘 지정하는 편이 낫다.
      ...(designSystem ? { designSystem } : {}),
    },
    cred,
    signal,
  );

  /*
   * 번호를 못 찾았다고 실패로 보지 않는다.
   *
   * 예전에는 여기서 던졌다. 그런데 **스티치에는 화면이 멀쩡히 만들어져 있는데**
   * 우리만 "실패" 라고 표시하는 일이 생겼다. 호출이 성공했다는 것은 화면이
   * 만들어졌다는 뜻이고, 번호는 응답 모양이 바뀌면 못 찾을 수 있을 뿐이다.
   * 사용자에게 중요한 것은 화면이 생겼는가지 우리가 번호를 읽었는가가 아니다.
   */
  const screenId = digId(json, ['screenId', 'screen_id', 'id', 'name']) ?? '';
  const image = digId(json, ['imageUrl', 'image_url', 'screenshotUrl', 'thumbnailUrl']);
  return {
    screenId,
    url: projectUrl(projectId),
    imageUrl: image && /^https?:\/\//.test(image) ? image : null,
  };
}

/** 사용자가 결과를 열어 볼 주소. */
export function projectUrl(projectId: string): string {
  return `https://stitch.withgoogle.com/projects/${encodeURIComponent(projectId)}`;
}
