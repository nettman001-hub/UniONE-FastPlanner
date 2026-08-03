'use client';

/**
 * 로그인 상태를 앱 전체가 공유한다.
 *
 * 화면마다 `/api/auth/me` 를 부르면 깜빡이므로 한 번만 불러 나눠 쓴다.
 * 여기서 하는 일은 **표시**뿐이다 — 실제 차단은 서버가 한다. 브라우저에서
 * 상태를 조작해 봐야 `/api/*` 가 401 을 돌려준다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SignupMode } from './policy';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthValue {
  user: AuthUser | null;
  /** 아직 `/api/auth/me` 응답을 못 받은 상태. "로그인 안 함" 과 구분해야 한다. */
  loading: boolean;
  signup: SignupMode;
  /** 배포에 Postgres 를 붙였는지. 'local' 이면 이 서버 안에서만 저장된다. */
  database: 'postgres' | 'local';
  refresh: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signup, setSignup] = useState<SignupMode>('closed');
  const [database, setDatabase] = useState<'postgres' | 'local'>('local');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        user: AuthUser | null;
        signup: SignupMode;
        database: 'postgres' | 'local';
      };
      setUser(data.user);
      setSignup(data.signup);
      setDatabase(data.database);
      return data.user;
    } catch {
      // 네트워크가 끊겼을 뿐일 수도 있다. 로그아웃으로 단정하지 않는다.
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signup, database, refresh, logout }),
    [user, loading, signup, database, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 안에서만 쓸 수 있습니다.');
  return value;
}
