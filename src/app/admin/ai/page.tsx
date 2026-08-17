'use client';

/**
 * AI 설정 — 공급자·엔드포인트·모델·추론 강도를 여기서 바꾼다.
 *
 * ## 두 가지를 나란히 보여 준다
 *
 * **적어 둔 값**과 **지금 실제로 도는 값**은 다르다. 빈 칸은 환경변수를 따르기
 * 때문이다. 적어 둔 것만 보이면 "비워 뒀는데 뭘로 도는 거지" 를 알 수 없고,
 * 도는 값만 보이면 그게 화면에서 정한 건지 환경변수에서 온 건지 알 수 없다.
 *
 * ## API 키
 *
 * 넣을 수 있다. 다만 **넣은 값을 다시 보여 주지는 않는다.** 저장할 때 잠그고
 * (`AUTH_SECRET` 에서 뽑은 열쇠로 AES-256-GCM), 화면에는 꼬리표(`••••7890`)와
 * 어디서 온 키인지만 내려온다. 키가 브라우저로 내려가면 관리자 화면을 여는
 * 것만으로 새어 나가기 때문이다.
 *
 * 칸을 비워 두고 저장하면 **건드리지 않는다.** 다른 칸만 고칠 때 매번 키를 다시
 * 치게 하면 안 된다. 지우려면 `키 지우기` 를 따로 누른다.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, KeyRound, RotateCcw, Save, Trash2 } from 'lucide-react';

import { Panel, ReadRow } from '@/components/settings/Parts';
import { Spinner, useToast } from '@/components/ui';
import { ENGINE_LABEL, ENGINE_TIERS } from '@/lib/ai/engines';
import {
  EFFORT_CHOICES,
  EFFORT_LABEL,
  EMPTY_AI_CONFIG,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  type AiConfig,
} from '@/lib/ai/config';

interface Effective {
  provider: string;
  enabled: boolean;
  baseUrl: string;
  models: { basic: string; advanced: string };
  effort: string;
  maxOutputTokens: number;
  hasKey: boolean;
  /** 키가 어디서 왔는지 — 화면에서 넣은 것인지, 환경변수인지, 아예 없는지. */
  keyFrom: 'screen' | 'env' | 'none';
}

interface Loaded {
  config: AiConfig;
  updatedAt: string | null;
  updatedBy: string;
  effective: Effective;
}

const PROVIDERS: { value: AiConfig['provider']; label: string; what: string }[] = [
  { value: '', label: '환경변수를 따름', what: 'AI_PROVIDER · 키가 있는 쪽 순서대로' },
  { value: 'deepseek', label: 'DeepSeek (OpenAI 호환)', what: 'DEEPSEEK_API_KEY 가 있어야 합니다' },
  { value: 'anthropic', label: 'Claude', what: 'ANTHROPIC_API_KEY 가 있어야 합니다' },
  { value: 'local', label: '내장 생성기 (AI 안 씀)', what: '규칙 기반. 키가 필요 없습니다' },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block last:mb-0">
      <span className="mb-1 block text-[12px] font-semibold text-[var(--fg-muted)]">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          {hint}
        </span>
      )}
    </label>
  );
}

