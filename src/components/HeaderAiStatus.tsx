'use client';

/**
 * **상단 우측 AI 작업 상태 및 완료 알림 위젯**
 *
 * ## 기능
 * 1. AI 작업(산출물 생성, UniAI 생성, 스티치 연동, 에이전트 대화) 진행 중일 때:
 *    - 실시간 진행 상황(작업명, 단계/진행률) 표시
 *    - 클릭 시 작업 중인 해당 페이지로 바로 이동
 * 2. 작업이 완료되었을 때:
 *    - 초록색 완료 배지 표시
 *    - 클릭 시 완료된 페이지로 이동
 *    - 사용자가 해당 페이지로 이동(방문)하면 완료 표시 자동 해제
 *    - 우측 X 버튼으로 수동 닫기 지원
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { ClientOnly } from './ui';
import { useAiTasks, useAutoDismissCompleted, type CompletedTask, type RunningTask } from '@/lib/tasks';

interface HeaderAiStatusProps {
  planId?: string;
}

function StatusContent({ planId }: HeaderAiStatusProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { running, completed, dismiss } = useAiTasks(planId);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // 현재 페이지 이동 감지하여 해당 완료 알림 자동 해제
  useAutoDismissCompleted(pathname, planId);

  const totalTasks = running.length + completed.length;
  if (totalTasks === 0) return null;

  // 우선순위: 진행 중인 작업 먼저, 그 다음 완료된 작업
  const primaryRunning: RunningTask | undefined = running[0];
  const primaryCompleted: CompletedTask | undefined = completed[0];

  const handleCompletedClick = (task: CompletedTask) => {
    // 해당 페이지로 이동하고 알림 해제
    dismiss(task.id);
    router.push(task.href);
  };

  return (
    <div className="relative flex items-center">
      {/* 1. 진행 중인 작업 표시 */}
      {primaryRunning && (
        <div className="flex items-center gap-1">
          <Link
            href={primaryRunning.href}
            className="group flex max-w-[210px] sm:max-w-[280px] items-center gap-1.5 rounded-full border border-[var(--primary-border)] bg-[var(--primary-soft)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--primary)] shadow-sm transition hover:bg-[var(--primary)] hover:text-white"
            title="클릭하면 작업 중인 페이지로 이동합니다."
          >
            <Loader2 size={12} className="spin shrink-0 text-current" />
            <span className="truncate">{primaryRunning.what}</span>
          </Link>

          {/* 여러 작업이 돌아갈 때 개수 표시 */}
          {totalTasks > 1 && (
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex size-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--fg-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
              title="전체 작업 목록 보기"
            >
              +{totalTasks - 1}
            </button>
          )}
        </div>
      )}

      {/* 2. 완료된 작업 표시 (진행 중인 작업이 없을 때 단독 표시) */}
      {!primaryRunning && primaryCompleted && (
        <div className="flex items-center gap-1">
          <div className="group flex max-w-[210px] sm:max-w-[280px] items-center gap-1.5 rounded-full border border-[var(--ok-border,rgba(34,197,94,0.3))] bg-[var(--ok-soft,rgba(34,197,94,0.1))] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ok,#16a34a)] shadow-sm transition hover:shadow">
            <button
              type="button"
              onClick={() => handleCompletedClick(primaryCompleted)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
              title="클릭하면 완료된 페이지로 이동합니다."
            >
              <CheckCircle2 size={13} className="shrink-0 text-current" />
              <span className="truncate">{primaryCompleted.title}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(primaryCompleted.id);
              }}
              className="shrink-0 rounded-full p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
              title="알림 닫기"
            >
              <X size={11} />
            </button>
          </div>

          {totalTasks > 1 && (
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex size-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--fg-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
              title="전체 작업 목록 보기"
            >
              +{totalTasks - 1}
            </button>
          )}
        </div>
      )}

      {/* 3. 복수 작업 목록 드롭다운 */}
      {dropdownOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} aria-hidden />
          <div className="card fade-in absolute right-0 top-8 z-50 flex w-72 flex-col gap-1.5 p-2 shadow-xl border border-[var(--border-strong)] bg-[var(--surface)]">
            <div className="flex items-center justify-between px-1.5 py-1 border-b border-[var(--border)]">
              <span className="text-[11px] font-bold text-[var(--fg-muted)]">AI 작업 목록 ({totalTasks})</span>
              <button
                type="button"
                onClick={() => setDropdownOpen(false)}
                className="text-[var(--fg-subtle)] hover:text-[var(--fg)]"
              >
                <X size={12} />
              </button>
            </div>

            {/* 진행 중 목록 */}
            {running.map((task) => (
              <Link
                key={task.key}
                href={task.href}
                onClick={() => setDropdownOpen(false)}
                className="flex items-center justify-between rounded-lg bg-[var(--primary-soft)] px-2.5 py-2 text-[12px] font-semibold text-[var(--primary)] transition hover:opacity-90"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 size={13} className="spin shrink-0 text-current" />
                  <span className="truncate">{task.what}</span>
                </div>
                <span className="text-[10px] opacity-75 shrink-0">이동 →</span>
              </Link>
            ))}

            {/* 완료 목록 */}
            {completed.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-lg bg-[var(--ok-soft,rgba(34,197,94,0.1))] px-2.5 py-2 text-[12px] font-semibold text-[var(--ok,#16a34a)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false);
                    handleCompletedClick(task);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                >
                  <CheckCircle2 size={13} className="shrink-0 text-current" />
                  <span className="truncate">{task.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(task.id)}
                  className="ml-1 p-0.5 opacity-60 hover:opacity-100"
                  title="닫기"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function HeaderAiStatus({ planId }: HeaderAiStatusProps) {
  return (
    <ClientOnly>
      <StatusContent planId={planId} />
    </ClientOnly>
  );
}
