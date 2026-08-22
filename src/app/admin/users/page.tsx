'use client';

/**
 * 사용자 목록.
 *
 * 플랜 숫자를 누르면 목록이, 목록에서 제목을 누르면 **본문**이 열린다.
 *
 * 본문은 **고른 하나만 그때 가져온다.** 목록에 실어 보내면 목록을 여는 것만으로
 * 그 사람의 기획서를 전부 받게 된다. 그리고 연 것은 서버 로그에 남는다
 * (`app/api/admin/route.ts`).
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Coins, FileText, FolderOpen, Search } from 'lucide-react';

import { MarkdownView } from '@/components/MarkdownView';
import { Panel } from '@/components/settings/Parts';
import { Modal, Spinner, useToast } from '@/components/ui';
import { toMarkdown } from '@/lib/export';
import { ARTIFACT_LABEL, type ArtifactKey, type Plan } from '@/lib/types';

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
 * 서버(`lib/db/admin.ts`)가 목록 질의에서는 그것만 세어서 보낸다. 본문은
 * 아래 `AdminPlanBody` 로 하나씩 따로 온다.
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

/** 열어 본 플랜 하나. 이쪽에는 본문이 통째로 들어 있다. */
interface AdminPlanBody {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  plan: Plan;
}

const STEPS: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

/**
 * 본문을 읽을 수 있는 글로 조립한다.
 *
 * 내보내기와 **같은 함수**를 쓴다. 관리자용으로 따로 만들면 내려받은 것과 화면에
 * 보이는 것이 조금씩 갈라져, "여기선 이렇게 나오는데" 를 매번 확인해야 한다.
 *
 * 오래 전에 저장된 플랜은 지금 모양과 달라 조립이 실패할 수 있다. 그때는 빈 화면
 * 대신 **날것이라도 보여 준다** — 본문을 보러 들어온 사람에게 아무것도 안 주는
 * 것이 가장 나쁘다.
 */
function readable(plan: Plan): string {
  try {
    return toMarkdown(plan);
  } catch {
    return ['> 저장된 모양이 지금과 달라 그대로 보여 줍니다.', '', '```json', JSON.stringify(plan, null, 2), '```'].join('\n');
  }
}

function day(iso: string | null): string {
  if (!iso) return '-';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '-';
  return time.toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });
}

export default function AdminUsers() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [granting, setGranting] = useState<string | null>(null);
  /** 플랜 숫자를 누르면 열리는 창. 누구 것인지와 목록을 함께 들고 있는다. */
  const [plansOf, setPlansOf] = useState<AdminUser | null>(null);
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  /**
   * 지금 본문을 보고 있는 플랜. `null` 이면 목록 화면이다.
   *
   * 창을 하나만 쓰고 안에서 갈아 끼운다. 창 위에 창을 또 띄우면 닫기가 두 번이
   * 되고, 어느 것을 닫는지가 헷갈린다.
   */
  const [reading, setReading] = useState<AdminPlan | null>(null);
  const [body, setBody] = useState<AdminPlanBody | null>(null);

  const openPlans = async (user: AdminUser) => {
    setPlansOf(user);
    setPlans(null);
    setReading(null);
    setBody(null);
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

  /**
   * 본문을 연다.
   *
   * 실패하면 **목록으로 되돌린다.** 빈 본문 화면에 남겨 두면 "원래 이 플랜이
   * 비어 있는 것" 처럼 보인다. 불러오지 못한 것과 내용이 없는 것은 다르다.
   */
  const openBody = async (user: AdminUser, plan: AdminPlan) => {
    setReading(plan);
    setBody(null);
    try {
      const res = await fetch(
        `/api/admin?view=plan&userId=${encodeURIComponent(user.id)}&planId=${encodeURIComponent(plan.id)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { plan?: AdminPlanBody };
      if (!data.plan) throw new Error('본문이 비었습니다.');
      setBody(data.plan);
    } catch {
      toast('본문을 불러오지 못했습니다.', 'warn');
      setReading(null);
    }
  };

  const closePlans = () => {
    setPlansOf(null);
    setReading(null);
    setBody(null);
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
    <Panel title="사용자" description="플랜 숫자를 누르면 목록이, 제목을 누르면 본문이 열립니다.">
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
                      목록을 보고, 거기서 제목을 누르면 본문까지 볼 수 있다.
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
        title={
          reading
            ? reading.title || '(제목 없음)'
            : `${plansOf?.name || plansOf?.email || ''} 님의 플랜`
        }
        description={
          reading
            ? '기획서 본문입니다. 누가 무엇을 열었는지는 서버 기록에 남습니다.'
            : '제목을 누르면 본문을 봅니다.'
        }
        onClose={closePlans}
        width={reading ? 900 : 680}
      >
        {reading ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="btn btn-sm" onClick={() => { setReading(null); setBody(null); }}>
                <ArrowLeft size={12} />
                목록
              </button>
              <span className="text-[11px] text-[var(--fg-subtle)]">
                수정 {day(reading.updatedAt)} · 만듦 {day(reading.createdAt)}
              </span>
            </div>

            {body === null ? (
              <div className="py-10 text-center">
                <Spinner size={16} />
              </div>
            ) : (
              /*
                긴 기획서가 창을 무한정 늘리지 않게 여기서만 스크롤한다. 창 전체가
                길어지면 `목록` 버튼이 화면 밖으로 밀려 돌아갈 길이 사라진다.
              */
              <div className="max-h-[62vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
                <MarkdownView markdown={readable(body.plan)} />
              </div>
            )}
          </div>
        ) : plans === null ? (
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
                  {/*
                    제목 자체를 누르게 한다. 옆에 `본문` 단추만 두면 제목을 눌러
                    보고 아무 일도 안 일어나는 쪽을 먼저 겪는다.
                  */}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-bold underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--primary)]"
                    onClick={() => plansOf && void openBody(plansOf, plan)}
                    title="기획서 본문을 봅니다."
                  >
                    {plan.title || '(제목 없음)'}
                  </button>
                  <span className="text-[11px] whitespace-nowrap text-[var(--fg-subtle)]">
                    수정 {day(plan.updatedAt)} · 만듦 {day(plan.createdAt)}
                  </span>
                  <button
                    className="btn btn-sm shrink-0"
                    onClick={() => plansOf && void openBody(plansOf, plan)}
                  >
                    <FileText size={12} />
                    본문
                  </button>
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
