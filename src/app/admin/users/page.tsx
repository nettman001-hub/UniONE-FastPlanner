'use client';

/**
 * 사용자 목록.
 *
 * 플랜 숫자를 누르면 목록이, 목록에서 제목을 누르면 새 탭의 일반 편집기가 열린다.
 * 사용자의 원본 플랜을 같은 편집 화면에서 확인하고 수정한다.
 */

import { useCallback, useEffect, useState } from 'react';
import { Coins, FileText, FolderOpen, Search } from 'lucide-react';

import { Panel } from '@/components/settings/Parts';
import { Modal, Spinner, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth/client';
import { ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  plans: number;
  usedToday: number;
  remaining: number;
  lastUsedAt: string | null;
}

/**
 * 목록에 실리는 플랜 하나.
 *
 * **여기에는 본문이 없다.** 제목·시각과 무엇이 만들어졌는지까지다 —
 * 서버(`lib/db/admin.ts`)가 목록 질의에서는 그것만 세어서 보낸다.
 */
interface AdminPlan {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  done: ArtifactKey[];
  counts: {
    requirements: number;
    features: number;
    pages: number;
    flows: number;
    wireframes: number;
  };
}

const STEPS: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

function day(iso: string | null): string {
  if (!iso) return '-';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '-';
  return time.toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });
}

