'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth/client';
import { adminWorkspace } from '@/lib/admin-workspace';
import { usePlannerStore } from '@/lib/store';
import {
  exportPlannerRecovery, plannerStorageSnapshot, retryPlannerStorage, subscribePlannerStorage,
} from '@/lib/planner-storage';
import { flushPlanSync, subscribeSync, syncSnapshot } from '@/lib/sync';
import { download } from '@/lib/export';
import { Spinner, useToast } from './ui';

const INITIAL = { state: 'idle' as const, error: null };

/** 임시 저장 실패를 숨기지 않으며, 메모리에 남은 작업을 파일로 복구할 수 있게 한다. */
export function PlannerStorageNotice() {
  const storage = useSyncExternalStore(subscribePlannerStorage, plannerStorageSnapshot, () => INITIAL);
  const server = useSyncExternalStore(subscribeSync, syncSnapshot, () => INITIAL);
  const owner = usePlannerStore((state) => state.owner);
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const scope = adminWorkspace();

  useEffect(() => {
    if (storage.state !== 'error' || server.state === 'saved') return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [storage.state, server.state]);

  if (!user || storage.state !== 'error' || (owner && owner !== (scope?.userId ?? user.id))) return null;

  const retry = async () => {
    setBusy(true);
    try {
      const localSaved = await retryPlannerStorage();
      const serverSaved = await flushPlanSync();
      toast(localSaved && serverSaved ? '임시 저장과 서버 저장을 완료했습니다.' : '아직 저장하지 못한 내용이 있습니다. 복구 파일을 받아 보관해 주세요.', localSaved && serverSaved ? 'ok' : 'warn');
    } finally { setBusy(false); }
  };
  const backup = async () => {
    setBusy(true);
    try {
      download('uniboard-recovery.json', JSON.stringify(await exportPlannerRecovery(scope?.userId ?? owner), null, 2), 'application/json;charset=utf-8');
    } catch {
      toast('복구 파일을 만들지 못했습니다. 현재 화면을 유지해 주세요.', 'danger');
    } finally { setBusy(false); }
  };
  return (
    <div role="alert" className="no-print flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--warn-soft)] px-4 py-2 text-[12px] text-[var(--warn)]">
      <p className="min-w-0 flex-1">{storage.error} {server.state === 'saved' ? '현재 내용은 서버에 저장되어 있습니다.' : '서버 저장을 확인하기 전에는 이 화면을 유지해 주세요.'}</p>
      <button className="btn btn-sm" disabled={busy} onClick={() => void retry()}>{busy && <Spinner size={12} />}저장 다시 시도</button>
      <button className="btn btn-sm" disabled={busy} onClick={() => void backup()}>복구 파일 받기</button>
    </div>
  );
}
