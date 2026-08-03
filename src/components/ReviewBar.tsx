'use client';

/**
 * AI 제안 검토 바.
 *
 * 검토 대기 항목이 하나라도 있으면 화면 하단에 떠서, 하나씩 넘겨 보며
 * 승인하거나 거절하게 한다. 승인/거절하면 그 항목이 목록에서 빠지므로
 * 같은 자리에 다음 항목이 올라온다 — 계속 누르면 끝까지 처리된다.
 */

import { Check, ChevronLeft, ChevronRight, Layers, X } from 'lucide-react';
import type { PendingItem } from '@/lib/fs-review';

const KIND_LABEL: Record<PendingItem['kind'], string> = {
  requirement: '요구사항',
  feature: '기능',
  specification: '상세 기능',
};

export function NewBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-md bg-[var(--primary-soft)] px-1 py-px text-[9.5px] font-bold text-[var(--primary)] ${className}`}
      title="AI 가 만든 검토 대기 항목입니다"
    >
      신규
    </span>
  );
}

export function ReviewBar({
  items,
  index,
  onIndexChange,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
}: {
  items: PendingItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onApprove: (item: PendingItem) => void;
  onReject: (item: PendingItem) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
}) {
  if (items.length === 0) return null;

  const safeIndex = Math.min(index, items.length - 1);
  const current = items[safeIndex];

  return (
    <div className="pointer-events-none sticky bottom-3 z-20 mt-4 flex justify-center">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 shadow-lg">
        <div className="flex items-center gap-1 border-r border-[var(--border)] pr-1.5">
          <button
            className="btn btn-ghost btn-sm"
            onClick={onApproveAll}
            title={`검토 대기 ${items.length}개를 모두 승인합니다`}
          >
            <Layers size={13} />
            일괄 승인
          </button>
          <button
            className="btn btn-ghost btn-sm text-[var(--danger)]"
            onClick={onRejectAll}
            title={`검토 대기 ${items.length}개를 모두 거절(삭제)합니다`}
          >
            일괄 거절
          </button>
        </div>

        <button
          className="btn btn-ghost btn-sm px-1"
          disabled={safeIndex === 0}
          onClick={() => onIndexChange(safeIndex - 1)}
          aria-label="이전 항목"
        >
          <ChevronLeft size={14} />
        </button>

        <span className="whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-[var(--fg-muted)]">
          {safeIndex + 1} / {items.length}
        </span>

        <NewBadge />
        <span className="chip shrink-0">{KIND_LABEL[current.kind]}</span>
        <span className="max-w-[220px] truncate text-[12px] font-semibold" title={current.label}>
          {current.label}
        </span>

        <button
          className="btn btn-ghost btn-sm px-1"
          disabled={safeIndex >= items.length - 1}
          onClick={() => onIndexChange(safeIndex + 1)}
          aria-label="다음 항목"
        >
          <ChevronRight size={14} />
        </button>

        <div className="flex items-center gap-1 border-l border-[var(--border)] pl-1.5">
          <button className="btn btn-sm" onClick={() => onReject(current)} title="이 항목을 지웁니다">
            <X size={13} />
            거절
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onApprove(current)}>
            <Check size={13} />
            승인
          </button>
        </div>
      </div>
    </div>
  );
}
