'use client';

/**
 * 계정 — 이름·비밀번호·탈퇴.
 *
 * 셋 다 서버가 판단한다. 여기서 하는 것은 **묻고 알려 주는 일**뿐이다.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Save, Trash2 } from 'lucide-react';

import { Panel, ReadRow } from '@/components/settings/Parts';
import { Field, Spinner, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth/client';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/auth/rules';
import { usePlannerStore } from '@/lib/store';

export default function AccountSettings() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const plans = usePlannerStore((s) => s.plans);

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 계정을 받아오기 전에는 빈 칸이다. 받아온 뒤 한 번 채운다.
  useEffect(() => {
    if (user) setName((prev) => prev || user.name);
  }, [user]);

  if (!user) return null;

  const saveName = async () => {
    const value = name.trim();
    if (!value || value === user.name) return;
    setSavingName(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? '바꾸지 못했습니다.', 'warn');
        return;
      }
      await refresh();
      toast('이름을 바꿨습니다.', 'ok');
    } catch {
      toast('바꾸지 못했습니다.', 'warn');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    const problem = passwordProblem(next);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? '바꾸지 못했습니다.', 'warn');
        return;
      }
      setCurrent('');
      setNext('');
      toast('비밀번호를 바꿨습니다.', 'ok');
    } catch {
      toast('바꾸지 못했습니다.', 'warn');
    } finally {
      setSavingPw(false);
    }
  };

  const removeAccount = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: confirmEmail }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? '지우지 못했습니다.', 'warn');
        return;
      }
      // 이 브라우저에 남은 것도 함께 비운다. 안 그러면 다음 사람에게 보인다.
      await logout();
      router.replace('/login');
    } catch {
      toast('지우지 못했습니다.', 'warn');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Panel title="내 정보">
        <div className="mb-3">
          <ReadRow label="이메일" value={user.email} hint="지금은 바꿀 수 없습니다" />
        </div>
        <Field label="이름" hint="화면 곳곳에서 사장님을 가리키는 이름입니다.">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              className="input min-w-0 flex-1"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
              }}
            />
            <button
              className={`btn btn-primary btn-sm shrink-0${savingName ? ' is-busy' : ''}`}
              disabled={savingName || !name.trim() || name.trim() === user.name}
              onClick={() => void saveName()}
            >
              {savingName ? <Spinner size={13} /> : <Save size={13} />}
              저장
            </button>
          </div>
        </Field>
      </Panel>

      <Panel
        title="비밀번호 바꾸기"
        description="지금 비밀번호를 함께 넣어 주세요. 자리를 비운 사이에 남이 바꾸는 일을 막습니다."
      >
        <div className="flex flex-col gap-2.5">
          <Field label="지금 비밀번호">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="새 비밀번호" hint={`${PASSWORD_MIN_LENGTH}자 이상`}>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void savePassword();
              }}
            />
          </Field>
          <div>
            <button
              className={`btn btn-primary btn-sm${savingPw ? ' is-busy' : ''}`}
              disabled={savingPw || !current || !next}
              onClick={() => void savePassword()}
            >
              {savingPw ? <Spinner size={13} /> : <KeyRound size={13} />}
              비밀번호 바꾸기
            </button>
          </div>
        </div>
      </Panel>

      <Panel
        title="계정 지우기"
        danger
        description="계정과 함께 플랜, 연결해 둔 자격증명이 모두 사라집니다. 되돌릴 수 없습니다."
      >
        {plans.length > 0 && (
          <p className="mb-2.5 text-[12px] leading-relaxed text-[var(--warn)]">
            지금 <b>플랜 {plans.length}개</b>가 있습니다. 남기고 싶으시면 먼저{' '}
            <b>데이터 → 전체 백업 받기</b>로 내려받아 두세요.
          </p>
        )}
        <Field
          label="확인"
          hint={`정말 지우시려면 ${user.email} 을 그대로 적어 주세요.`}
        >
          <input
            className="input"
            value={confirmEmail}
            placeholder={user.email}
            onChange={(e) => setConfirmEmail(e.target.value)}
          />
        </Field>
        <div className="mt-2.5">
          <button
            className={`btn btn-sm${deleting ? ' is-busy' : ''}`}
            style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
            disabled={deleting || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()}
            onClick={() => void removeAccount()}
          >
            {deleting ? <Spinner size={13} /> : <Trash2 size={13} />}
            계정을 완전히 지웁니다
          </button>
        </div>
      </Panel>
    </>
  );
}
