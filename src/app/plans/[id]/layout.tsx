'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Bot,
  ChevronLeft,
  BookOpen,
  Download,
  FileText,
  GitBranch,
  LayoutDashboard,
  ListTree,
  MonitorSmartphone,
  Table2,
  Zap,
} from 'lucide-react';
import { AgentPanel } from '@/components/AgentPanel';
import { Logo } from '@/components/Logo';
import { ClientOnly, Spinner } from '@/components/ui';
import { RequireAuth, SyncBadge, UserMenu } from '@/components/Account';
import { ResumeBanner } from '@/components/ResumeBanner';
import { DAILY_CREDIT_LIMIT, usePlannerStore } from '@/lib/store';
import { useGenerate } from '@/lib/useGenerate';
import { ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  artifact?: ArtifactKey;
}

const NAV: NavItem[] = [
  { href: '', label: '개요', icon: <LayoutDashboard size={15} /> },
  { href: '/prd', label: ARTIFACT_LABEL.prd, icon: <FileText size={15} />, artifact: 'prd' },
  { href: '/fs', label: ARTIFACT_LABEL.fs, icon: <Table2 size={15} />, artifact: 'fs' },
  { href: '/ia', label: ARTIFACT_LABEL.ia, icon: <ListTree size={15} />, artifact: 'ia' },
  { href: '/flow', label: ARTIFACT_LABEL.flow, icon: <GitBranch size={15} />, artifact: 'flow' },
  {
    href: '/wireframe',
    label: ARTIFACT_LABEL.wireframe,
    icon: <MonitorSmartphone size={15} />,
    artifact: 'wireframe',
  },
  { href: '/export', label: '내보내기', icon: <Download size={15} /> },
];

/** 플랜 밖으로 나가는 링크. 산출물 메뉴와 구분해 아래쪽에 따로 둔다. */
const EXTERNAL_NAV = [{ href: '/docs', label: '설명서', icon: <BookOpen size={15} /> }];

export default function PlanLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <PlanShell>{children}</PlanShell>
    </RequireAuth>
  );
}

function PlanShell({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const planId = params.id;
  const pathname = usePathname();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));
  const credits = usePlannerStore((s) => s.credits);
  /**
   * 지금 생성 중인 산출물. 사이드바에 표시해, 생성 중에 다른 메뉴로 옮겨 가도
   * 진행 중이라는 사실이 보이게 한다. 상태는 서버 작업에서 온다.
   */
  const {
    pending: generatingArtifact,
    interrupted,
    resume,
    discardInterrupted,
  } = useGenerate(plan);
  const [agentOpen, setAgentOpen] = useState(false);

  const base = `/plans/${planId}`;

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg)]">
      {/* 상단 바 */}
      <header className="no-print flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="btn btn-ghost btn-sm shrink-0" title="플랜 목록으로">
            <ChevronLeft size={14} />
            <Logo size={18} />
          </Link>
          <span className="hidden shrink-0 text-[var(--fg-subtle)] sm:inline">/</span>
          <h1 className="truncate text-[13.5px] font-extrabold tracking-tight">
            {plan?.brief.title ?? '플랜'}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden sm:inline">
            <SyncBadge />
          </span>
          <ClientOnly>
            <span
              className="chip"
              title={`하루 ${DAILY_CREDIT_LIMIT} 크레딧이 충전됩니다. 임시로 열어 둔 한도입니다.`}
            >
              <Zap size={11} />
              {credits} / {DAILY_CREDIT_LIMIT}
              <span className="font-normal text-[var(--fg-subtle)]">(임시)</span>
            </span>
          </ClientOnly>
          <button
            className={agentOpen ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => setAgentOpen((v) => !v)}
          >
            <Bot size={14} />
            <span className="hidden md:inline">AI 에이전트</span>
          </button>
          <UserMenu />
        </div>
      </header>

      {/* 중간에 끊긴 전체 자동 생성이 있으면 어느 화면에서든 이어 갈 수 있게 한다. */}
      {interrupted && (
        <ResumeBanner
          run={interrupted}
          onResume={() => void resume()}
          onDiscard={discardInterrupted}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* 사이드바 */}
        <nav className="no-print hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-3 md:flex">
          {NAV.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === '' ? pathname === base : pathname === href;
            const done = item.artifact ? plan?.generated[item.artifact] : undefined;
            return (
              <Link
                key={item.href}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition ${
                  active
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                    : 'text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.artifact && generatingArtifact === item.artifact ? (
                  <span className="shrink-0 text-[var(--primary)]" title="생성 중입니다">
                    <Spinner size={12} />
                  </span>
                ) : (
                  done !== undefined && (
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        done ? 'bg-[var(--ok)]' : 'bg-[var(--border-strong)]'
                      }`}
                      title={done ? '생성 완료' : '미생성'}
                    />
                  )
                )}
              </Link>
            );
          })}

          <div className="my-1.5 border-t border-[var(--border)]" />

          {EXTERNAL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-[var(--fg-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* 모바일 탭 */}
        <div className="no-print fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-[var(--border)] bg-[var(--surface)] md:hidden">
          {NAV.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === '' ? pathname === base : pathname === href;
            return (
              <Link
                key={item.href}
                href={href}
                className={`flex min-w-16 flex-1 flex-col items-center gap-1 px-2 py-2 text-[10px] font-semibold ${
                  active ? 'text-[var(--primary)]' : 'text-[var(--fg-muted)]'
                }`}
              >
                {item.artifact && generatingArtifact === item.artifact ? (
                  <Spinner size={14} />
                ) : (
                  item.icon
                )}
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
          {EXTERNAL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-w-16 flex-1 flex-col items-center gap-1 px-2 py-2 text-[10px] font-semibold text-[var(--fg-muted)]"
            >
              {item.icon}
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          <ClientOnly
            fallback={
              <div className="p-8 text-[13px] text-[var(--fg-muted)]">불러오는 중…</div>
            }
          >
            {children}
          </ClientOnly>
        </main>

        {agentOpen && plan && (
          <div className="fixed inset-y-0 right-0 z-50 w-[min(92vw,380px)] shadow-2xl lg:static lg:z-auto lg:w-[360px] lg:shadow-none">
            <AgentPanel plan={plan} onClose={() => setAgentOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
