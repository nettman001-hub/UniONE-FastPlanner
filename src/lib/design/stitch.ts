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
  if (/missing required authentication|invalid authentication|UNAUTHENTICATED|401/i.test(text)) {
    return new StitchError('auth', '스티치 연결이 만료됐습니다. 다시 연결해 주세요.');
  }
  if (/PERMISSION_DENIED|not been used in project|is disabled|403/i.test(text)) {
    return new StitchError('auth', '스티치를 쓸 권한이 없습니다. 연결한 계정에서 스티치를 한 번 열어 보신 뒤 다시 시도해 주세요.');
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(text)) {
    return new StitchError('quota', '스티치 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  if (/INVALID_ARGUMENT|400/i.test(text)) {
    return new StitchError('input', `스티치가 요청을 거절했습니다. ${text.slice(0, 160)}`);
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
      signal,
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
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
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
  cred: StitchCredential,
  signal?: AbortSignal,
): Promise<GeneratedScreen> {
  const { json, text } = await callTool(
    'generate_screen_from_text',
    { projectId, prompt, deviceType: device },
    cred,
    signal,
  );
  const screenId = digId(json, ['screenId', 'screen_id', 'id', 'name']);
  if (!screenId) throw new StitchError('server', `스티치가 화면 번호를 주지 않았습니다. ${text.slice(0, 120)}`);

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
