import { NextResponse } from 'next/server';
import { isStale, jobStore } from '@/lib/jobs/store';

export const runtime = 'nodejs';

/**
 * 작업 하나의 현재 상태.
 *
 * 이 호출 자체가 **"아직 보고 있다"는 신호**다. 시각을 기록해 두고, 작업 실행기는
 * 단계 사이마다 이 값을 확인해 소식이 끊겼으면 다음 단계로 넘어가지 않고 멈춘다.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = jobStore();
  const job = await store.get(id);

  if (!job) {
    // 서버가 재시작됐거나 보관 기간이 지난 경우. 브라우저는 이걸 보고 진행 표시를 푼다.
    return NextResponse.json({ error: '작업을 찾을 수 없습니다.', gone: true }, { status: 404 });
  }

  if (isStale(job)) {
    return NextResponse.json({
      ...job,
      status: 'error',
      error: '작업이 응답하지 않아 중단된 것으로 처리했습니다.',
    });
  }

  const touched = await store.update(id, { lastSeenAt: Date.now() });
  return NextResponse.json(touched ?? job);
}

/** 멈춘 작업을 정리한다 — 이어서 만들었거나, 사용자가 그만두기를 골랐을 때. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await jobStore().remove(id);
  return NextResponse.json({ ok: true });
}
