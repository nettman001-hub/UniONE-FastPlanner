'use client';

/**
 * **어디에 있든 "○○ 작업중" 을 보여 준다.**
 *
 * 오래 걸리는 일이 이제 화면 밖에서 돈다. 스티치에 스무 개를 걸어 놓고 홈으로
 * 나가도 계속 만들어진다. 그런데 나간 자리에 아무 표시가 없으면 **돌고 있는 줄을
 * 모른다.** 모르면 브라우저를 닫고, 닫으면 십오 분이 날아간다.
 *
 * 그래서 앱 전체에 하나 띄운다. 눌러서 그 일이 보이는 화면으로 바로 갈 수 있게 한다.
 *
 * 자리는 왼쪽 아래다. 알림(가운데 아래)보다 낮게 깔아, 알림이 뜨는 잠깐 동안은
 * 알림이 위로 오게 한다. 알림은 곧 사라지고 이것은 남는다.
 */

import Link from 'next/link';
import { Loader2 } from 'lucide-react';

import { ClientOnly } from './ui';
import { usePlannerStore } from '@/lib/store';
import { useWorking } from '@/lib/working';

function Badges() {
  const working = useWorking();
  const plans = usePlannerStore((s) => s.plans);

  if (working.length === 0) return null;

  return (
    <div className="no-print fixed bottom-4 left-4 z-[80] flex flex-col items-start gap-1.5">
      {working.map((job) => {
        /*
         * 이름을 못 찾는 경우가 있다 — 아직 안 불러온 플랜, 지운 플랜.
         * 그렇다고 표시를 지우면 "돌고 있다" 는 사실 자체가 사라진다.
         * 이름은 못 밝혀도 돌고 있다는 것은 밝힌다.
         */
        const name = plans.find((p) => p.id === job.planId)?.brief.title?.trim();
        return (
          <Link
            key={job.key}
            href={job.href}
            className="flex max-w-[min(88vw,340px)] items-center gap-1.5 rounded-full border border-[var(--primary-border)] bg-[var(--surface)] px-3 py-1.5 text-[11.5px] font-semibold shadow-md"
            title="누르면 작업 중인 화면으로 갑니다."
          >
            <Loader2 size={12} className="spin shrink-0 text-[var(--primary)]" />
            <span className="truncate">
              {name ? `${name} · ` : ''}
              {job.what}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function WorkingBadge() {
  /*
   * 플랜 이름은 브라우저에 저장된 것에서 온다. 서버에서 그린 것과 달라져
   * 하이드레이션이 어긋나므로 붙은 뒤에 그린다.
   */
  return (
    <ClientOnly>
      <Badges />
    </ClientOnly>
  );
}
