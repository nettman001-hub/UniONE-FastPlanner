'use client';

/**
 * 만들기 엔진을 **누르는 자리 옆에서** 고른다.
 *
 * ## 왜 여기에도 두나
 *
 * 설정 → 만들기에도 같은 것이 있다. 그런데 거기는 한 번 정해 놓고 잊는 자리라,
 * 정작 `AI로 생성` 을 누르는 순간에는 지금 어느 엔진인지 보이지 않는다.
 * **값이 두 배 차이 나는데** 그것을 모른 채 누르게 된다.
 *
 * 그래서 파이프라인 바로 위에 둔다. 고르는 즉시 저장되고, 같은 화면의 단계별
 * 크레딧 표시가 그 자리에서 함께 바뀐다 — 무엇을 고르면 얼마가 되는지가 한눈에
 * 보인다.
 *
 * 설정 화면과 **같은 저장소(`useEngine`)를 본다.** 한쪽에서 바꾸면 다른 쪽도
 * 따라온다.
 */

import { useState } from 'react';
import { Gauge, Zap } from 'lucide-react';

import { Spinner, useToast } from '@/components/ui';
import { ENGINE_LABEL, ENGINE_TIERS, type EngineTier } from '@/lib/ai/engines';
import { ENGINE_CREDIT_MULTIPLIER } from '@/lib/credits';
import { setEngineLocally, useEngine } from '@/lib/useEngine';

const ICON: Record<EngineTier, typeof Zap> = { basic: Zap, advanced: Gauge };

export function EngineSwitch({ disabled = false }: { disabled?: boolean }) {
  const toast = useToast();
  const engine = useEngine();
  const [saving, setSaving] = useState<EngineTier | null>(null);

  const pick = async (next: EngineTier) => {
    if (next === engine || saving) return;
    const before = engine;
    // 먼저 바꿔 둔다 — 이 화면의 크레딧 표시가 바로 따라와야 고르는 의미가 있다.
    setEngineLocally(next);
    setSaving(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: next }),
      });
      if (!res.ok) {
        setEngineLocally(before);
        const body = (await res.json()) as { error?: string };
        toast(body.error ?? '바꾸지 못했습니다.', 'warn');
        return;
      }
      toast(`${ENGINE_LABEL[next]}으로 만듭니다.`, 'ok');
    } catch {
      setEngineLocally(before);
      toast('바꾸지 못했습니다.', 'warn');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <span className="shrink-0 text-[12px] font-semibold text-[var(--fg-muted)]">엔진</span>
      <div className="flex flex-wrap gap-1">
        {ENGINE_TIERS.map((tier) => {
          const Icon = ICON[tier];
          const on = engine === tier;
          return (
            <button
              key={tier}
              type="button"
              aria-pressed={on}
              disabled={disabled || saving !== null}
              className={on ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              onClick={() => void pick(tier)}
              title={
                tier === 'basic'
                  ? '빠르게 만듭니다. 대부분의 기획에는 이걸로 충분합니다.'
                  : '더 오래 생각해서 촘촘하게 만듭니다. 대신 느리고 크레딧이 두 배 듭니다.'
              }
            >
              {saving === tier ? <Spinner size={11} /> : <Icon size={12} />}
              {ENGINE_LABEL[tier]}
            </button>
          );
        })}
      </div>
      {/*
        값이 몇 배인지를 고르는 자리에서 밝힌다. 나중에 사용 내역에서 알게 되면
        속은 기분이 든다.
      */}
      <span className="text-[11.5px] text-[var(--fg-subtle)]">
        {ENGINE_CREDIT_MULTIPLIER[engine] > 1
          ? '고급은 크레딧이 두 배 듭니다. 아래 단계별 값도 그만큼 올라가 있습니다.'
          : '고급으로 바꾸면 더 촘촘해지지만 크레딧이 두 배 듭니다.'}
      </span>
    </div>
  );
}