export default function AdminAi() {
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<AiConfig>(EMPTY_AI_CONFIG);
  const [saving, setSaving] = useState(false);
  /*
   * 키는 초안에 담지 않는다. 저장된 값을 화면으로 내려받지 않으므로 담을 것이
   * 없고, 빈 칸을 "지우기" 로 오해하면 안 되기 때문이다. **적었을 때만** 보낸다.
   */
  const [keyDraft, setKeyDraft] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin?view=ai', { cache: 'no-store' });
    const body = (await res.json()) as Loaded;
    setData(body);
    setDraft(body.config);
  }, []);

  useEffect(() => {
    load().catch(() => toast('설정을 불러오지 못했습니다.', 'warn'));
  }, [load, toast]);

  const edit = (patch: Partial<AiConfig>) => setDraft((prev) => ({ ...prev, ...patch }));

  /** 넣어 둔 키를 지운다. 환경변수로 되돌아간다. */
  const clearKey = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai', config: draft, apiKey: null }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast(body.error ?? '지우지 못했습니다.', 'warn');
        return;
      }
      setKeyDraft('');
      await load();
      toast('키를 지웠습니다. 환경변수의 키를 씁니다.', 'ok');
    } catch {
      toast('지우지 못했습니다.', 'warn');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ai',
          config: draft,
          // 안 적었으면 아예 안 보낸다 = 건드리지 않는다.
          ...(keyDraft.trim() ? { apiKey: keyDraft } : {}),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast(body.error ?? '저장하지 못했습니다.', 'warn');
        return;
      }
      setKeyDraft('');
      await load();
      toast('저장했습니다. 다음 생성부터 적용됩니다.', 'ok');
    } catch {
      toast('저장하지 못했습니다.', 'warn');
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="empty" style={{ minHeight: '40vh' }}>
        <Spinner size={18} />
      </div>
    );
  }

  const { effective } = data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.config);
  const sameModel = effective.models.basic === effective.models.advanced;

  return (
    <>
      {/*
        무엇이 도는지가 먼저다. 고치는 칸부터 보여 주면 지금 상태를 모른 채
        고치게 된다.
      */}
      <Panel title="지금 실제로 도는 값" description="빈 칸은 환경변수를 따릅니다.">
        <ReadRow
          label="상태"
          value={effective.enabled ? 'AI 로 만듭니다' : '내장 생성기로 만듭니다'}
        />
        <ReadRow label="공급자" value={effective.provider} />
        <ReadRow label="엔드포인트" value={effective.baseUrl || '(공급자 기본)'} />
        {ENGINE_TIERS.map((tier) => (
          <ReadRow key={tier} label={ENGINE_LABEL[tier]} value={effective.models[tier] || '-'} />
        ))}
        <ReadRow
          label="추론 강도"
          value={effective.effort ? effective.effort : '자동 (되는 만큼 가장 높게)'}
        />
        <ReadRow
          label="출력 상한"
          value={`${effective.maxOutputTokens.toLocaleString()} 토큰`}
        />

        <ReadRow
          label="API 키"
          value={
            effective.keyFrom === 'screen'
              ? `${data.config.apiKeyLabel || '설정됨'} (이 화면에서 넣음)`
              : effective.keyFrom === 'env'
                ? '환경변수'
                : '없음'
          }
        />

        {!effective.hasKey && effective.provider !== 'local' && (
          <p
            className="mt-2 flex items-start gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              <b>이 공급자의 API 키가 없습니다.</b> 지금은 내장 생성기로 만들고 있습니다.
              아래 <b>API 키</b> 칸에 넣어 주세요.
            </span>
          </p>
        )}

        {sameModel && effective.enabled && (
          <p
            className="mt-2 flex items-start gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              <b>두 등급이 같은 모델을 씁니다.</b> 사용자가 고급을 골라도 달라지는 것이 없습니다.
            </span>
          </p>
        )}

        {data.updatedAt && (
          <p className="mt-2 text-[11.5px] text-[var(--fg-subtle)]">
            마지막으로 고친 사람: {data.updatedBy || '-'} ·{' '}
            {new Date(data.updatedAt).toLocaleString('ko-KR')}
          </p>
        )}
      </Panel>

      <Panel
        title="고치기"
        description="비워 두면 환경변수를 따릅니다. 저장하면 다음 생성부터 적용됩니다 — 다시 배포할 필요가 없습니다."
      >
        <Field label="공급자" hint={PROVIDERS.find((p) => p.value === draft.provider)?.what}>
          <select
            className="input"
            value={draft.provider}
            onChange={(e) => edit({ provider: e.target.value as AiConfig['provider'] })}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value || 'auto'} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="엔드포인트"
          hint="OpenAI 호환 주소. 비우면 공급자 기본값을 씁니다. 예: https://api.deepseek.com"
        >
          <input
            className="input"
            value={draft.baseUrl}
            placeholder="(환경변수를 따름)"
            onChange={(e) => edit({ baseUrl: e.target.value })}
          />
        </Field>

        {/*
          등급 이름은 사용자 화면에도 나가는 말이다. 여기서 그 이름과 모델을
          짝지어 보여 줘야, 사용자가 `고급` 을 골랐을 때 무엇이 도는지 알 수 있다.
        */}
        {ENGINE_TIERS.map((tier) => (
          <Field
            key={tier}
            label={`${ENGINE_LABEL[tier]} 모델`}
            hint={
              tier === 'basic'
                ? '사용자가 설정에서 이 등급을 고르면 이 모델로 만듭니다.'
                : '두 등급을 같은 모델로 두면 사용자가 고급을 골라도 달라지지 않습니다.'
            }
          >
            <input
              className="input font-mono text-[12px]"
              value={draft.models[tier]}
              placeholder="(환경변수를 따름)"
              onChange={(e) => edit({ models: { ...draft.models, [tier]: e.target.value } })}
            />
          </Field>
        ))}

        <Field
          label="추론 강도"
          hint="자동은 max → xhigh → high 순으로 시도하고, 엔드포인트가 거부하면 한 칸씩 내려온 뒤 마지막에는 보내지 않습니다. 받는 값을 확실히 아시면 못 박으세요."
        >
          <select
            className="input"
            value={draft.effort}
            onChange={(e) => edit({ effort: e.target.value as AiConfig['effort'] })}
          >
            {EFFORT_CHOICES.map((choice) => (
              <option key={choice || 'auto'} value={choice}>
                {EFFORT_LABEL[choice]}
              </option>
            ))}
          </select>
        </Field>

        {/*
          키는 초안(`draft`)이 아니라 따로 둔다. 저장된 값을 내려받지 않으므로
          채워 넣을 것이 없고, 빈 칸을 "지우기" 로 읽으면 안 되기 때문이다.
        */}
        <Field
          label="API 키"
          hint={
            effective.keyFrom === 'screen'
              ? `지금 ${data.config.apiKeyLabel || '설정됨'} 이(가) 들어 있습니다. 비워 두고 저장하면 그대로 둡니다.`
              : effective.keyFrom === 'env'
                ? '지금은 환경변수의 키를 쓰고 있습니다. 여기에 넣으면 이 값이 앞섭니다.'
                : '넣으면 잠가서 보관합니다. 넣은 값은 다시 볼 수 없고, 끝 네 자리만 보입니다.'
          }
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              className="input font-mono text-[12px]"
              style={{ flex: '1 1 260px' }}
              type="password"
              autoComplete="off"
              value={keyDraft}
              placeholder={effective.keyFrom === 'screen' ? '(그대로 둡니다)' : '키를 붙여 넣으세요'}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            {effective.keyFrom === 'screen' && (
              <button
                className="btn btn-sm shrink-0"
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                disabled={saving}
                onClick={() => void clearKey()}
              >
                <Trash2 size={13} />
                키 지우기
              </button>
            )}
          </div>
        </Field>

        <Field
          label="출력 상한 (토큰)"
          hint={`비우면 환경변수를 따릅니다. ${MIN_OUTPUT_TOKENS.toLocaleString()} ~ ${MAX_OUTPUT_TOKENS.toLocaleString()} · 모델이 받아 주는 값보다 크면 매 호출이 실패합니다.`}
        >
          <input
            className="input"
            type="number"
            value={draft.maxOutputTokens || ''}
            placeholder="(환경변수를 따름)"
            onChange={(e) => edit({ maxOutputTokens: Number(e.target.value) || 0 })}
          />
        </Field>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            className={`btn btn-primary btn-sm${saving ? ' is-busy' : ''}`}
            disabled={saving || (!dirty && !keyDraft.trim())}
            onClick={() => void save()}
          >
            {saving ? <Spinner size={13} /> : <Save size={13} />}
            저장
          </button>
          <button
            className="btn btn-sm"
            disabled={saving || !dirty}
            onClick={() => setDraft(data.config)}
          >
            <RotateCcw size={13} />
            되돌리기
          </button>
          {/* 전부 비우면 이 기능이 생기기 전과 똑같이 환경변수만으로 돈다. */}
          <button
            className="btn btn-sm"
            disabled={saving}
            onClick={() => setDraft({ ...EMPTY_AI_CONFIG, models: { basic: '', advanced: '' } })}
          >
            모두 비우기
          </button>
          {(dirty || keyDraft.trim()) && (
            <span className="ml-auto flex items-center gap-1 text-[11.5px] font-semibold text-[var(--warn)]">
              {keyDraft.trim() && <KeyRound size={11} />}
              저장 안 함
            </span>
          )}
          {!dirty && !keyDraft.trim() && (
            <span className="ml-auto flex items-center gap-1 text-[11.5px] text-[var(--fg-subtle)]">
              <Check size={11} />
              저장됨
            </span>
          )}
        </div>
      </Panel>

      <Panel title="알아 두실 것">
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          <li>
            · <b>넣은 API 키는 잠가서 보관합니다.</b> 다시 볼 수는 없고 끝 네 자리만 보입니다.
            <code>AUTH_SECRET</code> 을 바꾸면 이 키를 못 풀게 되어 환경변수로 되돌아갑니다 —
            그때는 다시 넣으시면 됩니다.
          </li>
          <li>
            · 저장하면 <b>다음 생성부터</b> 적용됩니다. 지금 만들고 있는 것은 시작할 때의 설정을
            그대로 씁니다.
          </li>
          <li>
            · 여기서 정한 것은 <b>모든 사용자</b>에게 걸립니다. 사용자는 설정 → 만들기에서
            <b> 기본 / 고급</b> 중 어느 쪽을 쓸지만 고릅니다.
          </li>
          <li>
            · 모델 이름이 틀리면 매 호출이 실패하고 <b>내장 생성기로 대체</b>됩니다. 문서는
            만들어지지만 결이 달라집니다 — 저장 뒤에 하나 만들어 확인해 보세요.
          </li>
        </ul>
      </Panel>
    </>
  );
}
