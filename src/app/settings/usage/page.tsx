'use client';

/**
 * 사용량 — 오늘 남은 크레딧.
 *
 * 지금은 **읽기만** 한다. 무엇에 얼마나 썼는지는 기록을 안 남기고 있어서
 * 보여 줄 것이 없다. 없는 것을 있는 척하지 않고 그 사실을 적는다.
 */

import { Coins } from 'lucide-react';

import { Panel, ReadRow } from '@/components/settings/Parts';
import { ClientOnly } from '@/components/ui';
import { ARTIFACT_CREDIT_COST, ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';
import { DAILY_CREDIT_LIMIT, usePlannerStore } from '@/lib/store';

const ORDER: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

function Body() {
  const credits = usePlannerStore((s) => s.credits);
  const total = ORDER.reduce((sum, key) => sum + ARTIFACT_CREDIT_COST[key], 0);
  const percent = Math.round((credits / DAILY_CREDIT_LIMIT) * 100);

  return (
    <>
      <Panel title="오늘 남은 크레딧" description="자정에 다시 채워집니다.">
        <div className="flex items-baseline gap-2">
          <Coins size={18} className="translate-y-0.5 text-[var(--primary)]" />
          <span className="text-[26px] font-extrabold tracking-tight">{credits}</span>
          <span className="text-[13px] text-[var(--fg-muted)]">/ {DAILY_CREDIT_LIMIT}</span>
          <span className="chip ml-auto">임시 한도</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          정식 요금제를 붙이기 전까지 넉넉하게 열어 둔 값입니다. 전체 자동 생성 한 번에{' '}
          <b>{total}크레딧</b>이 드니 하루 <b>{Math.floor(DAILY_CREDIT_LIMIT / total)}번</b>쯤
          만드실 수 있습니다.
        </p>
      </Panel>

      <Panel title="무엇에 얼마나 드나">
        {ORDER.map((key) => (
          <ReadRow key={key} label={ARTIFACT_LABEL[key]} value={`${ARTIFACT_CREDIT_COST[key]} 크레딧`} />
        ))}
        <ReadRow label="전체 자동 생성" value={`${total} 크레딧`} hint="다섯 단계를 이어서" />
      </Panel>

      <Panel title="사용 내역" description="언제 무엇을 만들었는지는 아직 남기지 않습니다.">
        <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--fg-subtle)]">
          지금은 남은 크레딧만 셉니다. 무엇에 썼는지 되짚어 볼 수 있게 기록을 남기는 기능을 준비
          중입니다.
        </p>
      </Panel>
    </>
  );
}

export default function UsageSettings() {
  /* 크레딧은 브라우저에 저장된 값이라 서버가 그린 것과 어긋난다. 붙은 뒤에 그린다. */
  return (
    <ClientOnly>
      <Body />
    </ClientOnly>
  );
}
