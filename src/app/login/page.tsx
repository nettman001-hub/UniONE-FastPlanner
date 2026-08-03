'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, LogIn, ShieldCheck, UserPlus } from 'lucide-react';

import { useAuth } from '@/lib/auth/client';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/rules';
import { Field, Spinner } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';

type Tab = 'login' | 'signup';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, signup, refresh } = useAuth();

  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `?next=` 는 브라우저가 준 값이다. 다른 사이트로 튕기지 않도록 앱 안 경로만 받는다.
  const raw = params.get('next') ?? '/';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [user, loading, next, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(tab === 'login' ? '/api/auth/login' : '/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          tab === 'login' ? { email, password } : { email, password, name, code },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? '요청에 실패했습니다.');
        return;
      }
      // 쿠키가 심어졌으니 상태를 새로 읽고 넘어간다.
      await refresh();
      router.replace(next);
    } catch {
      setError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const signupClosed = signup === 'closed';

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 px-4 py-10 sm:py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo size={44} />
        <h1 className="text-[22px] font-extrabold tracking-tight">{BRAND_NAME}</h1>
        <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">{BRAND_TAGLINE}</p>
      </div>

      <div className="card p-5">
        <div className="mb-4 flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
          {(['login', 'signup'] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                tab === key
                  ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--fg-subtle)] hover:text-[var(--fg)]'
              }`}
              onClick={() => {
                setTab(key);
                setError(null);
              }}
            >
              {key === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        {tab === 'signup' && signupClosed ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ShieldCheck size={26} className="text-[var(--fg-subtle)]" />
            <p className="text-[13px] font-bold">지금은 새 계정을 만들 수 없습니다</p>
            <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">
              관리자에게 테스트 계정이나 초대 코드를 요청해 주세요.
            </p>
          </div>
        ) : (
          <form className="flex flex-col gap-3.5" onSubmit={submit}>
            <Field label="이메일" required>
              <input
                className="input"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field
              label="비밀번호"
              required
              hint={tab === 'signup' ? `${PASSWORD_MIN_LENGTH}자 이상` : undefined}
            >
              <input
                className="input"
                type="password"
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {tab === 'signup' && (
              <>
                <Field label="이름" hint="비워 두면 이메일 앞부분을 씁니다.">
                  <input
                    className="input"
                    value={name}
                    placeholder="홍길동"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                {signup === 'code' && (
                  <Field label="초대 코드" required>
                    <input
                      className="input"
                      value={code}
                      placeholder="관리자에게 받은 코드"
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                )}
              </>
            )}

            {error && (
              <p
                className="rounded-lg px-3 py-2 text-[12px] leading-relaxed"
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                role="alert"
              >
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-lg mt-1" disabled={busy}>
              {busy ? <Spinner size={14} /> : tab === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
              {tab === 'login' ? '로그인' : '가입하고 시작하기'}
            </button>
          </form>
        )}
      </div>

      <p className="text-center text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
        플랜은 계정에 저장되어 다른 기기에서도 이어서 볼 수 있습니다.
      </p>

      <div className="flex justify-center">
        <Link href="/docs" className="btn btn-ghost btn-sm">
          <BookOpen size={13} />
          설명서 보기
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams 는 Suspense 경계가 필요하다.
  return (
    <Suspense
      fallback={
        <div className="empty" style={{ minHeight: '60vh' }}>
          <Spinner size={18} />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