export default function AdminUsers() {
  const toast = useToast();
  const { user: actor } = useAuth();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [granting, setGranting] = useState<string | null>(null);
  /** 플랜 숫자를 누르면 열리는 창. 누구 것인지와 목록을 함께 들고 있는다. */
  const [plansOf, setPlansOf] = useState<AdminUser | null>(null);
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);

  const planHref = (planId: string) => plansOf && actor
    ? `/plans/${encodeURIComponent(planId)}?adminUserId=${encodeURIComponent(plansOf.id)}&adminActorId=${encodeURIComponent(actor.id)}`
    : undefined;

  const openPlans = async (user: AdminUser) => {
    setPlansOf(user);
    setPlans(null);
    try {
      const res = await fetch(`/api/admin?view=plans&userId=${encodeURIComponent(user.id)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { plans?: AdminPlan[] };
      setPlans(data.plans ?? []);
    } catch {
      toast('플랜을 불러오지 못했습니다.', 'warn');
      setPlans([]);
    }
  };

  const closePlans = () => {
    setPlansOf(null);
  };

  const load = useCallback(
    async (q: string) => {
      try {
        const res = await fetch(`/api/admin?view=users&q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { users?: AdminUser[] };
        setUsers(data.users ?? []);
      } catch {
        toast('목록을 불러오지 못했습니다.', 'warn');
        setUsers([]);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const grant = async (user: AdminUser) => {
    const raw = window.prompt(
      `${user.email} 에게 크레딧을 몇 개 돌려줄까요?\n\n지금 남은 것: ${user.remaining}`,
      '50',
    );
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('숫자로 적어 주세요.', 'warn');
      return;
    }
    setGranting(user.id);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, amount }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? '주지 못했습니다.', 'warn');
        return;
      }
      toast(`${user.email} 에게 ${Math.floor(amount)} 크레딧을 주었습니다.`, 'ok');
      await load(query);
    } catch {
      toast('주지 못했습니다.', 'warn');
    } finally {
      setGranting(null);
    }
  };

  const [resettingPw, setResettingPw] = useState<string | null>(null);

  const resetPassword = async (user: AdminUser) => {
    const raw = window.prompt(
      `[${user.email}] 계정의 새 비밀번호를 입력해 주세요 (8자 이상):`,
      '',
    );
    if (raw === null) return;
    const newPassword = raw.trim();
    if (newPassword.length < 8) {
      toast('비밀번호는 8자 이상이어야 합니다.', 'warn');
      return;
    }
    setResettingPw(user.id);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', userId: user.id, newPassword }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        toast(data.error ?? '재설정하지 못했습니다.', 'warn');
        return;
      }
      toast(`${user.email} 의 비밀번호를 성공적으로 재설정했습니다.`, 'ok');
    } catch {
      toast('재설정하지 못했습니다.', 'warn');
    } finally {
      setResettingPw(null);
    }
  };

  return (
    <Panel title="사용자" description="플랜 숫자를 누르면 목록이 열립니다. 사용자의 원본 플랜을 새 탭의 일반 편집기에서 확인하고 수정할 수 있습니다.">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input
          className="input min-w-0 flex-1"
          value={query}
          placeholder="이메일이나 이름으로 찾기"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(query);
          }}
        />
        <button className="btn btn-sm shrink-0" onClick={() => void load(query)}>
          <Search size={13} />
          찾기
        </button>
      </div>

      {users === null ? (
        <div className="py-6">
          <Spinner size={16} />
        </div>
      ) : users.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] text-[var(--fg-subtle)]">
          찾은 사용자가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11.5px] text-[var(--fg-muted)]">
                <th className="py-2 pr-3 font-semibold">계정</th>
                <th className="py-2 pr-3 font-semibold whitespace-nowrap">가입</th>
                <th className="py-2 pr-3 font-semibold whitespace-nowrap">플랜</th>
                <th className="py-2 pr-3 font-semibold whitespace-nowrap">오늘 씀</th>
                <th className="py-2 pr-3 font-semibold whitespace-nowrap">마지막</th>
                <th className="py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="py-2 pr-3">
                    <p className="font-semibold break-all">{user.email}</p>
                    <p className="text-[11px] text-[var(--fg-muted)]">{user.name}</p>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-[var(--fg-muted)]">
                    {day(user.createdAt)}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {/*
                      숫자만 있으면 "이 사람이 뭘 만들었지" 에서 막힌다. 눌러서
                      목록을 보고, 거기서 제목을 누르면 편집기를 열 수 있다.
                    */}
                    {user.plans > 0 ? (
                      <button
                        type="button"
                        className="font-semibold text-[var(--primary)] underline underline-offset-2"
                        onClick={() => void openPlans(user)}
                        title="이 사용자의 플랜 목록을 봅니다."
                      >
                        {user.plans}
                      </button>
                    ) : (
                      <span className="text-[var(--fg-subtle)]">0</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {user.usedToday}
                    <span className="text-[var(--fg-subtle)]"> · 남음 {user.remaining}</span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-[var(--fg-muted)]">
                    {day(user.lastUsedAt)}
                  </td>
                  <td className="py-2 whitespace-nowrap flex items-center gap-1">
                    <button
                      className={`btn btn-sm${granting === user.id ? ' is-busy' : ''}`}
                      disabled={granting !== null || resettingPw !== null}
                      onClick={() => void grant(user)}
                      title="쓴 기록은 그대로 두고 되돌려 주는 줄을 하나 더 적습니다."
                    >
                      {granting === user.id ? <Spinner size={12} /> : <Coins size={12} />}
                      크레딧
                    </button>
                    <button
                      className={`btn btn-sm${resettingPw === user.id ? ' is-busy' : ''}`}
                      disabled={granting !== null || resettingPw !== null}
                      onClick={() => void resetPassword(user)}
                      title="이 사용자의 비밀번호를 새 값으로 재설정합니다."
                    >
                      비밀번호 재설정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
        크레딧을 주면 <b>쓴 기록을 지우지 않고</b> 되돌려 주는 줄을 하나 더 적습니다. 무슨 일이
        있었는지가 남아야 나중에 되짚을 수 있습니다.
      </p>

      <Modal
        open={plansOf !== null}
        title={`${plansOf?.name || plansOf?.email || ''} 님의 플랜`}
        description="제목이나 '플랜 열기'를 누르면 새 탭에서 사용자의 원본 플랜을 일반 편집기로 열어 수정합니다."
        onClose={closePlans}
        width={680}
      >
        {plans === null ? (
          <div className="py-6 text-center">
            <Spinner size={16} />
          </div>
        ) : plans.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-[12px] text-[var(--fg-subtle)]">
            플랜이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <FolderOpen size={13} className="translate-y-0.5 text-[var(--fg-subtle)]" />
                  <a
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-bold underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--primary)]"
                    href={planHref(plan.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!actor || !plansOf}
                    title="사용자의 원본 플랜을 새 탭의 편집기에서 엽니다."
                  >
                    {plan.title || '(제목 없음)'}
                  </a>
                  <span className="text-[11px] whitespace-nowrap text-[var(--fg-subtle)]">
                    수정 {day(plan.updatedAt)} · 만듦 {day(plan.createdAt)}
                  </span>
                  <a
                    className="btn btn-sm shrink-0"
                    href={planHref(plan.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!actor || !plansOf}
                  >
                    <FileText size={12} />
                    플랜 열기
                  </a>
                </div>

                {/* 다섯 단계 중 무엇이 만들어졌는지 — 지원할 때 실제로 쓸모가 있다. */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {STEPS.map((step) => (
                    <span
                      key={step}
                      className={plan.done.includes(step) ? 'chip chip-ok' : 'chip'}
                      style={plan.done.includes(step) ? undefined : { opacity: 0.55 }}
                    >
                      {ARTIFACT_LABEL[step]}
                    </span>
                  ))}
                </div>

                <p className="mt-1.5 text-[11.5px] text-[var(--fg-subtle)]">
                  요구사항 {plan.counts.requirements} · 기능 {plan.counts.features} · 화면{' '}
                  {plan.counts.pages} · 플로우 {plan.counts.flows} · 와이어프레임{' '}
                  {plan.counts.wireframes}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Panel>
  );
}
