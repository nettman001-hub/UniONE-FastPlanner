'use client';

/**
 * 기획 스킬 — 단계마다 "이런 식으로 써 달라" 를 적어 둔다.
 *
 * **빈 칸을 주면 아무도 안 쓴다.** 무엇을 적어야 하는지 모르기 때문이다.
 * 그래서 단계마다 `예시 넣기` 를 두고, 그걸 고쳐 쓰게 한다.
 *
 * 그리고 **바꿀 수 없는 것을 미리 밝힌다.** 스킬로 되는 것은 내용과 문체이지
 * 구조가 아니다. 안 밝히면 "썼는데 반영이 안 된다" 는 불만이 나온다.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Info, Save } from 'lucide-react';

import { Panel } from '@/components/settings/Parts';
import { SkillBody } from '@/components/SkillBody';
import { Spinner, useToast } from '@/components/ui';
import { SKILL_ARTIFACTS, skillTitle, type Skill } from '@/lib/skills';
import type { ArtifactKey } from '@/lib/types';

interface Draft {
  body: string;
  enabled: boolean;
  /** 저장된 것과 달라졌는가. */
  dirty: boolean;
  saving: boolean;
}

const EMPTY: Draft = { body: '', enabled: true, dirty: false, saving: false };

export default function SkillSettings() {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/skills')
      .then((r) => r.json())
      .then((d: { skills?: Skill[] }) => {
        if (!alive) return;
        const next: Record<string, Draft> = {};
        for (const skill of d.skills ?? []) {
          next[skill.artifact] = { ...EMPTY, body: skill.body, enabled: skill.enabled };
        }
        setDrafts(next);
      })
      .catch(() => {
        if (alive) toast('지침을 불러오지 못했습니다.', 'warn');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [toast]);

  const draftOf = (artifact: ArtifactKey): Draft => drafts[artifact] ?? EMPTY;

  const edit = (artifact: ArtifactKey, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [artifact]: { ...(prev[artifact] ?? EMPTY), ...patch } }));

  const save = useCallback(
    async (artifact: ArtifactKey, override?: Partial<Draft>) => {
      const current = { ...(drafts[artifact] ?? EMPTY), ...override };
      setDrafts((prev) => ({ ...prev, [artifact]: { ...current, saving: true } }));
      try {
        const res = await fetch('/api/skills', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artifact,
            body: current.body,
            enabled: current.enabled,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast(data.error ?? '저장하지 못했습니다.', 'warn');
          setDrafts((prev) => ({ ...prev, [artifact]: { ...current, saving: false } }));
          return;
        }
        setDrafts((prev) => ({
          ...prev,
          [artifact]: { ...current, dirty: false, saving: false },
        }));
        toast(`${skillTitle(artifact)} 지침을 저장했습니다.`, 'ok');
      } catch {
        toast('저장하지 못했습니다.', 'warn');
        setDrafts((prev) => ({ ...prev, [artifact]: { ...current, saving: false } }));
      }
    },
    [drafts, toast],
  );

  if (loading) {
    return (
      <div className="empty" style={{ minHeight: '40vh' }}>
        <Spinner size={18} />
      </div>
    );
  }

  const on = SKILL_ARTIFACTS.filter((a) => draftOf(a).enabled && draftOf(a).body.trim()).length;

  return (
    <>
      <Panel title="기획 스킬" description="단계마다 적어 두면 만들 때마다 그 결을 따릅니다.">
        <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--fg-subtle)]" />
          <div className="min-w-0 text-[12px] leading-relaxed text-[var(--fg-muted)]">
            {/*
              바꿀 수 없는 것을 미리 밝힌다. 안 밝히면 "썼는데 반영이 안 된다" 가 된다.
            */}
            <p>
              바꿀 수 있는 것은 <b>내용과 문체</b>입니다. 문서의 <b>구조</b>는 바꿀 수 없습니다.
            </p>
            <p className="mt-1.5">
              ✅ &ldquo;요구사항은 <code>~해야 한다</code>로 끝낸다&rdquo;, &ldquo;우리 용어(회원/운영자)를
              쓴다&rdquo;
            </p>
            <p className="mt-0.5">
              ❌ &ldquo;PRD에 리스크 항목을 추가한다&rdquo;, &ldquo;우선순위를 다섯 단계로&rdquo; — 담을
              자리가 없습니다
            </p>
          </div>
        </div>
        <p className="mt-2.5 text-[12px] text-[var(--fg-muted)]">
          지금 <b>{on}개</b> 단계에 지침이 켜져 있습니다. 이 계정으로 만드는 모든 플랜에
          적용됩니다.
        </p>
        {/*
          여기 적은 것이 모든 플랜에 걸린다는 말만 하면, 고객사마다 용어가 다른
          경우에 쓸 방법이 없어 보인다. 어디서 예외를 두는지 같이 알려 준다.
        */}
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          어떤 플랜만 다르게 하고 싶다면 그 플랜의 <b>개요 → 이 플랜의 작성 지침</b>에서 따로
          적으면 됩니다. 그 플랜에서는 여기 것 대신 그것이 쓰입니다.
        </p>
      </Panel>

      {SKILL_ARTIFACTS.map((artifact) => {
        const draft = draftOf(artifact);
        const active = draft.enabled && draft.body.trim().length > 0;
        return (
          <section key={artifact} className="card mb-3.5 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-[13.5px] font-extrabold tracking-tight">
                {skillTitle(artifact)}
              </h2>
              {active && (
                <span className="chip chip-primary">
                  <Check size={11} />
                  적용 중
                </span>
              )}
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-[var(--fg-muted)]">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={draft.enabled}
                  onChange={(e) => void save(artifact, { enabled: e.target.checked })}
                />
                켜기
              </label>
            </div>

            <SkillBody
              artifact={artifact}
              value={draft.body}
              disabled={draft.saving}
              onChange={(body) => edit(artifact, { body, dirty: true })}
              note={draft.dirty ? <b className="ml-1.5 text-[var(--warn)]">저장 안 함</b> : null}
            >
              <button
                className={`btn btn-primary btn-sm${draft.saving ? ' is-busy' : ''}`}
                disabled={draft.saving || !draft.dirty}
                onClick={() => void save(artifact)}
              >
                {draft.saving ? <Spinner size={13} /> : <Save size={13} />}
                저장
              </button>
            </SkillBody>
          </section>
        );
      })}

      <Panel title="적어 두면 좋은 것">
        <ul className="flex flex-col gap-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          <li>· <b>우리 용어</b> — 회원 / 셀러 / 운영자처럼 부르는 이름</li>
          <li>· <b>문장 끝맺음</b> — &lsquo;~합니다&rsquo; 인지 &lsquo;~함&rsquo; 인지</li>
          <li>· <b>빠뜨리면 안 되는 것</b> — 오류 상황, 빈 상태, 권한 구분</li>
          <li>· <b>쓰지 말 것</b> — 회사에서 안 쓰는 표현이나 금지어</li>
        </ul>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          길게 적을수록 좋은 것은 아닙니다. 지침이 길면 그만큼 문서에 쓸 여유가 줄어듭니다.
          꼭 지켜야 할 것만 적으세요.
        </p>
      </Panel>
    </>
  );
}
