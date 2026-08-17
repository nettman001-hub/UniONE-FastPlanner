'use client';

/**
 * 만들기 — 어느 엔진으로 만들지.
 *
 * **어떤 회사의 어떤 모델인지는 여기 적지 않는다.** 알아도 할 수 있는 일이 없고,
 * 대신 서비스 내부 구성이 드러난다. 모델을 갈아 끼울 때마다 이 화면을 따라
 * 고쳐야 하는 것도 문제다.
 *
 * 그래서 고르는 기준을 **결과로** 적는다 — 빠른 쪽인가, 꼼꼼한 쪽인가.
 * 그리고 언제 쓰면 좋은지를 함께 둔다. 이름만 `기본`·`고급` 이라고 두면
 * "그럼 늘 고급이 낫겠네" 로 끝나고, 고르는 의미가 없어진다.
 */

import { useEffect, useState } from 'react';
import { Check, Gauge, Info, Zap } from 'lucide-react';

import { Panel } from '@/components/settings/Parts';
import { Spinner, useToast } from '@/components/ui';
import {
  DEFAULT_ENGINE,
  ENGINE_LABEL,
  ENGINE_TIERS,
  ENGINE_WHAT,
  ENGINE_WHEN,
  toEngineTier,
  type EngineTier,
} from '@/lib/ai/engines';

const ICON: Record<EngineTier, typeof Zap> = { basic: Zap, advanced: Gauge };

export default function GenerationSettings() {
  const toast = useToast();
  const [engine, setEngine] = useState<EngineTier>(DEFAULT_ENGINE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EngineTier | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: { settings?: { engine?: unknown } }) => {
        if (alive) setEngine(toEngineTier(d.settings?.engine));
      })
      .catch(() => {
        if (alive) toast('설정을 불러오지 못했습니다.', 'warn');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [toast]);

  /*
   * 고르는 즉시 저장한다. 둘 중 하나를 고르는 일에 저장 버튼까지 누르게 하면,
   * 안 누르고 나가서 반영이 안 된다.
   */
  const pick = async (next: EngineTier) => {
    if (next === engine || saving) return;
    const before = engine;
    setEngine(next);
    setSaving(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEngine(before);
        toast(data.error ?? '저장하지 못했습니다.', 'warn');
        return;
      }
      toast(`${ENGINE_LABEL[next]}으로 만듭니다.`, 'ok');
    } catch {
      setEngine(before);
      toast('저장하지 못했습니다.', 'warn');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="empty" style={{ minHeight: '40vh' }}>
        <Spinner size={18} />
      </div>
    );
  }

  return (
    <>
      <Panel
        title="만들기 엔진"
        description="AI가 문서를 만들 때 얼마나 오래 생각할지 정합니다. 지금 고른 것이 모든 플랜에 적용됩니다."
      >
        <div className="flex flex-col gap-2">
          {ENGINE_TIERS.map((tier) => {
            const Icon = ICON[tier];
            const on = engine === tier;
            return (
              <button
                key={tier}
                type="button"
                aria-pressed={on}
                disabled={saving !== null}
                onClick={() => void pick(tier)}
                className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                  on
                    ? 'border-[var(--primary-border)] bg-[var(--primary-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-strong)]'
                }`}
              >
                <span
                  className={`mt-0.5 shrink-0 ${on ? 'text-[var(--primary)]' : 'text-[var(--fg-subtle)]'}`}
                >
                  {saving === tier ? <Spinner size={16} /> : <Icon size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-[13.5px] tracking-tight">{ENGINE_LABEL[tier]}</b>
                    {on && (
                      <span className="chip chip-primary">
                        <Check size={11} />
                        쓰는 중
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                    {ENGINE_WHAT[tier]}
                  </span>
                  <span className="mt-1.5 block text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                    {ENGINE_WHEN[tier].map((line) => (
                      <span key={line} className="block">
                        · {line}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="알아 두실 것">
        <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--fg-subtle)]" />
          <div className="min-w-0 text-[12px] leading-relaxed text-[var(--fg-muted)]">
            <p>
              <b>크레딧은 똑같이 듭니다.</b> 어느 쪽을 고르셔도 산출물마다 드는 크레딧은
              변하지 않습니다. 달라지는 것은 <b>걸리는 시간과 문서의 촘촘함</b>입니다.
            </p>
            <p className="mt-1.5">
              {/*
                고르고 나서 "이미 만든 것도 바뀌나?" 를 반드시 궁금해한다.
                안 적어 두면 다시 만들어 보고 나서야 알게 된다.
              */}
              이미 만들어 둔 문서는 <b>그대로 있습니다.</b> 바꾼 뒤에 만드는 것부터
              적용됩니다.
            </p>
            <p className="mt-1.5">
              두 엔진 모두 <b>가장 깊게 생각하도록</b> 맞춰 두었습니다. 등급 차이는
              엔진 자체의 크기 차이입니다.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
