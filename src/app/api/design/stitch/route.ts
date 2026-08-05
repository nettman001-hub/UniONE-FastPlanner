/**
 * 스티치 연결 상태를 다룬다.
 *
 * **자격증명은 나가지 않는다.** 저장은 받고, 조회는 "연결됨 + 꼬리표" 만 준다.
 * 한 번 넣은 값을 다시 읽어 갈 방법은 없다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import {
  integrationStatus,
  removeIntegration,
  saveIntegration,
} from '@/lib/db/integrations';
import { detectCredential, StitchError } from '@/lib/design/stitch';

export const runtime = 'nodejs';

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    return NextResponse.json(await integrationStatus(user.id, 'stitch'));
  } catch {
    // 데이터베이스가 없는 환경(로컬 전용)에서는 연결이 없는 것과 같다.
    return NextResponse.json({ connected: false, label: '', updatedAt: null });
  }
}

export async function PUT(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { secret?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  if (!secret) {
    return NextResponse.json({ error: '연결에 쓸 값을 입력해 주세요.' }, { status: 400 });
  }
  // 사람이 실수로 다른 것을 붙여 넣는 일이 잦다. 길이만 최소한으로 본다.
  if (secret.length < 20) {
    return NextResponse.json({ error: '값이 너무 짧습니다. 복사한 내용을 다시 확인해 주세요.' }, { status: 400 });
  }

  /*
   * 저장하기 전에 **실제로 스티치에 물어본다.**
   *
   * 예전에는 받은 값을 그대로 넣었다. 그래서 "연결됨" 이라고 떠 놓고 정작
   * 만들기를 누르면 실패했다 — 사용자가 무엇이 잘못됐는지 알 방법이 없었다.
   * 여기서 한 번 확인하면 그 자리에서 알 수 있고, 어느 헤더로 보내야 하는
   * 값인지도 함께 알아낸다.
   */
  let kind: string;
  try {
    kind = await detectCredential(secret, process.env.STITCH_QUOTA_PROJECT || undefined);
  } catch (error) {
    const message =
      error instanceof StitchError
        ? error.message
        : '스티치에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    return NextResponse.json(await saveIntegration(user.id, 'stitch', secret, kind));
  } catch {
    return NextResponse.json({ error: '연결 정보를 저장하지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    await removeIntegration(user.id, 'stitch');
  } catch {
    /* 없으면 지울 것도 없다. */
  }
  return NextResponse.json({ connected: false, label: '', updatedAt: null });
}
