'use client';

/**
 * 데이터 — 백업·동기화·이 브라우저에 남은 것.
 *
 * 여기 있는 것들은 전부 **잃어버리기 쉬운 것**을 다룬다. 그래서 지우는 쪽 버튼은
 * 무엇이 사라지고 무엇이 남는지를 반드시 함께 적는다.
 */

import { useRef, useState } from 'react';
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react';

import { Panel, ReadRow } from '@/components/settings/Parts';
import { Spinner, useConfirm, useToast } from '@/components/ui';
import { useSyncStatus } from '@/components/Account';
import { useAuth } from '@/lib/auth/client';
import { download } from '@/lib/export';
import { parsePlanFile, toBackup } from '@/lib/plan-file';
import { usePlannerStore } from '@/lib/store';

/** 이 브라우저에만 남는 것들. 계정이 아니라 이 컴퓨터에 묶인 기록이다. */
const LOCAL_KEYS = [
  { key: 'unione-fastplaner:stitch-projects', what: '스티치에 무엇을 만들었는지' },
];

export default function DataSettings() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { user, database } = useAuth();
  const { state, error } = useSyncStatus();
  const plans = usePlannerStore((s) => s.plans);
  const importPlan = usePlannerStore((s) => s.importPlan);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const backup = () => {
    if (plans.length === 0) {
      toast('내려받을 플랜이 없습니다.', 'warn');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    download(`unione-backup-${stamp}.json`, toBackup(plans), 'application/json;charset=utf-8');
    toast(`플랜 ${plans.length}개를 파일로 받았습니다.`, 'ok');
  };

  const restore = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      let added = 0;
      let bad = 0;
      for (const file of Array.from(files)) {
        const found = parsePlanFile(await file.text());
        if (found.length === 0) {
          bad += 1;
          continue;
        }
        // 가져오기는 **덮어쓰지 않고 더한다.** 지금 것을 지우는 일은 여기서 하지 않는다.
        for (const plan of found) importPlan(plan);
        added += found.length;
      }
      if (added > 0) toast(`플랜 ${added}개를 가져왔습니다.`, 'ok');
      if (bad > 0) toast(`${bad}개 파일은 백업 형식이 아닙니다.`, 'danger');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearLocal = async () => {
    const ok = await confirm({
      title: '이 브라우저 기록 지우기',
      message:
        '스티치에 무엇을 만들었는지에 대한 기록이 사라집니다.\n\n' +
        '스티치에 만들어 둔 화면과 플랜은 그대로 남습니다. 다만 내보내기 화면의 완료 표시가 없어집니다.',
      confirmLabel: '지우기',
      danger: true,
    });
    if (!ok) return;
    for (const item of LOCAL_KEYS) localStorage.removeItem(item.key);
    toast('이 브라우저에 남아 있던 기록을 지웠습니다.', 'ok');
  };

  return (
    <>
      {dialog}

      <Panel
        title="백업"
        description="플랜 전부를 파일 하나로 내려받아 둡니다. 계정을 지우기 전이나 다른 곳으로 옮길 때 쓰세요."
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn btn-primary btn-sm" onClick={backup}>
            <Download size={13} />
            전체 백업 받기 ({plans.length}개)
          </button>
          <button
            className={`btn btn-sm${busy ? ' is-busy' : ''}`}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Spinner size={13} /> : <Upload size={13} />}
            백업 가져오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            multiple
            className="hidden"
            onChange={(e) => void restore(e.target.files)}
          />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          가져오기는 <b>덮어쓰지 않고 더합니다.</b> 지금 있는 플랜은 그대로 두고 새 플랜으로
          들어옵니다. 플랜 하나만 담긴 파일도 그대로 받습니다.
        </p>
      </Panel>

      <Panel title="동기화" description="플랜은 계정에 저장되어 다른 기기에서도 이어 볼 수 있습니다.">
        <ReadRow
          label="상태"
          value={
            state === 'error'
              ? `저장 안 됨${error ? ` — ${error}` : ''}`
              : state === 'syncing'
                ? '저장 중'
                : '저장됨'
          }
        />
        <ReadRow label="계정" value={user?.email ?? '-'} />
        {/*
          예전에는 "이 서버 안에서만 (임시)" 라고 적었는데 **로컬에서는 임시가
          아니다.** 파일로 남아 껐다 켜도 그대로다. 그렇게 적어 두면 자기
          컴퓨터에서 만든 것이 날아간다고 오해한다.

          사용자에게 중요한 것은 "임시인가" 가 아니라 **다른 기기에서도 보이는가** 다.
        */}
        <ReadRow
          label="저장 위치"
          value={database === 'postgres' ? '계정 데이터베이스' : '이 서버'}
          hint={
            database === 'postgres'
              ? '다른 기기에서도 이어서 봅니다'
              : '이 서버에서만 보입니다'
          }
        />
        <div className="mt-2.5">
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
            <RefreshCw size={13} />
            다시 맞추기
          </button>
        </div>
      </Panel>

      <Panel
        title="이 브라우저에만 남은 것"
        danger
        description="계정이 아니라 이 컴퓨터에 묶인 기록입니다. 다른 컴퓨터에서는 보이지 않습니다."
      >
        <ul className="mb-2.5 flex flex-col gap-0.5">
          {LOCAL_KEYS.map((item) => (
            <li key={item.key} className="text-[12px] leading-relaxed text-[var(--fg-muted)]">
              · {item.what}
            </li>
          ))}
        </ul>
        <button
          className="btn btn-sm"
          style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          onClick={() => void clearLocal()}
        >
          <Trash2 size={13} />이 브라우저 기록 지우기
        </button>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          플랜은 지워지지 않습니다. 스티치에 만들어 둔 화면도 그대로 남습니다.
        </p>
      </Panel>
    </>
  );
}
