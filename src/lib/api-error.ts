/**
 * 서버 오류를 사용자에게 보여도 되는 문장으로 바꾼다.
 *
 * 드라이버나 데이터베이스가 던진 원문을 그대로 브라우저로 보내면 두 가지가 잘못된다.
 *
 * 1. **내부 정보가 샌다.** 실제로
 *    `password authentication failed for user "postgres"` 가 로그인 화면에 그대로
 *    떴다. 접속 계정명과 어떤 저장소를 쓰는지가 그대로 노출된다.
 * 2. **사용자가 헛수고한다.** 저 문장은 서버 설정이 잘못됐다는 뜻인데, 화면에서는
 *    자기 비밀번호가 틀린 것처럼 읽힌다. 맞는 비밀번호를 넣고도 계속 다시 시도하게 된다.
 *
 * 그래서 원문은 **서버 로그에만** 남기고, 화면에는 "내 잘못이 아니라 서버 쪽 문제이니
 * 관리자에게 알리라" 는 뜻이 분명한 문장을 보낸다.
 */

/** 사용자에게 보이는 문장. 어느 경로에서 나든 같은 문장을 쓴다. */
export const SERVER_ERROR_MESSAGE =
  '서버에 문제가 있어 지금은 처리할 수 없습니다. 잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요.';

/**
 * 원문을 로그로 넘기고 안전한 문장을 돌려준다.
 *
 * `where` 는 로그에서 어느 경로였는지 찾기 위한 표시다 (예: `auth/login`).
 * Vercel 함수 로그에서 이 표시로 검색하면 실제 원인을 볼 수 있다.
 */
export function serverErrorMessage(where: string, error: unknown): string {
  console.error(`[${where}]`, error);
  return SERVER_ERROR_MESSAGE;
}
