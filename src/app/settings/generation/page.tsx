'use client';

/**
 * 만들기 — 어느 엔진으로 만들지.
 *
 * **여기서 고르면 다섯 단계가 모두 그것으로 맞춰진다.** 단계마다 다르게 쓰고
 * 싶으면 플랜 화면에서 생성 버튼 앞의 단추로 단계별로 바꾼다. 이 화면은
 * "전부 이걸로" 를 한 번에 하는 자리다.
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
  isEngineTier,
  ENGINE_TIERS,
  ENGINE_WHAT,
  ENGINE_WHEN,
  toEngineTier,
  type EngineTier,
} from '@/lib/ai/engines';
import { ENGINE_CREDIT_MULTIPLIER } from '@/lib/credits';
import { ARTIFACT_KEYS } from '@/lib/types';
import { setEngineLocally, setEnginesLocally } from '@/lib/useEngine';

const ICON: Record<EngineTier, typeof Zap> = { basic: Zap, advanced: Gauge };

export default function GenerationSettings() {
  const toast = useToast();
  /**
   * 다섯 단계가 모두 같으면 그 등급, 갈리면 `null`.
   *
   * 하나를 골라 `쓰는 중` 이라고 적으면 나머지 네 단계를 잘못 알려 주는 셈이다.
   */
  const [engine, setEngine] = useState<EngineTier | null>(DEFAULT_ENGINE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EngineTier | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: { settings?: { engine?: unknown; engines?: unknown } }) => {
        if (!alive) return;
        /*
         * **단계별 값을 본다.** `engine` 을 보면 플랜 화면에서 다섯 단계를
         * 고급으로 바꿔 둔 사람에게 여기만 `기본` 이라고 적힌다 — 어느 쪽이
         * 참인지 알 수 없어진다.
         */
        const fallback = toEngineTier(d.settings?.engine);
        const saved = (d.settings?.engines ?? {}) as Record<string, unknown>;
        const map = ARTIFACT_KEYS.map((key) =>
          isEngineTier(saved[key]) ? saved[key] : fallback,
        );
        setEngine(map.every((t) => t === map[0]) ? map[0] : null);
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
      /*
       * `engine` 과 다섯 단계를 **함께** 보낸다. `engine` 만 보내면 이미 단계별로
       * 골라 둔 사람에게는 아무 일도 안 일어난다 — 단계 값이 앞서기 때문이다.
       * 여기서 고른 것이 화면에 안 먹으면 고장으로 읽힌다.
       */
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: next,
          engines: Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, next])),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEngine(before);
        toast(data.error ?? '저장하지 못했습니다.', 'warn');
        return;
      }
      // 값이 적힌 다른 화면들이 바로 따라오게 한다.
      setEngineLocally(next);
      setEnginesLocally(next);
      toast(`다섯 단계 모두 ${ENGINE_LABEL[next]}으로 만듭니다.`, 'ok');
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
        description="여기서 고르면 다섯 단계가 모두 그것으로 맞춰집니다. 단계마다 다르게 쓰려면 플랜 화면에서 단계별로 바꾸세요."
      >
        {/*
          단계마다 다르게 골라 둔 상태에서 여기 아무 표시가 없으면, 어느 것도
          `쓰는 중` 이 아니라 고장으로 읽힌다. **왜 아무것도 안 켜져 있는지**를
          먼저 적는다.
        */}
        {engine === null && (
          <p className="mb-2 rounded-lg border border-[var(--warn-border,var(--border))] bg-[var(--warn-soft)] px-3 py-2.5 text-[12px] leading-relaxed">
            지금은 <b>단계마다 다른 엔진</b>을 쓰고 있습니다. 플랜 화면에서 단계별로 골라
            두신 것입니다. 아래에서 하나를 고르면 <b>다섯 단계가 모두</b> 그것으로
            맞춰집니다.
          </p>
        )}
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
                    {/*
                      값이 몇 배인지를 **고르는 자리에서** 밝힌다. 사용 내역을 보고
                      나서야 알게 되면 속은 기분이 든다.
                    */}
                    <span className={ENGINE_CREDIT_MULTIPLIER[tier] > 1 ? 'chip chip-warn' : 'chip'}>
                      크레딧 {ENGINE_CREDIT_MULTIPLIER[tier]}배
                    </span>
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
              <b>고급 엔진은 크레딧이 두 배 듭니다.</b> 더 큰 엔진이 더 오래 생각하는 만큼
              실제로 드는 값이 다릅니다. 예를 들어 프로덕트 요구사항은 기본 3, 고급 6
              크레딧입니다.
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
            <p className="mt-1.5">
              {/*
                여기서 고른 뒤 플랜 화면에서 단계별로 바꾸면 이 화면과 달라 보인다.
                어느 쪽이 이기는지 미리 밝혀 둔다.
              */}
              <b>단계마다 따로 고를 수 있습니다.</b> 플랜 화면에서 각 단계의 생성 버튼
              앞에 있는 단추로 바꾸며, 그렇게 고른 것이 이 화면의 값보다 앞섭니다.
              여기서 다시 고르면 다섯 단계가 모두 그것으로 되돌아갑니다.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
