import { NextResponse } from 'next/server';
import { isFinished, isStale, jobStore } from '@/lib/jobs/store';

export const runtime = 'nodejs';

/**
 * 그 플랜의 작업 목록.
 *
 * 화면을 열 때 "내가 맡겨 둔 게 아직 도는가 / 멈춰 있는가"를 확인하는 용도다.
 * 이것 덕분에 탭을 닫았다 돌아와도 진행 중인 생성을 다시 따라가고,
 * 멈춘 작업은 이어서 만들 수 있다.
 *
 * 진행 중인 작업에는 여기서도 **"보고 있다"는 신호**를 남긴다. 목록만 보는 화면에서도
 * 작업이 끊긴 것으로 오해되지 않게 하기 위해서다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const planId = params.get('planId');
  /** 관찰만 하고 "보고 있다" 신호는 남기지 않는다 — 모니터링·검증용. */
  const peek = params.get('peek') === '1';
  if (!planId) {
    return NextResponse.json({ error: 'planId 가 필요합니다.' }, { status: 400 });
  }

  const store = jobStore();
  const now = Date.now();
  const jobs = (await store.listByPlan(planId))
    .filter((job) => !isStale(job))
    // 진행 중·멈춤과, 아직 브라우저가 못 받아 갔을 수 있는 최근 완료분만 넘긴다.
    .filter(
      (job) => !isFinished(job) || job.status === 'paused' || now - job.updatedAt < 5 * 60 * 1000,
    );

  if (!peek) {
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        await store.update(job.id, { lastSeenAt: now });
      }
    }
  }

  return NextResponse.json({ jobs });
}
