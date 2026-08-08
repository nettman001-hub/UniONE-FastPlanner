'use client';

/**
 * 연결 — 바깥 서비스.
 *
 * 스티치 연결은 원래 내보내기 화면 안에만 있었다. 그런데 연결은 그 플랜의 일이
 * 아니라 **계정의 일이다** — 한 번 이어 두면 모든 플랜에서 쓴다. 그런 것이 산출물
 * 화면 깊숙이 묻혀 있으면 끊거나 다시 잇고 싶을 때 어디로 가야 할지 모른다.
 *
 * 상태는 `useStitchConnection` 하나를 두 화면이 나눠 쓴다.
 */

import { ExternalLink, Link2, Lock, Unlink } from 'lucide-react';

import { Panel } from '@/components/settings/Parts';
import { Spinner, useToast } from '@/components/ui';
import { useStitchConnection } from '@/lib/design/useStitchConnection';

/** 아직 못 붙이는 것들. **왜** 아직인지를 함께 적는다. */
const SOON = [
  {
    name: 'Claude Design',
    what: '설명을 주면 화면 시안을 만들어 줍니다.',
    why: '사장님 구독 계정으로만 열려, 우리 서버가 대신 연결할 수 없습니다. 지금은 내보내기에서 요청문을 복사해 쓰실 수 있습니다.',
  },
  {
    name: 'Figma',
    what: '디자이너가 화면을 직접 그리는 도구입니다.',
    why: '문장이 아니라 파일을 주고받는 도구라 연결 방식이 다릅니다. 지금은 내보내기에서 SVG 를 받아 끌어다 놓으시면 됩니다.',
  },
  {
    name: 'GitHub',
    what: '기획서를 저장소에 올려 둡니다.',
    why: '기획이 바뀔 때마다 저장소에도 남기는 기능을 준비 중입니다.',
  },
];

export default function IntegrationSettings() {
  const toast = useToast();
  const { status, secret, setSecret, saving, connect, disconnect, error } = useStitchConnection();

  const handleConnect = async () => {
    const ok = await connect();
    toast(ok ? '스티치를 연결했습니다.' : (error ?? '연결하지 못했습니다.'), ok ? 'ok' : 'warn');
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast('연결을 끊었습니다. 스티치에 만들어 둔 화면은 그대로 남습니다.', 'ok');
  };

  return (
    <>
      <Panel
        title="Google Stitch"
        description="연결하면 내보내기에서 고른 화면을 사장님 스티치 계정에 바로 만듭니다."
      >
        {status === null ? (
          <p className="text-[12px] text-[var(--fg-muted)]">연결 상태를 확인하는 중입니다…</p>
        ) : status.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip chip-primary">
              <Link2 size={11} />
              연결됨 {status.label}
            </span>
            <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
              붙여 넣은 값은 암호화해 보관하고 화면으로 다시 내보내지 않습니다.
            </span>
            <button className="btn btn-sm shrink-0" onClick={() => void handleDisconnect()}>
              <Unlink size={12} />
              연결 해제
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                className="input min-w-0 flex-1"
                type="password"
                value={secret}
                placeholder="스티치에서 발급받은 키를 붙여 넣으세요"
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleConnect();
                }}
              />
              <button
                className={`btn btn-primary btn-sm shrink-0${saving ? ' is-busy' : ''}`}
                disabled={saving || secret.trim().length === 0}
                onClick={() => void handleConnect()}
              >
                {saving ? <Spinner size={13} /> : <Link2 size={13} />}
                연결
              </button>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
              붙여 넣은 값은 암호화해 보관하고 화면으로 다시 내보내지 않습니다. 언제든 끊을 수
              있습니다. 연결하지 않으셔도 내보내기에서 요청문을 복사해 쓰는 길은 그대로 열려
              있습니다.
            </p>
            <a
              className="btn btn-sm mt-2"
              href="https://stitch.withgoogle.com"
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={12} />
              스티치 열기
            </a>
          </>
        )}
      </Panel>

      {SOON.map((item) => (
        <section key={item.name} className="card mb-3.5 px-4 py-4">
          <div className="flex items-center gap-1.5">
            <Lock size={13} className="text-[var(--fg-subtle)]" />
            <h2 className="text-[13.5px] font-extrabold tracking-tight">{item.name}</h2>
            <span className="chip">준비 중</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">{item.what}</p>
          <p className="mt-2.5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--fg-subtle)]">
            {item.why}
          </p>
        </section>
      ))}
    </>
  );
}
