/**
 * AI 호출 실패를 **사용자에게 보여도 되는 문장**으로 바꾼다.
 *
 * 두 가지 원칙이 있다.
 *
 * 1. **어떤 모델·공급자를 쓰는지 절대 드러내지 않는다.** 예전에는
 *    "DeepSeek 응답을 JSON 으로 해석하지 못했습니다" 가 채팅창에 그대로 떴다.
 *    사용자에게는 아무 의미 없는 정보이면서, 서비스의 내부 구성을 알려 준다.
 * 2. **사용자가 다음에 무엇을 할지 알 수 있어야 한다.** "다시 시도하면 되는 일"
 *    인지 "관리자에게 알려야 하는 일" 인지가 문장에서 갈려야 한다.
 *
 * 원인 원문은 서버 로그에만 남는다. 운영자는 Vercel 함수 로그에서 `[ai]` 로 찾는다.
 */

export type AiErrorKind =
  /** 키·잔액·모델 이름 등 설정 문제. 사용자가 다시 눌러도 소용없다. */
  | 'config'
  /** 일시적인 혼잡. 잠시 뒤 다시 하면 된다. */
  | 'busy'
  /** 한 번에 만들기엔 요청이 크다. 범위를 좁히면 된다. */
  | 'too-long'
  /** 형식이 어긋났다. 대개 다시 시도하면 풀린다. */
  | 'format'
  /** 모델이 요청을 거절했다. */
  | 'refused'
  /** 그 밖의 실패. */
  | 'unknown';

const MESSAGE: Record<AiErrorKind, string> = {
  config: 'AI 생성 설정에 문제가 있습니다. 관리자에게 알려 주세요.',
  busy: '지금 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.',
  'too-long':
    '한 번에 만들기에는 요청이 큽니다. 범위를 나눠서 다시 시도해 주세요. (예: 기능 두세 개씩)',
  format: '결과를 정리하지 못했습니다. 다시 시도해 주세요.',
  refused: '이 요청은 처리할 수 없습니다. 내용을 다르게 적어 다시 시도해 주세요.',
  unknown: '지금 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/**
 * 사용자에게 보일 문장을 이미 정해 둔 오류.
 *
 * `message` 가 곧 화면에 나가는 문장이다. 모델 이름이나 환경변수 이름이
 * 여기 들어가면 안 된다.
 */
export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, detail?: unknown) {
    super(MESSAGE[kind]);
    this.name = 'AiError';
    this.kind = kind;
    // 원인은 화면이 아니라 로그로 간다.
    if (detail !== undefined) console.error('[ai]', kind, detail);
  }
}

/** 어떤 예외든 사용자에게 보여도 되는 문장으로 만든다. */
export function aiErrorMessage(error: unknown): string {
  if (error instanceof AiError) return error.message;
  console.error('[ai] unclassified', error);
  return MESSAGE.unknown;
}
