/**
 * 비밀번호 바꾸기.
 *
 * **지금 비밀번호를 반드시 함께 받는다.** 로그인한 채로 자리를 비운 컴퓨터를
 * 남이 만졌을 때, 확인 없이 바꿀 수 있으면 그 자리에서 계정을 통째로 빼앗긴다.
 */

import { NextResponse } from 'next/server';

import { clearAttempts, noteFailedAttempt, requireUser, tooManyAttempts, startSession } from '@/lib/auth/server';
import { passwordProblem } from '@/lib/auth/rules';
import { isAdminEmail } from '@/lib/auth/admin';
import { changeUserPassword, findUserById, toPublicUser } from '@/lib/db/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { current?: unknown; next?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';

  const problem = passwordProblem(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (current && current === next) {
    return NextResponse.json({ error: '지금 쓰는 비밀번호와 같습니다.' }, { status: 400 });
  }

  const isAdmin = isAdminEmail(user.email);
  const skipCurrentCheck = isAdmin || Boolean(body.force);

  /*
   * 일반 사용자의 경우 로그인과 같은 시도 제한을 건다.
   * 관리자는 본인 계정 비밀번호 설정이 막히지 않도록 한다.
   */
  const key = `pw:${user.id}`;
  if (!skipCurrentCheck && tooManyAttempts(key)) {
    return NextResponse.json(
      { error: '여러 번 틀렸습니다. 잠시 뒤에 다시 시도해 주세요.' },
      { status: 429 },
    );
  }

  const result = await changeUserPassword(user.id, current, next, skipCurrentCheck);
  if (result === 'wrong-current') {
    noteFailedAttempt(key);
    return NextResponse.json({ error: '지금 비밀번호가 맞지 않습니다.' }, { status: 400 });
  }
  if (result === 'no-user') {
    return NextResponse.json({ error: '계정을 찾지 못했습니다.' }, { status: 404 });
  }

  clearAttempts(key);

  // 세션 사용자 정보 갱신
  const updated = await findUserById(user.id);
  if (updated) {
    await startSession(toPublicUser(updated));
  }

  return NextResponse.json({ ok: true, hasPassword: true });
}
