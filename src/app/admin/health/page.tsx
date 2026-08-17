'use client';

/**
 * 점검 — 지금 무엇이 어떻게 물려 있는지.
 *
 * 여기서는 **공급자와 모델을 보여 준다.** 사용자에게 감추는 규칙은 일반 화면에
 * 대한 것이고, 관리자는 무엇이 도는지 알아야 고칠 수 있다.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

import { Panel, ReadRow } from '@/components/settings/Parts';
import { Spinner } from '@/components/ui';

interface Health {
  storage: { kind: 'postgres' | 'file'; dir?: string; ephemeral: boolean };
  signup: string;
  ai: {
    enabled: boolean;
    provider: string;
    /** 등급마다 실제로 걸린 모델. 짝으로 봐야 한쪽만 넣어 둔 것을 잡는다. */
    engines: { basic: string; advanced: string };
    maxOutputTokens: number;
  };
  stitch: string;
  authSecret: boolean;
}

const SIGNUP_LABEL: Record<string, string> = {
  open: '누구나 가입',
  code: '초대 코드가 있어야 가입',
  closed: '가입 막음',
};

function Flag({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold"
      style={{ color: ok ? 'var(--ok)' : 'var(--warn)' }}
    >
      {ok ? <Check size={12} /> : <AlertTriangle size={12} />}
      {ok ? good : bad}
    </span>
  );
}

export default function AdminHealth() {
  const [data, setData] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin?view=health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Health) => alive && setData(d))
      .catch(() => {
        /* 아래에서 계속 도는 표시로 남는다 */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!data) {
    return (
      <div className="empty" style={{ minHeight: '30vh' }}>
        <Spinner size={18} />
      </div>
    );
  }

  return (
    <>
      <Panel title="저장">
        <ReadRow
          label="어디에"
          value={data.storage.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'PGlite — 이 서버의 파일'}
        />
        {data.storage.dir && <ReadRow label="폴더" value={data.storage.dir} />}
        {/*
          배포 환경인데 데이터베이스가 없을 때만 경고한다. 로컬에서 파일로 두는
          것은 정상이고, 그걸 경고로 띄우면 진짜 경고를 흘려보게 된다.
        */}
        {data.storage.ephemeral && (
          <p className="mt-2 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            <b>배포 환경인데 데이터베이스가 없습니다.</b> 지금은 인스턴스의 파일에 쓰고 있어,
            다시 배포하면 계정과 플랜이 모두 사라집니다. <code>DATABASE_URL</code> 을 넣어 주세요.
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
          <span className="w-24 shrink-0 text-[12px] font-semibold text-[var(--fg-muted)]">
            암호화 열쇠
          </span>
          <span className="min-w-0 flex-1 text-[12.5px]">
            <Flag ok={data.authSecret} good="AUTH_SECRET 있음" bad="AUTH_SECRET 없음" />
          </span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          이 열쇠로 스티치 자격증명을 암호화합니다. 없으면 연결 기능이 동작하지 않습니다.
        </p>
      </Panel>

      <Panel title="AI">
        <div className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--border)] py-2.5">
          <span className="w-24 shrink-0 text-[12px] font-semibold text-[var(--fg-muted)]">
            상태
          </span>
          <span className="min-w-0 flex-1 text-[12.5px]">
            <Flag ok={data.ai.enabled} good="켜짐" bad="꺼짐 — 기본 생성기로 동작" />
          </span>
        </div>
        <ReadRow label="공급자" value={data.ai.provider} />
        <ReadRow label="기본 엔진" value={data.ai.engines.basic || '-'} />
        <ReadRow label="고급 엔진" value={data.ai.engines.advanced || '-'} />
        <ReadRow label="출력 상한" value={`${data.ai.maxOutputTokens.toLocaleString()} 토큰`} />
        {/*
          둘이 같으면 환경변수를 한쪽만 넣어 둔 것이다. 그대로 두면 사용자가
          고급을 골라도 달라지는 게 없는데, 화면에는 골랐다고 나온다.
        */}
        {data.ai.enabled && data.ai.engines.basic === data.ai.engines.advanced && (
          <p
            className="mt-2 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
          >
            <b>두 등급이 같은 모델을 씁니다.</b> 사용자가 고급을 골라도 달라지는 것이
            없습니다. <code>DEEPSEEK_MODEL_BASIC</code> · <code>DEEPSEEK_MODEL_ADVANCED</code> 를
            확인하세요.
          </p>
        )}
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          공급자와 모델은 <b>이 화면에서만</b> 보입니다. 일반 사용자 화면에는 등급 이름
          (<b>기본</b>·<b>고급</b>)만 나갑니다.
        </p>
      </Panel>

      <Panel title="그 밖에">
        <ReadRow label="가입 정책" value={SIGNUP_LABEL[data.signup] ?? data.signup} />
        <ReadRow label="스티치 주소" value={data.stitch} />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          가입 정책은 환경변수(<code>SIGNUP_CODE</code> · <code>ALLOW_SIGNUP</code>)로 정합니다.
          화면에서 바꾸는 기능은 아직 없습니다.
        </p>
      </Panel>
    </>
  );
}
