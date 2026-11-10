'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth/client';
import {
  adminWorkspace, clearAdminWorkspace, adminWorkspaceOwner, adminWorkspaceOwnerOnServer,
  subscribeAdminWorkspaceOwner, invalidAdminWorkspace,
} from '@/lib/admin-workspace';
import { usePlannerStore } from '@/lib/store';
import { flushPlanSync, syncSnapshot } from '@/lib/sync';
import { Spinner } from './ui';

const EMPTY_EXIT = { pending: false, error: '', destination: '' };
let exitState = EMPTY_EXIT;
const exitListeners = new Set<() => void>();
const readExit = () => exitState;
const readExitOnServer = () => EMPTY_EXIT;
function subscribeExit(listener: () => void) {
  exitListeners.add(listener);
  return () => { exitListeners.delete(listener); };
}
function publishExit(next: typeof EMPTY_EXIT) {
  exitState = next;
  exitListeners.forEach((listener) => listener());
}

async function exitWorkspace(destination: string) {
  if (exitState.pending) return;
  publishExit({ pending: true, error: '', destination });
  try {
    if (!(await flushPlanSync())) {
      publishExit({ pending: false, error: syncSnapshot().error || '최신 변경 사항을 모두 저장하지 못했습니다.', destination });
      return;
    }
    clearAdminWorkspace();
    window.location.replace(destination);
  } catch {
    publishExit({ pending: false, error: '사용자 플랜을 저장하지 못했습니다. 연결을 확인하고 다시 저장해 주세요.', destination });
  }
}

/** 지원 탭은 선택한 플랜 안에서만 이동하며 관리자 인증 전에는 캐시도 표시하지 않는다. */
export function AdminWorkspaceBoundary({ children }: { children: ReactNode }) {
  const { user, admin, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = usePlannerStore((state) => state.hydrated);
  const [mounted, setMounted] = useState(false);
  const exit = useSyncExternalStore(subscribeExit, readExit, readExitOnServer);
  useEffect(() => { setMounted(true); }, []);
  const scope = adminWorkspace();
  const invalid = invalidAdminWorkspace();
  const base = scope ? `/plans/${encodeURIComponent(scope.planId)}` : '';
  const inPlan = !!scope && (pathname === base || pathname.startsWith(`${base}/`));
  const allowed = !!scope && !!user && admin && user.id === scope.actorId;

  useEffect(() => {
    if (!mounted || !scope || loading) return;
    if (!allowed) {
      clearAdminWorkspace();
      // 계정이 다르거나 로그아웃했으면 대상 사용자에게 쓰지 않고 문맥을 비운다.
      window.location.replace(user ? '/' : '/login');
    } else if (!inPlan) {
      // 현재 origin의 전체 주소로 이동해 //로 시작하는 경로도 외부 주소로 해석하지 않는다.
      void exitWorkspace(window.location.href);
    }
  }, [allowed, inPlan, loading, mounted, scope, user]);

  if (mounted && invalid) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-5">
        <p className="font-bold">사용자 플랜 지원 주소가 올바르지 않습니다.</p>
        <p className="text-[13px] text-[var(--fg-muted)]">관리자 사용자 목록에서 플랜을 다시 선택해 주세요.</p>
        <button type="button" className="btn btn-primary self-start" onClick={() => {
          clearAdminWorkspace();
          window.location.replace('/admin/users');
        }}>관리자 사용자 목록으로</button>
      </div>
    );
  }
  if (scope && allowed && exit.error) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-5">
        <p className="font-bold">사용자 플랜을 저장하지 못해 편집 화면을 닫지 않았습니다.</p>
        <p className="text-[13px] text-[var(--danger)]">{exit.error}</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void exitWorkspace(exit.destination)}>다시 저장하고 나가기</button>
          <button type="button" className="btn" onClick={() => {
            publishExit(EMPTY_EXIT);
            router.replace(base);
          }}>편집 계속하기</button>
        </div>
      </div>
    );
  }
  if (scope && exit.pending) {
    return <div className="flex min-h-screen items-center justify-center gap-2"><Spinner size={20} />사용자 플랜 저장 중…</div>;
  }
  if (!mounted || (scope && (loading || !hydrated || !allowed || !inPlan))) {
    return <div className="grid min-h-screen place-items-center"><Spinner size={20} /></div>;
  }
  return children;
}

/** 계정 전환으로 오해하지 않도록 편집 대상과 원본 반영을 표시한다. */
export function AdminWorkspaceBanner() {
  const scope = adminWorkspace();
  const owner = useSyncExternalStore(subscribeAdminWorkspaceOwner, adminWorkspaceOwner, adminWorkspaceOwnerOnServer);
  if (!scope) return null;
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-[var(--primary-border)] bg-[var(--primary-soft)] px-4 py-2 text-[12px]">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck size={15} className="shrink-0" />
        <p className="min-w-0">
          <strong>{owner?.name || owner?.email || scope.userId} 님의 플랜 편집 중</strong>
          <span className="ml-2 text-[var(--fg-muted)]">변경 사항은 사용자 원본에 저장되며 AI 작업은 해당 사용자의 크레딧을 사용합니다.</span>
        </p>
      </div>
      <button type="button" className="btn btn-sm shrink-0" onClick={() => void exitWorkspace('/admin/users')}>관리자 사용자 목록으로</button>
    </div>
  );
}
