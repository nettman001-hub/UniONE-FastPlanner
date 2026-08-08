'use client';

/** 대시보드 — 지금 서비스가 어떤 상태인지 한 화면에. */

import { useEffect, useState } from 'react';

import { Panel } from '@/components/settings/Parts';
import { Spinner } from '@/components/ui';

interface Overview {
  users: number;
  newUsers: number;
  activeUsers: number;
  plans: number;
  todayRuns: number;
  todayCredits: number;
  integrations: number;
  skills: number;
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3">
      <p className="text-[11.5px] font-semibold text-[var(--fg-muted)]">{label}</p>
      <p className="mt-0.5 text-[22px] font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">{hint}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Overview) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <Panel title="불러오지 못했습니다">
        <p className="text-[12.5px] text-[var(--fg-muted)]">
          데이터베이스에 닿지 못했을 수 있습니다. <b>점검</b> 탭에서 상태를 확인해 보세요.
        </p>
      </Panel>
    );
  }

  if (!data) {
    return (
      <div className="empty" style={{ minHeight: '40vh' }}>
        <Spinner size={18} />
      </div>
    );
  }

  return (
    <>
      <Panel title="계정">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="전체 가입자" value={data.users} />
          <Stat label="오늘 가입" value={data.newUsers} />
          <Stat label="최근 7일 활동" value={data.activeUsers} hint="무엇이든 만든 사람" />
        </div>
      </Panel>

      <Panel title="오늘">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="만든 횟수" value={data.todayRuns} />
          <Stat label="쓴 크레딧" value={data.todayCredits} />
          <Stat label="전체 플랜" value={data.plans} />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          AI 가 실패해 기본 생성기로 대신한 것은 크레딧이 들지 않으므로 여기 안 잡힙니다.
        </p>
      </Panel>

      <Panel title="쓰고 있는 기능">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="스티치 연결" value={data.integrations} hint="이어 둔 계정 수" />
          <Stat label="기획 스킬" value={data.skills} hint="지침을 켜 둔 계정 수" />
        </div>
      </Panel>
    </>
  );
}
