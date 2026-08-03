/**
 * 가입 정책.
 *
 * 배포된 주소는 누구나 열 수 있고, AI 생성은 주인의 API 키로 돈다. 그래서
 * **기본값은 "가입 닫힘"** 이다. 열려면 환경변수로 명시해야 한다.
 *
 * | 설정 | 결과 |
 * | --- | --- |
 * | 아무것도 없음 | 가입 불가. 공용 테스트 계정으로만 들어온다. |
 * | `SIGNUP_CODE=...` | 그 초대 코드를 아는 사람만 가입 |
 * | `ALLOW_SIGNUP=1` | 누구나 가입 |
 */

export type SignupMode = 'closed' | 'code' | 'open';

export function signupMode(): SignupMode {
  if (process.env.SIGNUP_CODE) return 'code';
  if (process.env.ALLOW_SIGNUP === '1') return 'open';
  return 'closed';
}

/** 가입 요청을 받아 줄지 판단한다. 거절 사유 문자열, 통과면 null. */
export function signupProblem(code: string | undefined): string | null {
  const mode = signupMode();
  if (mode === 'open') return null;
  if (mode === 'closed') {
    return '지금은 새 계정을 만들 수 없습니다. 관리자에게 테스트 계정을 요청하세요.';
  }
  if (!code?.trim()) return '초대 코드를 입력해 주세요.';
  if (code.trim() !== process.env.SIGNUP_CODE) return '초대 코드가 올바르지 않습니다.';
  return null;
}
