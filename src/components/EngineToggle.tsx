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
 * ## 두 가지로 쓴다
 *
 * `artifact` 를 주면 **그 단계 하나만** 바꾼다. 단계마다 원하는 등급이 다르기
 * 때문이다 — 프로덕트 요구사항은 촘촘하게, 정보구조도는 빠르게.
 *
 * 안 주면 **다섯 단계를 한꺼번에** 바꾼다. `전체 자동 생성` 앞에 있는 것이
 * 이쪽이다. 다섯 단계가 서로 다르면 `섞임` 으로 적는다 — 하나를 골라 보여
 * 주면 나머지 네 단계를 잘못 알려 주는 셈이다.
 *
 * ## 말풍선
 *
 * 고급으로 바꾼 순간에만 잠깐 띄운다. 토스트로 띄우면 화면 구석에 떠서 방금 누른
 * 버튼과 연결이 안 되고, 늘 적어 두면 배경처럼 읽혀 아무도 안 본다.
 */

import { useEffect, useRef, useState } from 'react';
import { Gauge, Layers, Zap } from 'lucide-react';

import { useToast } from '@/components/ui';
import { ENGINE_LABEL, type EngineTier } from '@/lib/ai/engines';
import { ENGINE_CREDIT_MULTIPLIER } from '@/lib/credits';
import { setEngineFor, setEnginesLocally, useEngines, type EngineMap } from '@/lib/useEngine';
import { ARTIFACT_KEYS, ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';

/** 말풍선이 떠 있는 시간. 읽을 만큼은 되고, 걸리적거리지는 않을 만큼. */
const BUBBLE_MS = 2600;

/** 다섯 단계가 모두 같으면 그 등급, 다르면 `null`. */
function common(engines: EngineMap): EngineTier | null {
  const first = engines[ARTIFACT_KEYS[0]];
  return ARTIFACT_KEYS.every((key) => engines[key] === first) ? first : null;
}

export function EngineToggle({
  /** 이 단계만 바꾼다. 없으면 다섯 단계를 한꺼번에. */
  artifact,
  disabled = false,
  /**
   * 말풍선을 아래로 띄운다.
   *
   * 카드 머리글은 위가 잘린다(`card` 가 overflow-hidden). 거기서는 위로 띄우면
   * 말풍선이 반쯤 잘려 무슨 말인지 안 보인다.
   */
  below = false,
}: {
  artifact?: ArtifactKey;
  disabled?: boolean;
  below?: boolean;
}) {
  const toast = useToast();
  const engines = useEngines();
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

  /** 이 버튼이 대표하는 등급. 다섯 단계가 갈리면 `null`. */
  const shown: EngineTier | null = artifact ? engines[artifact] : common(engines);

  const toggle = async () => {
    if (busy || disabled) return;
    /*
     * 섞여 있을 때는 **기본으로 모은다.** 어느 하나를 골라 뒤집으면 나머지가
     * 어디로 갈지 누르는 사람이 예측할 수 없다. 싼 쪽으로 모으는 편이,
     * 모르는 사이에 다섯 단계가 두 배가 되는 것보다 낫다.
     */
    const next: EngineTier = shown === null ? 'basic' : shown === 'basic' ? 'advanced' : 'basic';
    const before = engines;

    // 먼저 바꿔 둔다 — 같은 화면의 크레딧 표시가 바로 따라와야 한다.
    if (artifact) setEngineFor(artifact, next);
    else setEnginesLocally(next);

    setBusy(true);
    try {
      const patch = artifact
        ? { [artifact]: next }
        : Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, next]));
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engines: patch }),
      });
      if (!res.ok) {
        setEnginesLocally(before);
        const body = (await res.json()) as { error?: string };
        toast(body.error ?? '엔진을 바꾸지 못했습니다.', 'warn');
        return;
      }
      const times = ENGINE_CREDIT_MULTIPLIER[next];
      if (next === 'advanced') {
        show(artifact ? `크레딧이 ${times}배 듭니다` : `${ARTIFACT_KEYS.length}단계 모두 ${times}배`);
      } else {
        show('크레딧이 원래대로 돌아왔습니다');
      }
    } catch {
      setEnginesLocally(before);
      toast('엔진을 바꾸지 못했습니다.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const advanced = shown === 'advanced';
  const tint = shown === null ? 'var(--fg-muted)' : advanced ? 'var(--warn)' : 'var(--accent)';
  const Icon = shown === null ? Layers : advanced ? Gauge : Zap;
  const label = shown === null ? '섞임' : ENGINE_LABEL[shown];

  const title =
    shown === null
      ? '단계마다 다른 엔진을 골라 두었습니다. 누르면 다섯 단계를 모두 기본 엔진으로 맞춥니다.'
      : advanced
        ? `고급 엔진으로 만듭니다. 더 촘촘하지만 크레딧이 두 배 듭니다. 누르면 ${artifact ? '이 단계를' : '다섯 단계를'} 기본으로 바꿉니다.`
        : `기본 엔진으로 만듭니다. 누르면 ${artifact ? '이 단계를' : '다섯 단계를'} 고급으로 바꿉니다 (크레딧 두 배).`;

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
        title={title}
        /*
          한 화면에 여섯 개가 `기본 엔진` 이라는 같은 이름으로 있으면, 화면을
          안 보고 듣는 사람에게는 여섯 개가 구별되지 않는다. **어느 단계의
          것인지를 이름에 붙인다.**
        */
        aria-label={`${artifact ? ARTIFACT_LABEL[artifact] : '다섯 단계 전체'} 엔진: ${label}`}
      >
        <Icon size={12} />
        {label}
      </button>
    </span>
  );
}
