import { NextResponse } from 'next/server';
import { resolveProvider } from '@/lib/ai/client';
import { getDb, hasDatabase } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 헤더에 현재 생성 공급자를 표시하기 위한 엔드포인트. 키는 내려보내지 않는다.
 *
 * `?check=1` 을 붙이면 **설치 점검**을 함께 돌린다. 배포한 사람이 브라우저 주소창만으로
 * 무엇이 잘못됐는지 볼 수 있어야 하기 때문이다. 사용자 화면에는 안전한 문장만 보이므로,
 * 원인을 확인할 곳이 따로 있어야 한다.
 *
 * 참·거짓과 미리 정해 둔 안내 문구만 돌려준다. 접속 문자열·키·드라이버 원문은 담지 않는다.
 */
export async function GET(request: Request) {
  const provider = resolveProvider();
  const base = {
    mode: provider.id === 'local' ? 'local' : 'ai',
    provider: provider.id,
    label: provider.label,
    model: provider.model || null,
  };

  const url = new URL(request.url);
  if (url.searchParams.get('check') !== '1') return NextResponse.json(base);

  return NextResponse.json({
    ...base,
    checks: {
      // 값은 보지 않고 "쓸 만한 길이로 들어 있는가" 만 본다.
      authSecret: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16),
      testerAccount: Boolean(process.env.TESTER_EMAIL && process.env.TESTER_PASSWORD),
      signup: process.env.SIGNUP_CODE ? 'code' : process.env.ALLOW_SIGNUP === '1' ? 'open' : 'closed',
      database: await checkDatabase(),
    },
  });
}

async function checkDatabase(): Promise<{ configured: boolean; ok: boolean; hint: string }> {
  if (!hasDatabase()) {
    return {
      configured: false,
      ok: false,
      hint: 'DATABASE_URL 이 없습니다. 플랜이 계정에 저장되지 않습니다.',
    };
  }
  try {
    const db = await getDb();
    await db.query('select 1');
    return { configured: true, ok: true, hint: '정상' };
  } catch (error) {
    console.error('[status/check] database', error);
    return { configured: true, ok: false, hint: databaseHint(error) };
  }
}

/**
 * 드라이버 오류를 고칠 방법이 보이는 문장으로 바꾼다.
 *
 * 원문(`password authentication failed for user "postgres"`)은 무슨 뜻인지도, 어디를
 * 고쳐야 하는지도 알 수 없다. 실제로 겪은 것들을 하나씩 옮겨 둔다.
 */
function databaseHint(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const message = error instanceof Error ? error.message : '';

  if (code === '28P01' || /password authentication failed/i.test(message)) {
    return 'DATABASE_URL 의 비밀번호가 맞지 않습니다. [YOUR-PASSWORD] 자리에 Supabase 데이터베이스 비밀번호를 넣었는지, 특수문자가 섞이지 않았는지 확인하세요.';
  }
  if (code === '28000') {
    return 'DATABASE_URL 의 접속 계정이 맞지 않습니다. Supabase Connect 화면의 Transaction pooler 주소를 다시 복사하세요.';
  }
  if (code === '3D000') {
    return 'DATABASE_URL 끝의 데이터베이스 이름이 맞지 않습니다. 보통 /postgres 로 끝납니다.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'DATABASE_URL 의 주소를 찾지 못했습니다. 오타가 없는지 확인하세요.';
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return '연결되지 않습니다. 포트가 6543(Transaction pooler)인지, Supabase 프로젝트가 일시 정지되지 않았는지 확인하세요. 무료 플랜은 일주일 넘게 쓰지 않으면 멈춥니다.';
  }
  return '데이터베이스에 연결하지 못했습니다. 배포 로그에서 [status/check] 를 찾아보세요.';
}
