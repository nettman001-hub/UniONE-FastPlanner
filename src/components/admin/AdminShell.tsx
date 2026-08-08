'use client';

/** 관리자 화면의 머리글과 차림표. 가르는 일은 서버(layout)가 이미 했다. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ShieldCheck } from 'lucide-react';

import { Logo } from '@/components/Logo';

const TABS = [
  { href: '/admin', name: '대시보드' },
  { href: '/admin/users', name: '사용자' },
  { href: '/admin/health', name: '점검' },
];

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
      <header className="no-print flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="btn btn-ghost btn-sm shrink-0" title="플랜 목록으로">
            <ChevronLeft size={14} />
            <Logo size={18} />
          </Link>
          <span className="hidden shrink-0 text-[var(--fg-subtle)] sm:inline">/</span>
          <h1 className="flex min-w-0 items-center gap-1.5 truncate text-[13.5px] font-extrabold tracking-tight">
            <ShieldCheck size={14} className="shrink-0 text-[var(--primary)]" />
            관리자
          </h1>
        </div>
        <span className="shrink-0 truncate text-[11.5px] text-[var(--fg-muted)]">{email}</span>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-3 py-5 md:py-8">
        <nav className="flex gap-1.5">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold ${
                  active
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                    : 'text-[var(--fg-muted)] hover:bg-[var(--surface-2)]'
                }`}
              >
                {tab.name}
              </Link>
            );
          })}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
