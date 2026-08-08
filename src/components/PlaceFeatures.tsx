'use client';

/**
 * 화면에 배치되지 않은 기능을 정보구조도에 이어 붙이는 창.
 *
 * 기존 목록 창은 "이런 게 남았습니다" 만 알려 주고 끝났다. 사용자는 트리를 뒤져
 * 화면마다 상세를 열고 체크해야 했다. 여기서는 AI 가 자리를 제안하고, 사용자가
 * 하나씩 골라 반영한다.
 *
 * **고른 것만, 덧붙이기만 한다.** 기존 화면의 이름·경로·설명은 건드리지 않고
 * 무엇도 지우지 않는다. 반영 직전 상태는 버전으로 남겨 되돌릴 수 있게 한다.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, PlusCircle, Sparkles, Wand2 } from 'lucide-react';

import { usePlannerStore } from '@/lib/store';
import { refreshCredits, useCredits } from '@/lib/useCredits';
import {
  applyPlacements,
  isPurelyAdditive,
  toView,
  unplacedFeatures,
  type Placement,
} from '@/lib/ia/placement';
import { stampWireframes } from '@/lib/ia/wireframe-sync';
import { PLACEMENT_CREDIT_COST, type Plan } from '@/lib/types';
import { Modal, RegenerateTag, Spinner, useToast } from './ui';

export function PlaceFeaturesModal({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan: Plan;
  onClose: () => void;
}) {
  const toast = useToast();
  const { remaining: credits } = useCredits();
  const applyDocuments = usePlannerStore((s) => s.applyDocuments);
  const saveVersion = usePlannerStore((s) => s.saveVersion);

  const [busy, setBusy] = useState(false);
  const [placements, setPlacements] = useState<Placement[] | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const targets = unplacedFeatures(plan);
  const outOfCredits = credits < PLACEMENT_CREDIT_COST;

  // 창을 닫으면 제안을 버린다. 다음에 열 때 문서가 달라져 있을 수 있다.
  useEffect(() => {
    if (!open) {
      setPlacements(null);
      setMissed([]);
      setChosen(new Set());
    }
  }, [open]);

  const propose = async () => {
    if (outOfCredits) {
      toast('크레딧이 부족합니다. 내일 다시 충전됩니다.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/place', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as {
        placements?: Placement[];
        missed?: string[];
        error?: string;
      };
      if (!res.ok) {
        toast(data.error ?? '제안을 받지 못했습니다.', 'danger');
        return;
      }
      // 값은 서버가 받은 뒤에 뺐다. 여기서는 바뀐 잔량을 다시 물어보기만 한다.
      void refreshCredits();
      const list = data.placements ?? [];
      setPlacements(list);
      setMissed(data.missed ?? []);
      setChosen(new Set(list.map((p) => p.featureId)));
      if (list.length === 0) toast('배치할 자리를 찾지 못했습니다.', 'warn');
    } catch {
      toast('서버에 연결하지 못했습니다.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!placements) return;
    const picked = placements.filter((p) => chosen.has(p.featureId));
    if (picked.length === 0) return;

    /*
     * 배치하기 **전의** 기능 구성을 와이어프레임에 새겨 둔다.
     *
     * 이 값이 있어야 나중에 "그림을 만든 뒤 무엇이 더 붙었는지" 를 비교할 수 있다.
     * 배치한 뒤에 새기면 늘어난 기능까지 포함되어 뒤처짐을 영영 못 알아본다.
     */
    const wireframes = stampWireframes(plan.iaPages, plan.wireframes);
    const iaPages = applyPlacements(plan, picked);

    /*
     * 덧붙이기만 했는지 한 번 더 확인한다. 여기서 걸리면 코드가 잘못된 것이므로
     * 사용자 문서를 건드리지 않고 멈춘다. 데이터가 걸린 자리라 결과를 믿지 않는다.
     */
    if (!isPurelyAdditive(plan.iaPages, iaPages)) {
      toast('기존 화면이 바뀌는 결과라 반영하지 않았습니다.', 'danger');
      return;
    }

    // 되돌릴 지점을 먼저 남긴다.
    saveVersion(plan.id, '화면 배치 전');
    applyDocuments(plan.id, { iaPages, wireframes });

    const added = iaPages.length - plan.iaPages.length;
    toast(
      `기능 ${picked.length}개를 배치했습니다.${added > 0 ? ` 새 화면 ${added}개가 생겼습니다.` : ''}`,
      'ok',
    );
    onClose();
  };

  const views = placements?.map((p) => ({ placement: p, view: toView(plan, p) })) ?? [];
  const pickedCount = views.filter(({ view }) => chosen.has(view.featureId)).length;

  return (
    <Modal
      open={open}
      title="화면에 배치되지 않은 기능"
      description={
        placements
          ? '반영할 것만 체크하세요. 기존 화면은 바뀌지 않고, 기능 연결만 더해집니다.'
          : '이 기능들은 아직 어느 화면에서도 쓰이지 않습니다. AI 에게 자리를 물어보거나, 트리에서 직접 연결할 수 있습니다.'
      }
      onClose={onClose}
      width={640}
      footer={
        placements ? (
          <>
            <button className="btn" onClick={onClose}>
              닫기
            </button>
            <button className="btn btn-primary" onClick={apply} disabled={pickedCount === 0}>
              <Check size={14} />
              {pickedCount}개 배치하기
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              닫기
            </button>
            <button
              className={busy ? 'btn btn-primary is-busy' : 'btn btn-primary'}
              onClick={() => void propose()}
              disabled={busy || targets.length === 0 || outOfCredits}
              title={outOfCredits ? '크레딧이 부족합니다' : undefined}
            >
              {busy ? <Spinner size={14} /> : <Wand2 size={14} />}
              {busy ? '자리 찾는 중' : `AI로 배치하기 (${PLACEMENT_CREDIT_COST} 크레딧)`}
            </button>
          </>
        )
      }
    >
      {targets.length === 0 ? (
        <p className="text-[13px] text-[var(--fg-muted)]">모든 기능이 화면에 배치되었습니다.</p>
      ) : placements ? (
        <div className="flex flex-col gap-2">
          {views.length === 0 && (
            <p className="text-[13px] text-[var(--fg-muted)]">
              배치할 자리를 찾지 못했습니다. 트리에서 직접 연결해 주세요.
            </p>
          )}
          <ul className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
            {views.map(({ view }) => (
              <li key={view.featureId}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 hover:border-[var(--border-strong)]">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                    checked={chosen.has(view.featureId)}
                    onChange={(e) => {
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(view.featureId);
                        else next.delete(view.featureId);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{view.featureName}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--fg-muted)]">
                      <span aria-hidden>→</span>
                      <span className="font-semibold text-[var(--fg)]">{view.target}</span>
                      {view.isNew && (
                        <span className="chip chip-primary">
                          <PlusCircle size={10} />
                          새 화면
                        </span>
                      )}
                    </p>
                    {view.reason && (
                      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                        {view.reason}
                      </p>
                    )}
                  </div>
                </label>
              </li>
            ))}
          </ul>

          {missed.length > 0 && (
            <p
              className="rounded-lg px-3 py-2 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
            >
              <AlertTriangle size={11} className="mr-1 inline" />
              자리를 정하지 못한 기능이 있습니다: {missed.join(', ')}. 트리에서 직접 연결해 주세요.
            </p>
          )}
        </div>
      ) : (
        <ul className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
          {targets.map((feature) => (
            <li
              key={feature.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="id-tag">{feature.id}</span>
                <span className="text-[13px] font-semibold">{feature.name}</span>
              </div>
              {feature.description && (
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                  {feature.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** 정보구조도 상단에 뜨는 안내 칩. 누르면 위 창이 열린다. */
export function UnplacedChip({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button
      className="chip chip-warn h-auto cursor-pointer self-start py-1 text-left"
      onClick={onClick}
    >
      <Sparkles size={12} />
      화면에 배치되지 않은 기능 {count}개 — 배치하기
      <RegenerateTag />
    </button>
  );
}
