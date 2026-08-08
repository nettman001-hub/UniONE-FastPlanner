'use client';

/**
 * 설정 화면의 껍데기 — 위 머리글 + 왼쪽 차림표.
 *
 * 설정에 해당하는 것들이 그동안 각자 다른 데 박혀 있었다. 스티치 연결은 내보내기
 * 화면 안에, 크레딧은 머리글 칩에, 동기화는 배지에. **한 번 정하면 계속 쓰는 것들**
 * 이라 한자리에 모은다.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, Lock } from 'lucide-react';

import { RequireAuth, SyncBadge, UserMenu } from '@/components/Account';
import { Logo } from '@/components/Logo';
import { SETTINGS_ITEMS } from '@/lib/settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireAuth>
      <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
        <header className="no-print flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="btn btn-ghost btn-sm shrink-0" title="플랜 목록으로">
              <ChevronLeft size={14} />
              <Logo size={18} />
            </Link>
            <span className="hidden shrink-0 text-[var(--fg-subtle)] sm:inline">/</span>
            <h1 className="truncate text-[13.5px] font-extrabold tracking-tight">설정</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:inline">
              <SyncBadge />
            </span>
            <UserMenu />
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-3 py-5 md:flex-row md:gap-6 md:py-8">
          {/*
            좁은 화면에서는 위로 올라가 가로로 스크롤된다. 세로로 쌓으면 일곱 개가
            첫 화면을 다 잡아먹어, 정작 볼 내용이 스크롤 밖으로 밀린다.
          */}
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
            {SETTINGS_ITEMS.map((item) => {
              const active = pathname === `/settings/${item.key}`;
              return (
                <Link
                  key={item.key}
                  href={`/settings/${item.key}`}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap md:whitespace-normal ${
                    active
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'text-[var(--fg-muted)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {/* 아직 못 쓰는 항목은 눌러 보기 전에 알 수 있어야 한다. */}
                  {item.soon && <Lock size={11} className="shrink-0 text-[var(--fg-subtle)]" />}
                  {item.name}
                </Link>
              );
            })}
          </nav>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
