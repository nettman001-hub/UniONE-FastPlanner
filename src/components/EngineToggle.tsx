'use client';

/**
 * 지금 어느 엔진으로 만드는지 **누르는 자리에서** 보여 주고, 눌러서 바꾼다.
 *
 * ## 왜 생성 버튼 바로 앞인가
 *
 * 설정 안쪽에만 두면 못 찾는다. 값이 두 배 차이 나는데 그것을 모른 채
 * `AI로 생성` 을 누르게 된다. 그래서 **누르기 직전에 눈이 지나가는 자리**에 둔다.
 *
 * 크기는 옆 버튼과 같게(`btn-sm`), 색은 다르게 한다. 같은 색이면 생성 버튼이
 * 둘인 줄 알고 잘못 누른다.
 *
 * | | 색 |
 * | --- | --- |
 * | 기본 엔진 | 청록(`--accent`) |
 * | 고급 엔진 | 주황(`--warn`) — 값이 더 든다는 뜻 |
 *
 * ## 말풍선
 *
 * 고급으로 바꾼 순간에만 잠깐 띄운다. 토스트로 띄우면 화면 구석에 떠서 방금 누른
 * 버튼과 연결이 안 되고, 늘 적어 두면 배경처럼 읽혀 아무도 안 본다.
 */

import { useEffect, useRef, useState } from 'react';
import { Gauge, Zap } from 'lucide-react';

import { useToast } from '@/components/ui';
import { ENGINE_LABEL, type EngineTier } from '@/lib/ai/engines';
import { ENGINE_CREDIT_MULTIPLIER } from '@/lib/credits';
import { setEngineLocally, useEngine } from '@/lib/useEngine';

/** 말풍선이 떠 있는 시간. 읽을 만큼은 되고, 걸리적거리지는 않을 만큼. */
const BUBBLE_MS = 2600;

export function EngineToggle({
  disabled = false,
  /**
   * 말풍선을 아래로 띄운다.
   *
   * 카드 머리글은 위가 잘린다(`card` 가 overflow-hidden). 거기서는 위로 띄우면
   * 말풍선이 반쯤 잘려 무슨 말인지 안 보인다.
   */
  below = false,
}: {
  disabled?: boolean;
  below?: boolean;
}) {
  const toast = useToast();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 떠 있는 채로 화면을 떠나면 타이머가 남는다.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = (text: string) => {
    setBubble(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBubble(null), BUBBLE_MS);
  };

  const toggle = async () => {
    if (busy || disabled) return;
    const before = engine;
    const next: EngineTier = before === 'basic' ? 'advanced' : 'basic';

    // 먼저 바꿔 둔다 — 같은 화면의 크레딧 표시가 바로 따라와야 한다.
    setEngineLocally(next);
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: next }),
      });
      if (!res.ok) {
        setEngineLocally(before);
        const body = (await res.json()) as { error?: string };
        toast(body.error ?? '엔진을 바꾸지 못했습니다.', 'warn');
        return;
      }
      const times = ENGINE_CREDIT_MULTIPLIER[next];
      show(next === 'advanced' ? `크레딧이 ${times}배 듭니다` : '크레딧이 원래대로 돌아왔습니다');
    } catch {
      setEngineLocally(before);
      toast('엔진을 바꾸지 못했습니다.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const advanced = engine === 'advanced';
  const tint = advanced ? 'var(--warn)' : 'var(--accent)';
  const Icon = advanced ? Gauge : Zap;

  return (
    <span className="relative inline-flex">
      {bubble && (
        <span className={below ? 'bubble bubble-below' : 'bubble'} role="status">
          {bubble}
        </span>
      )}
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled || busy}
        style={{ borderColor: tint, color: tint, fontWeight: 700 }}
        onClick={() => void toggle()}
        title={
          advanced
            ? '고급 엔진으로 만듭니다. 더 촘촘하지만 크레딧이 두 배 듭니다. 누르면 기본으로 바꿉니다.'
            : '기본 엔진으로 만듭니다. 누르면 고급으로 바꿉니다 (크레딧 두 배).'
        }
      >
        <Icon size={12} />
        {ENGINE_LABEL[engine]}
      </button>
    </span>
  );
}
