import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { DocsNav } from '@/components/DocsNav';
import { docNav, docsTitle } from '@/lib/docs';
import { BRAND_NAME } from '@/lib/brand';

export const metadata = {
  title: `설명서 — ${BRAND_NAME}`,
};

/**
 * 설명서 셸.
 *
 * 목차는 서버에서 읽어 넘기고, 지금 보고 있는 문서를 표시하는 일만 클라이언트가 한다.
 */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  const [pages, title] = await Promise.all([docNav(), docsTitle()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <Link
          href="/"
          className="btn btn-ghost btn-sm"
          title="플랜 목록으로"
          aria-label="플랜 목록으로"
        >
          <ArrowLeft size={15} />
          <Logo size={18} />
        </Link>
        <span className="text-[var(--fg-subtle)]">/</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold">
          <BookOpen size={14} />
          <span className="truncate">{title}</span>
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:flex-row">
        <DocsNav pages={pages} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
