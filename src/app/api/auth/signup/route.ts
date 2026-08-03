import { NextResponse } from 'next/server';
import { createUser, findUserByEmail, isEmail, normalizeEmail, toPublicUser } from '@/lib/db/users';
import { passwordProblem } from '@/lib/auth/rules';
import { signupProblem } from '@/lib/auth/policy';
import { startSession } from '@/lib/auth/server';

export const runtime = 'nodejs';

/** 회원가입. 정책상 열려 있을 때만 받는다 (기본은 닫힘). */
export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const denied = signupProblem(body.code);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const email = normalizeEmail(body.email ?? '');
  if (!isEmail(email)) {
    return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const weak = passwordProblem(body.password ?? '');
  if (weak) return NextResponse.json({ error: weak }, { status: 400 });

  try {
    if (await findUserByEmail(email)) {
      return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 });
    }
    const user = await createUser({ email, password: body.password!, name: body.name });
    const publicUser = toPublicUser(user);
    await startSession(publicUser);
    return NextResponse.json({ user: publicUser }, { status: 201 });
  } catch (error) {
    // 같은 순간에 두 번 눌러 unique 제약에 걸린 경우도 여기로 온다.
    const message = error instanceof Error ? error.message : '가입에 실패했습니다.';
    if (/unique|duplicate/i.test(message)) {
      return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
