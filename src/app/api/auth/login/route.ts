import { NextResponse } from 'next/server';
import { authenticate, ensureTesterAccount, normalizeEmail, testerEmail, toPublicUser } from '@/lib/db/users';
import { clearAttempts, noteFailedAttempt, startSession, tooManyAttempts } from '@/lib/auth/server';
import { serverErrorMessage } from '@/lib/api-error';

export const runtime = 'nodejs';

/** 로그인. 성공하면 세션 쿠키를 심는다. */
export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? '');
  const password = body.password ?? '';
  if (!email || !password) {
    return NextResponse.json({ error: '이메일과 비밀번호를 입력해 주세요.' }, { status: 400 });
  }

  if (tooManyAttempts(email)) {
    return NextResponse.json(
      { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429 },
    );
  }

  try {
    // 공용 테스트 계정은 첫 로그인 때 만들어진다 — 따로 준비할 것이 없게.
    if (email === testerEmail()) await ensureTesterAccount();

    const user = await authenticate(email, password);
    if (!user) {
      noteFailedAttempt(email);
      // 어느 쪽이 틀렸는지 알려주지 않는다 — 가입 여부를 캐낼 수 있기 때문이다.
      return NextResponse.json(
        { error: '이메일 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    clearAttempts(email);
    const publicUser = toPublicUser(user);
    await startSession(publicUser);
    return NextResponse.json({ user: publicUser });
  } catch (error) {
    /*
     * 여기까지 오는 것은 **사용자 잘못이 아니다.** 대개 데이터베이스에 붙지 못한
     * 경우다. 비밀번호가 틀렸다고 알리면 맞는 비밀번호를 넣고도 계속 다시 시도하게
     * 되므로, 서버 문제라는 것이 드러나는 문장을 보낸다. 원인은 로그에만 남긴다.
     */
    return NextResponse.json({ error: serverErrorMessage('auth/login', error) }, { status: 500 });
  }
}
