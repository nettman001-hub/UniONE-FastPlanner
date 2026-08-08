'use client';

/**
 * 스티치 연결 상태 하나를 **두 화면이 나눠 쓴다.**
 *
 * 연결은 원래 내보내기 화면 안에만 있었다. 그런데 연결이란 것은 이 플랜의 일이
 * 아니라 **계정의 일이다** — 한 번 이어 두면 모든 플랜에서 쓴다. 그런 것이
 * 산출물 화면 깊숙이 묻혀 있으면, 끊거나 다시 잇고 싶을 때 어디로 가야 할지 모른다.
 *
 * 그래서 설정에도 같은 것을 둔다. 두 벌로 적어 두면 한쪽만 고치는 날이 오므로
 * 상태와 부르는 일은 여기 한 곳에 둔다. 그리는 모양만 화면마다 다르다.
 *
 * 자격증명은 이 파일을 지나가지 않는다. 저장은 서버로 보내고, 여기서 아는 것은
 * **연결됐는지와 꼬리표**뿐이다.
 */

import { useCallback, useEffect, useState } from 'react';

export interface StitchStatus {
  connected: boolean;
  /** 화면에 보여 줄 꼬리표(예: `••••7890`). 비밀이 아니다. */
  label: string;
}

export interface StitchConnection {
  /** 아직 물어보는 중이면 `null`. "연결 안 됨" 과 구분해야 깜빡이지 않는다. */
  status: StitchStatus | null;
  secret: string;
  setSecret: (value: string) => void;
  saving: boolean;
  /** 성공하면 true. 실패 사유는 `error` 에 담긴다. */
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  /** 마지막 실패 사유. 성공하면 비워진다. */
  error: string | null;
  /** 스티치가 값을 거절했을 때 바깥에서 연결 칸으로 되돌리는 통로. */
  markDisconnected: () => void;
}

export function useStitchConnection(): StitchConnection {
  const [status, setStatus] = useState<StitchStatus | null>(null);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/design/stitch')
      .then((r) => r.json())
      .then((d: StitchStatus) => {
        if (alive) setStatus({ connected: Boolean(d.connected), label: d.label ?? '' });
      })
      .catch(() => {
        // 못 물어봤다고 "연결 안 됨" 으로 단정하면, 네트워크가 잠깐 끊긴 것뿐인데
        // 연결 칸이 튀어나온다. 그래도 화면은 그려야 하므로 안 됨으로 둔다.
        if (alive) setStatus({ connected: false, label: '' });
      });
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    const value = secret.trim();
    if (!value) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/design/stitch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: value }),
      });
      const data = (await res.json()) as StitchStatus & { error?: string };
      if (!res.ok) {
        setError(data.error ?? '연결하지 못했습니다.');
        return false;
      }
      setStatus({ connected: true, label: data.label ?? '' });
      setSecret('');
      return true;
    } catch {
      setError('연결하지 못했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [secret]);

  const disconnect = useCallback(async () => {
    try {
      await fetch('/api/design/stitch', { method: 'DELETE' });
    } catch {
      /* 못 지워도 화면에서는 끊어진 것으로 본다. */
    }
    setStatus({ connected: false, label: '' });
  }, []);

  const markDisconnected = useCallback(() => {
    setStatus((prev) => (prev?.connected ? { connected: false, label: '' } : prev));
  }, []);

  return { status, secret, setSecret, saving, connect, disconnect, error, markDisconnected };
}
