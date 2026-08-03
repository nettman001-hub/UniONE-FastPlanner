/**
 * 화면과 서버가 함께 쓰는 규칙.
 *
 * 해시 계산(`password.ts`)은 `node:crypto` 를 쓰기 때문에 브라우저 번들에 들어가면
 * 빌드가 깨진다. 그래서 양쪽이 같이 봐야 하는 값만 여기에 따로 둔다.
 */

export const PASSWORD_MIN_LENGTH = 8;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }
  return null;
}
