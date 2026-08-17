'use client';

/**
 * 사용량 — 오늘 남은 크레딧과 최근 사용 내역.
 *
 * 숫자는 **서버가 준 것**이다. 예전에는 브라우저가 세고 저장했는데, 서버가 그
 * 값을 믿지 않았으므로 화면의 숫자와 실제가 어긋날 수 있었다.
 *
 * 사용 내역도 이제 나온다 — 쓴 것을 적어 두고 빼서 세기 때문에, 잔량을 세는
 * 일과 내역을 남기는 일이 같은 기록 하나로 끝난다.
 */

import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';

import { Panel, ReadRow } from '@/components/settings/Parts';
import { Spinner } from '@/components/ui';
import { creditKindLabel, type CreditEntry } from '@/lib/credits';
import { refreshCredits, useCredits } from '@/lib/useCredits';
import { ARTIFACT_LABEL, CHAT_CREDIT_COST, PLACEMENT_CREDIT_COST, type ArtifactKey } from '@/lib/types';
import { ENGINE_LABEL } from '@/lib/ai/engines';
import { costOfArtifact, costWithEngine } from '@/lib/credits';
import { useEngine } from '@/lib/useEngine';

const ORDER: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

function when(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '-';
  return time.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function UsageSettings() {
  const { remaining, used, limit, loaded } = useCredits();
  const [usage, setUsage] = useState<CreditEntry[] | null>(null);

  useEffect(() => {
    void refreshCredits();
    let alive = true;
    fetch('/api/credits?history=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { usage?: CreditEntry[] }) => alive && setUsage(d.usage ?? []))
      .catch(() => alive && setUsage([]));
    return () => {
      alive = false;
    };
  }, []);

  /* 값은 등급에 따라 달라진다. 지금 고른 등급으로 적어야 실제와 맞는다. */
  const engine = useEngine();
  const total = ORDER.reduce((sum, key) => sum + costOfArtifact(key, engine), 0);
  const percent = limit > 0 ? Math.round((remaining / limit) * 100) : 0;

  return (
    <>
      <Panel title="오늘 남은 크레딧" description="한국 시각 자정에 다시 채워집니다.">
        <div className="flex items-baseline gap-2">
          <Coins size={18} className="translate-y-0.5 text-[var(--primary)]" />
          {loaded ? (
            <span className="text-[26px] font-extrabold tracking-tight">{remaining}</span>
          ) : (
            <span className="translate-y-1 inline-block">
              <Spinner size={18} />
            </span>
          )}
          <span className="text-[13px] text-[var(--fg-muted)]">/ {limit}</span>
          <span className="chip ml-auto">임시 한도</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          오늘 <b>{used}</b>크레딧을 쓰셨습니다. 정식 요금제를 붙이기 전까지 넉넉하게 열어 둔
          값입니다. 전체 자동 생성 한 번에 <b>{total}크레딧</b>이 드니 하루{' '}
          <b>{Math.floor(limit / total)}번</b>쯤 만드실 수 있습니다.
        </p>
      </Panel>

      <Panel
        title="무엇에 얼마나 드나"
        description={`지금 쓰시는 ${ENGINE_LABEL[engine]} 기준입니다.`}
      >
        {ORDER.map((key) => (
          <ReadRow key={key} label={ARTIFACT_LABEL[key]} value={`${costOfArtifact(key, engine)} 크레딧`} />
        ))}
        <ReadRow label="전체 자동 생성" value={`${total} 크레딧`} hint="다섯 단계를 이어서" />
        <ReadRow
          label="AI 에이전트"
          value={`${costWithEngine(CHAT_CREDIT_COST, engine)} 크레딧`}
          hint="한 번 물을 때마다"
        />
        <ReadRow label="기능 배치" value={`${costWithEngine(PLACEMENT_CREDIT_COST, engine)} 크레딧`} />
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          AI 가 만들지 못해 <b>기본 생성기로 대신했을 때는 크레딧이 들지 않습니다.</b>
        </p>
        {/*
          여기서만 보면 "원래 이만큼 드는구나" 로 읽힌다. 등급을 바꾸면 값도
          바뀐다는 것을 어디로 가면 되는지와 함께 적는다.
        */}
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          <b>고급 엔진은 두 배</b>가 듭니다. <b>설정 → 만들기</b>에서 바꾸실 수 있습니다.
        </p>
      </Panel>

      <Panel title="최근 사용 내역">
        {usage === null ? (
          <div className="py-3">
            <Spinner size={16} />
          </div>
        ) : usage.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--fg-subtle)]">
            아직 쓰신 내역이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col">
            {usage.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--border)] py-2 text-[12px] last:border-b-0"
              >
                <span className="w-28 shrink-0 font-semibold">{creditKindLabel(entry.kind)}</span>
                <span className="min-w-0 flex-1 text-[var(--fg-muted)]">{when(entry.at)}</span>
                <span className="shrink-0 font-semibold text-[var(--fg-muted)]">
                  −{entry.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
