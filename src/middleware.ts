/**
 * 설명서는 로그인해야 볼 수 있다.
 *
 * ## 왜 미들웨어인가
 *
 * 다른 화면은 `RequireAuth`(브라우저)로 막는다. 거기서는 그것으로 충분하다 —
 * 정작 내용은 API 로 따로 받아 오고, **그 API 가 서버에서 걸러지기** 때문이다.
 * 화면을 가리는 것은 안내일 뿐이고 진짜 자물쇠는 API 쪽에 있다.
 *
 * 설명서는 다르다. 본문이 **HTML 안에 그대로 실려** 나간다. 브라우저에서 가리면
 * 화면에는 안 보여도 소스에는 다 들어 있어, 주소만 알면 읽힌다. 그래서 그리기
 * 전에 막아야 한다.
 *
 * 레이아웃에서 막을 수도 있지만 레이아웃은 **지금 주소를 알 수 없다.** 그러면
 * 로그인한 뒤 보던 문서로 되돌려 줄 수가 없다. 미들웨어는 주소를 알고, 정적으로
 * 미리 만들어 둔 문서에도 그대로 걸린다 — 설명서는 파일에서 읽어 빌드 때 미리
 * 만들어 두므로, 이 방식이라야 빠른 것을 그대로 두고 막을 수 있다.
 *
 * 세션 확인은 `lib/auth/session.ts` 를 그대로 쓴다. 거기서 Web Crypto 만 쓰기로
 * 해 둔 덕분에 Edge 에서도 같은 코드가 돈다.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

export async function middleware(request: NextRequest) {
  let ok = false;
  try {
    ok = Boolean(await verifySession(request.cookies.get(SESSION_COOKIE)?.value));
  } catch {
    /*
     * `AUTH_SECRET` 이 없으면 여기서 터진다. 그때는 **막는 쪽으로** 넘어간다 —
     * 확인할 수 없다는 것을 통과시켜도 된다는 뜻으로 읽으면 안 된다.
     */
    ok = false;
  }
  if (ok) return NextResponse.next();

  const url = new URL('/login', request.url);
  // 로그인하고 나면 보려던 문서로 돌아간다. 목차로 떨어뜨리면 다시 찾아야 한다.
  url.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/docs', '/docs/:path*'],
};
