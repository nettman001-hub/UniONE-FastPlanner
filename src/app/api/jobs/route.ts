import { NextResponse } from 'next/server';
import { isFinished, isStale, jobStore } from '@/lib/jobs/store';

export const runtime = 'nodejs';

/**
 * 그 플랜의 작업 목록.
 *
 * 화면을 다시 열었을 때 "내가 맡겨 둔 게 아직 도는가"를 확인하는 용도다.
 * 이것 덕분에 탭을 닫았다 돌아와도 진행 중인 생성을 다시 따라갈 수 있다.
 */
export async function GET(request: Request) {
  const planId = new URL(request.url).searchParams.get('planId');
  if (!planId) {
    return NextResponse.json({ error: 'planId 가 필요합니다.' }, { status: 400 });
  }

  const jobs = await jobStore().listByPlan(planId);
  return NextResponse.json({
    jobs: jobs
      .filter((job) => !isStale(job))
      // 진행 중인 것과, 아직 브라우저가 못 받아 갔을 수 있는 최근 완료분만 넘긴다.
      .filter((job) => !isFinished(job) || Date.now() - job.updatedAt < 5 * 60 * 1000),
  });
}
