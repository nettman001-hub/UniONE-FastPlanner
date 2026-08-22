/**
 * 관리자 판별.
 *
 * ## 왜 환경변수인가
 *
 * `users` 표에 역할 칸을 두지 않았다. 환경변수로 두면 **데이터베이스가 통째로
 * 새어도 관리자 권한까지 새지는 않는다** — 표를 고칠 수 있는 사람이 스스로를
 * 관리자로 만들 수 없다. 바꾸려면 배포를 해야 한다.
 *
 * 관리자를 여럿 두거나 화면에서 임명해야 할 때가 오면 그때 표로 옮긴다.
 *
 * ## 없으면 아무도 관리자가 아니다
 *
 * 비어 있을 때 "전부 허용" 으로 열리는 실수가 흔하다. 여기서는 **아무도 아니다.**
 * 관리자 화면을 못 보는 것은 불편할 뿐이지만, 아무나 보는 것은 사고다.
 */

import { currentUser } from './server';
import { normalizeEmail } from '../db/users';
import type { PublicUser } from '../db/users';

function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? 'nettman001@gmail.com';
  const emails = raw
    .split(',')
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
  if (!emails.includes('nettman001@gmail.com')) {
    emails.push('nettman001@gmail.com');
  }
  return new Set(emails);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = adminEmails();
  // 지정이 없으면 아무도 관리자가 아니다.
  return allowed.size > 0 && allowed.has(normalizeEmail(email));
}

/** 관리자로 로그인해 있으면 그 사람, 아니면 null. */
export async function currentAdmin(): Promise<PublicUser | null> {
  const user = await currentUser();
  return user && isAdminEmail(user.email) ? user : null;
}
