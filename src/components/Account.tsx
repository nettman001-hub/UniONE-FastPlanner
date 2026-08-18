'use client';

/**
 * 계정 관련 화면 조각.
 *
 * - `PlanSync` : 로그인 상태에 맞춰 플랜을 서버와 맞춘다 (그리는 것 없음)
 * - `RequireAuth` : 로그인해야 볼 수 있는 화면을 감싼다
 * - `UserMenu` : 오른쪽 위 계정 버튼 + 저장 상태
 * - `GuestImportBanner` : 로그인 전에 만든 플랜을 계정으로 옮기라는 안내
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Check, CloudOff, LogOut, RefreshCw, Settings, ShieldCheck, Upload, User, X } from 'lucide-react';

import { useAuth } from '@/lib/auth/client';
import {
  adoptUser,
  clearGuestBackup,
  importGuestBackup,
  readGuestBackup,
  releaseUser,
  subscribeSync,
  syncSnapshot,
} from '@/lib/sync';
import { usePlannerStore } from '@/lib/store';
import { refreshCredits, resetCredits } from '@/lib/useCredits';
import { refreshEngine, resetEngine } from '@/lib/useEngine';
import { Spinner, useToast } from './ui';

/* 동기화 ------------------------------------------------------------- */

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSync, syncSnapshot, () => syncSnapshot());
}

/**
 * 로그인 상태가 바뀔 때 플랜을 맞춘다.
 *
 * 저장소가 아직 불러와지지 않았으면(hydrated=false) 기다린다. 빈 목록을 서버 것으로
 * 착각해 로컬 플랜을 지워 버리는 사고를 막기 위해서다.
 */
export function PlanSync() {
  const { user, loading } = useAuth();
  const hydrated = usePlannerStore((s) => s.hydrated);

  useEffect(() => {
    if (loading || !hydrated) return;
    if (user) void adoptUser(user.id);
    else releaseUser();
  }, [user, loading, hydrated]);

  /*
   * 크레딧과 엔진도 여기서 맞춘다. 로그아웃하면 비워야 한다 — 안 그러면 다음
   * 사람이 앞사람의 잔량과 등급을 본다.
   *
   * 엔진은 단계마다 다섯 개라 더 눈에 띈다. 앞사람이 고급으로 둔 단계가 그대로
   * 보이면 새로 들어온 사람은 값이 두 배인 줄 모르고 누른다.
   */
  useEffect(() => {
    if (loading) return;
    if (user) {
      void refreshCredits();
      void refreshEngine();
    } else {
      resetCredits();
      resetEngine();
    }
  }, [user, loading]);

  return null;
}

export function SyncBadge() {
  const { state, error } = useSyncStatus();
  const { user } = useAuth();
  if (!user || state === 'idle') return null;

  if (state === 'error') {
    return (
      <span className="chip" style={{ color: 'var(--danger)' }} title={error ?? undefined}>
        <CloudOff size={11} />
        저장 안 됨
      </span>
    );
  }
  return (
    <span className="chip" title="플랜이 계정에 저장됩니다.">
      {state === 'syncing' ? <RefreshCw size={11} className="spin" /> : <Check size={11} />}
      {state === 'syncing' ? '저장 중' : '저장됨'}
    </span>
  );
}

/* 로그인 요구 --------------------------------------------------------- */

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, pathname, router]);

  if (loading || !user) {
    return (
      <div className="empty" style={{ minHeight: '60vh' }}>
        <Spinner size={18} />
      </div>
    );
  }
  return <>{children}</>;
}

/* 계정 메뉴 ----------------------------------------------------------- */

export function UserMenu() {
  const { user, admin, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={user.email}
      >
        <User size={14} />
        <span className="max-w-[110px] truncate">{user.name || user.email}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="card fade-in absolute right-0 top-9 z-50 w-56 p-1">
            <div className="border-b border-[var(--border)] px-2.5 py-2">
              <p className="truncate text-[12.5px] font-bold">{user.name || '이름 없음'}</p>
              <p className="truncate text-[11.5px] text-[var(--fg-muted)]">{user.email}</p>
            </div>
            {/* 관리자에게만 보인다. 아닌 사람은 주소로 들어와도 404 다. */}
            {admin && (
              <Link
                role="menuitem"
                href="/admin"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-semibold hover:bg-[var(--surface-2)]"
                onClick={() => setOpen(false)}
              >
                <ShieldCheck size={13} className="text-[var(--primary)]" />
                관리자
              </Link>
            )}
            <Link
              role="menuitem"
              href="/settings"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-semibold hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(false)}
            >
              <Settings size={13} className="text-[var(--fg-subtle)]" />
              설정
            </Link>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-semibold hover:bg-[var(--surface-2)]"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.replace('/login');
              }}
            >
              <LogOut size={13} className="text-[var(--fg-subtle)]" />
              로그아웃
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* 로그인 전 플랜 옮기기 ------------------------------------------------ */

export function GuestImportBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  // 보관함은 localStorage 라서 첫 렌더 뒤에 읽어야 서버 렌더와 어긋나지 않는다.
  useEffect(() => {
    setCount(user ? readGuestBackup().length : 0);
  }, [user]);

  if (!user || count === 0) return null;

  return (
    <div className="card mb-3 flex flex-wrap items-center gap-2 border-dashed px-4 py-3">
      <Upload size={15} className="text-[var(--primary)]" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        로그인 전에 이 브라우저에서 만든 플랜이 <b>{count}개</b> 있습니다. 계정으로 옮기면
        다른 기기에서도 이어서 볼 수 있습니다.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const moved = await importGuestBackup();
            setCount(0);
            toast(`플랜 ${moved}개를 계정으로 옮겼습니다.`, 'ok');
          } catch (error) {
            toast(error instanceof Error ? error.message : '옮기지 못했습니다.', 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={12} /> : <Upload size={13} />}
        내 계정으로 가져오기
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        title="보관함을 비웁니다. 되돌릴 수 없습니다."
        onClick={() => {
          clearGuestBackup();
          setCount(0);
        }}
      >
        <X size={13} />
        버리기
      </button>
    </div>
  );
}
