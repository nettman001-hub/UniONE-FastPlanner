import { NextResponse } from 'next/server';
import { isStale, jobStore } from '@/lib/jobs/store';

export const runtime = 'nodejs';

/** 작업 하나의 현재 상태. 브라우저가 이걸 주기적으로 물어보며 결과를 받아 간다. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await jobStore().get(id);

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

  return NextResponse.json(job);
}
