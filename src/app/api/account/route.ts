/**
 * 내 계정 고치기 · 지우기.
 *
 * `/api/auth/*` 는 **들어오고 나가는 일**(로그인·가입·로그아웃)을 맡고, 여기는
 * 이미 들어온 사람이 **자기 것을 고치는 일**을 맡는다. 갈라 두는 이유는 앞쪽이
 * 로그인 전에도 열려 있어야 하는 반면 여기는 전부 로그인이 있어야 하기 때문이다.
 */

import { NextResponse } from 'next/server';

import { endSession, requireUser, startSession } from '@/lib/auth/server';
import { deleteUser, findUserById, toPublicUser, updateUserName } from '@/lib/db/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAME_MAX = 40;

/** 이름 바꾸기. */
export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: '이름을 입력해 주세요.' }, { status: 400 });
  if (name.length > NAME_MAX) {
    return NextResponse.json({ error: `이름은 ${NAME_MAX}자까지입니다.` }, { status: 400 });
  }

  const row = await updateUserName(user.id, name);
  if (!row) return NextResponse.json({ error: '계정을 찾지 못했습니다.' }, { status: 404 });

  /*
   * 세션 쿠키에 이름이 들어 있다. 다시 발급하지 않으면 화면만 바뀌고 다음
   * 새로고침에 옛 이름으로 돌아온다 — 저장이 안 된 것처럼 보인다.
   */
  const publicUser = toPublicUser(row);
  await startSession(publicUser);
  return NextResponse.json({ user: publicUser });
}

/**
 * 계정 지우기.
 *
 * 플랜과 연동 자격증명이 함께 사라진다. **되돌릴 수 없다.** 그래서 지우려는
 * 사람이 자기 이메일을 그대로 적게 한다 — 실수로 누르는 것을 막는 마지막 문턱이다.
 */
export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const typed = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (typed !== user.email.toLowerCase()) {
    return NextResponse.json({ error: '이메일이 일치하지 않습니다.' }, { status: 400 });
  }

  // 세션에 담긴 계정이 이미 사라졌을 수도 있다. 없으면 조용히 끝낸다.
  if (await findUserById(user.id)) await deleteUser(user.id);
  await endSession();
  return NextResponse.json({ ok: true });
}
