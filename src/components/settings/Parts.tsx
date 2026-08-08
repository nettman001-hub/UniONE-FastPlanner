'use client';

/** 설정 화면들이 함께 쓰는 조각. */

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

/** 설정 한 덩어리. 제목 + 설명 + 내용. */
export function Panel({
  title,
  description,
  children,
  danger,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** 되돌릴 수 없는 일이 들어 있는 덩어리. 테두리로 미리 알린다. */
  danger?: boolean;
}) {
  return (
    <section
      className="card mb-3.5 px-4 py-4"
      style={danger ? { borderColor: 'var(--danger)' } : undefined}
    >
      <h2
        className="text-[13.5px] font-extrabold tracking-tight"
        style={danger ? { color: 'var(--danger)' } : undefined}
      >
        {title}
      </h2>
      {description && (
        <p className="mt-1 mb-3 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          {description}
        </p>
      )}
      <div className={description ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

/**
 * 아직 못 쓰는 자리.
 *
 * **회색으로만 두면 고장으로 읽힌다.** 왜 아직인지 한 줄을 붙이면 "아직 안 만든
 * 것" 으로 읽힌다. 한 줄 차이가 크다.
 */
export function SoonPanel({ title, what, why }: { title: string; what: string; why: string }) {
  return (
    <section className="card px-4 py-5">
      <div className="flex items-center gap-1.5">
        <Lock size={13} className="text-[var(--fg-subtle)]" />
        <h2 className="text-[13.5px] font-extrabold tracking-tight">{title}</h2>
        <span className="chip">준비 중</span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">{what}</p>
      <p className="mt-2.5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--fg-subtle)]">
        {why}
      </p>
    </section>
  );
}

/** 이름 — 값 한 줄. 바꿀 수 없는 것을 보여 줄 때. */
export function ReadRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--border)] py-2.5 last:border-b-0">
      <span className="w-24 shrink-0 text-[12px] font-semibold text-[var(--fg-muted)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] break-all">{value}</span>
      {hint && <span className="text-[11.5px] text-[var(--fg-subtle)]">{hint}</span>}
    </div>
  );
}
