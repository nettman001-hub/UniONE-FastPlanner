'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Eye, FileText, Printer } from 'lucide-react';
import { MarkdownView } from '@/components/MarkdownView';
import { EmptyState } from '@/components/ui';
import { readSharedPlan } from '@/lib/share';
import { toMarkdown } from '@/lib/export';
import { PLATFORM_LABEL, type Plan } from '@/lib/types';

/** 보기 전용 공유 화면. 플랜은 URL 해시에서 읽으며 서버로 전송되지 않는다. */
export default function SharePage() {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);

  useEffect(() => {
    setPlan(readSharedPlan(window.location.hash));
    const onHashChange = () => setPlan(readSharedPlan(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (plan === undefined) {
    return <div className="p-10 text-[13px] text-[var(--fg-muted)]">불러오는 중…</div>;
  }

  if (plan === null) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <EmptyState
          icon={<FileText size={28} />}
          title="공유 링크를 읽을 수 없습니다"
          description="링크가 잘리거나 손상되었을 수 있습니다. 공유한 사람에게 링크를 다시 받아 주세요."
          action={
            <Link href="/" className="btn btn-primary btn-sm">
              FastPlaner 홈으로
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <header className="no-print sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="chip chip-primary">
              <Eye size={11} />
              보기 전용
            </span>
            <h1 className="truncate text-[14px] font-extrabold tracking-tight">
              {plan.brief.title}
            </h1>
            <span className="chip hidden sm:inline-flex">
              {PLATFORM_LABEL[plan.brief.platform]}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="btn btn-sm" onClick={() => window.print()}>
              <Printer size={13} />
              <span className="hidden sm:inline">인쇄</span>
            </button>
            <Link href="/" className="btn btn-primary btn-sm">
              내 플랜 만들기
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <article className="card p-5 sm:p-8">
          <MarkdownView markdown={toMarkdown(plan)} />
        </article>
        <p className="no-print mt-4 text-center text-[11.5px] text-[var(--fg-subtle)]">
          이 문서는 링크에 담겨 전달되었습니다. 서버에 저장되지 않으며 수정할 수 없습니다.
        </p>
      </main>
    </div>
  );
}
