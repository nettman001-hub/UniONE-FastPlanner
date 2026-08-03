'use client';

/**
 * 이어서 만들기 안내.
 *
 * 전체 자동 생성 도중 창을 닫으면 서버는 **그때 돌던 단계까지만 마치고 멈춘다.**
 * 만들어진 것은 그대로 보관되고, 돌아왔을 때 이 띠가 떠서 다음 단계부터 이어 갈 수 있다.
 *
 * 어느 화면에서 돌아오든 보이도록 워크스페이스 셸에 붙인다.
 */

import { PlayCircle, X } from 'lucide-react';
import { remainingOf, type JobProgress } from '@/lib/jobs/progress';
import { ARTIFACT_CREDIT_COST, ARTIFACT_LABEL } from '@/lib/types';

export function ResumeBanner({
  job,
  onResume,
  onDiscard,
}: {
  job: JobProgress;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const rest = remainingOf(job);
  if (rest.length === 0) return null;

  const cost = rest.reduce((sum, a) => sum + ARTIFACT_CREDIT_COST[a], 0);

  return (
    <div className="no-print border-b border-[var(--border)] bg-[var(--warn-soft)] px-4 py-2.5">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold">
            전체 자동 생성이 {job.done.length}/{job.artifacts.length} 단계에서 멈췄습니다
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">
            창을 닫아 이어 갈 곳이 없어졌습니다. 만들어진 것은 그대로 있고,
            남은 <strong>{rest.map((a) => ARTIFACT_LABEL[a]).join(' · ')}</strong> 부터 이어서
            만들 수 있습니다. ({cost} 크레딧)
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button className="btn btn-ghost btn-sm" onClick={onDiscard}>
            <X size={13} />
            그만두기
          </button>
          <button className="btn btn-primary btn-sm" onClick={onResume}>
            <PlayCircle size={13} />
            이어서 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
