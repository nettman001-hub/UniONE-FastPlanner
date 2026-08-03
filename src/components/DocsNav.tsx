'use client';

/** 설명서 목차. 지금 보고 있는 문서를 표시해야 해서 클라이언트 컴포넌트다. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { DocPage } from '@/lib/docs';

export function DocsNav({ pages }: { pages: DocPage[] }) {
  const pathname = usePathname();

  const item = (href: string, label: string, summary: string, index?: number) => {
    const active = pathname === href;
    return (
      <li key={href}>
        <Link
          href={href}
          className={`flex gap-2 rounded-lg px-2.5 py-2 transition ${
            active
              ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
              : 'hover:bg-[var(--surface-2)]'
          }`}
        >
          {index !== undefined && (
            <span className="w-3.5 shrink-0 text-[11px] font-bold tabular-nums text-[var(--fg-subtle)]">
              {index}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[12.5px] font-bold">{label}</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--fg-muted)]">
              {summary}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <nav className="no-print w-full shrink-0 lg:sticky lg:top-16 lg:w-[248px] lg:self-start">
      <div className="card overflow-hidden p-1.5">
        <ul className="flex flex-col gap-0.5">
          {item('/docs', '설명서 홈', '전체 목차와 기획 흐름')}
          {pages.map((page, index) =>
            item(`/docs/${page.slug}`, page.title, page.summary, index + 1),
          )}
        </ul>
      </div>
    </nav>
  );
}
