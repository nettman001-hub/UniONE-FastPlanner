'use client';

/**
 * 이 플랜의 작성 지침 — "이 프로젝트만 다르게".
 *
 * 계정 설정에 적어 둔 것은 **모든 플랜**에 걸린다. 그런데 고객사마다 부르는
 * 이름이 다르거나, 이번 것만 문체를 달리해야 하는 일이 흔하다. 그럴 때
 * 계정 지침을 고치면 지난 플랜들까지 결이 바뀌어 버린다.
 *
 * 그래서 단계마다 셋 중 하나를 고르게 한다.
 *
 * | 고른 것 | 이 플랜을 만들 때 |
 * | --- | --- |
 * | 기본을 따름 | 설정에 적어 둔 것이 들어간다 |
 * | 이 플랜만 다르게 | 여기 적은 것이 **대신** 들어간다 |
 * | 이 플랜은 지침 없이 | 아무것도 안 들어간다 |
 *
 * ## 왜 개요에 두는가
 *
 * 지침은 **만들기 전에** 정해야 쓸모가 있다. 설정 메뉴 안쪽에 숨겨 두면
 * 만들고 나서야 발견하고, 그때는 이미 크레딧을 쓴 뒤다. 그렇다고 늘 펼쳐
 * 두면 개요가 길어지므로, 평소에는 접어 두고 지금 어떤 상태인지 한 줄로만
 * 알려 준다.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, PencilLine, Save } from 'lucide-react';

import { SkillBody } from '@/components/SkillBody';
import { SectionCard, Spinner, useToast } from '@/components/ui';
import {
  SKILL_ARTIFACTS,
  SKILL_SCOPE_LABEL,
  scopeOf,
  skillTitle,
  type Skill,
  type SkillScope,
} from '@/lib/skills';
import type { ArtifactKey } from '@/lib/types';

interface Row {
  scope: SkillScope;
  /** 이 플랜에 적어 둔 글. `기본을 따름` 이어도 지우지 않고 들고 있는다. */
  body: string;
  /** 계정에 적어 둔 글 — `기본을 따름` 일 때 실제로 들어갈 것. */
  base: string;
  dirty: boolean;
  saving: boolean;
}

const EMPTY: Row = { scope: 'inherit', body: '', base: '', dirty: false, saving: false };

const SCOPES: SkillScope[] = ['inherit', 'override', 'off'];

export function PlanSkills({ planId }: { planId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<ArtifactKey | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/skills?planId=${encodeURIComponent(planId)}`)
      .then((r) => r.json())
      .then((d: { skills?: Skill[]; defaults?: Skill[] }) => {
        if (!alive) return;
        const next: Record<string, Row> = {};
        for (const skill of d.defaults ?? []) {
          // 계정 것이 꺼져 있으면 `기본을 따름` 이라도 들어가는 글이 없다.
          next[skill.artifact] = { ...EMPTY, base: skill.enabled ? skill.body : '' };
        }
        for (const skill of d.skills ?? []) {
          const base = next[skill.artifact]?.base ?? '';
          next[skill.artifact] = { ...EMPTY, base, scope: scopeOf(skill), body: skill.body };
        }
        setRows(next);
      })
      .catch(() => {
        if (alive) toast('이 플랜의 지침을 불러오지 못했습니다.', 'warn');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [planId, toast]);

  const rowOf = (artifact: ArtifactKey): Row => rows[artifact] ?? EMPTY;

  const edit = (artifact: ArtifactKey, patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [artifact]: { ...(prev[artifact] ?? EMPTY), ...patch } }));

  const persist = useCallback(
    async (artifact: ArtifactKey, row: Row) => {
      setRows((prev) => ({ ...prev, [artifact]: { ...row, saving: true } }));
      try {
        const res =
          row.scope === 'inherit'
            ? await fetch(
                `/api/skills?planId=${encodeURIComponent(planId)}&artifact=${artifact}`,
                { method: 'DELETE' },
              )
            : await fetch('/api/skills', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  planId,
                  artifact,
                  body: row.body,
                  enabled: row.scope === 'override',
                }),
              });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast(data.error ?? '저장하지 못했습니다.', 'warn');
          setRows((prev) => ({ ...prev, [artifact]: { ...row, saving: false } }));
          return;
        }
        setRows((prev) => ({ ...prev, [artifact]: { ...row, dirty: false, saving: false } }));
        toast(`${skillTitle(artifact)} — ${SKILL_SCOPE_LABEL[row.scope]}`, 'ok');
      } catch {
        toast('저장하지 못했습니다.', 'warn');
        setRows((prev) => ({ ...prev, [artifact]: { ...row, saving: false } }));
      }
    },
    [planId, toast],
  );

  /*
   * 무엇을 고르는지는 **누르는 즉시 저장한다.** 셋 중 하나를 고르는 일에
   * 저장 버튼까지 누르게 하면, 안 누르고 나가서 반영이 안 된다.
   * 글은 다르다 — 쓰는 중에 계속 보낼 수 없으니 저장 버튼을 둔다.
   */
  const pick = (artifact: ArtifactKey, scope: SkillScope) => {
    const row = { ...rowOf(artifact), scope };
    if (scope === 'override') setOpenStep(artifact);
    void persist(artifact, row);
  };

  /*
   * 둘을 **따로 센다.** 한데 묶어 "N개를 다르게 씁니다" 라고 하면, 지침을 아예
   * 뺀 단계까지 무언가 적어 둔 것처럼 읽힌다. 접힌 줄 하나로 상태를 믿게 하려면
   * 그 줄이 정확해야 한다.
   */
  const overridden = SKILL_ARTIFACTS.filter((a) => rowOf(a).scope === 'override');
  const turnedOff = SKILL_ARTIFACTS.filter((a) => rowOf(a).scope === 'off');
  const names = (list: ArtifactKey[]) => list.map((a) => skillTitle(a)).join(', ');

  return (
    <SectionCard
      title="이 플랜의 작성 지침"
      description="이 플랜을 만들 때만 쓸 지침입니다. 다른 플랜은 그대로 둡니다."
      action={
        <button className="btn btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? '접기' : '보기'}
        </button>
      }
    >
      {/*
        접혀 있을 때도 **지금 어떤 상태인지는 보인다.** 펼쳐 봐야만 알 수 있으면
        아무도 안 펼쳐 보고, 남의 플랜 지침이 걸린 줄도 모른 채 만들게 된다.
      */}
      <div className="flex flex-col gap-0.5 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
        {loading ? (
          <p>불러오는 중…</p>
        ) : overridden.length === 0 && turnedOff.length === 0 ? (
          <p>
            계정 설정에 적어 둔 <b>기본 지침</b>을 그대로 씁니다.
          </p>
        ) : (
          <>
            {overridden.length > 0 && (
              <p>
                <b>{overridden.length}개</b> 단계를 이 플랜만 다르게 씁니다 —{' '}
                {names(overridden)}
              </p>
            )}
            {turnedOff.length > 0 && (
              <p>
                <b>{turnedOff.length}개</b> 단계는 지침 없이 만듭니다 — {names(turnedOff)}
              </p>
            )}
          </>
        )}
      </div>

      {open && !loading && (
        <div className="fade-in mt-3 flex flex-col gap-2">
          {SKILL_ARTIFACTS.map((artifact) => {
            const row = rowOf(artifact);
            const expanded = openStep === artifact;
            return (
              <div
                key={artifact}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-extrabold tracking-tight">
                    {skillTitle(artifact)}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {SCOPES.map((scope) => (
                      <button
                        key={scope}
                        className={row.scope === scope ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                        disabled={row.saving}
                        onClick={() => pick(artifact, scope)}
                      >
                        {row.saving && row.scope === scope && <Spinner size={11} />}
                        {SKILL_SCOPE_LABEL[scope]}
                      </button>
                    ))}
                  </div>
                </div>

                {row.scope === 'inherit' && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                    {row.base.trim()
                      ? `설정에 적어 둔 ${row.base.trim().length.toLocaleString()}자가 들어갑니다.`
                      : '설정에도 적어 둔 것이 없어, 지침 없이 만들어집니다.'}
                  </p>
                )}

                {row.scope === 'off' && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                    이 플랜에서는 지침 없이 만듭니다. 설정에 적어 둔 것도 들어가지 않습니다.
                  </p>
                )}

                {row.scope === 'override' &&
                  (expanded ? (
                    <SkillBody
                      artifact={artifact}
                      value={row.body}
                      disabled={row.saving}
                      onChange={(body) => edit(artifact, { body, dirty: true })}
                      note={
                        row.dirty ? <b className="ml-1.5 text-[var(--warn)]">저장 안 함</b> : null
                      }
                    >
                      <button
                        className={`btn btn-primary btn-sm${row.saving ? ' is-busy' : ''}`}
                        disabled={row.saving || !row.dirty}
                        onClick={() => void persist(artifact, rowOf(artifact))}
                      >
                        {row.saving ? <Spinner size={13} /> : <Save size={13} />}
                        저장
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={row.saving}
                        onClick={() => edit(artifact, { body: row.base, dirty: true })}
                        title="설정에 적어 둔 기본 지침을 가져와 여기서 고칩니다."
                      >
                        기본에서 가져오기
                      </button>
                    </SkillBody>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--fg-subtle)]">
                        {row.body.trim()
                          ? row.body.trim().split('\n')[0]
                          : '아직 적은 것이 없습니다 — 지침 없이 만들어집니다.'}
                      </p>
                      <button
                        className="btn btn-sm shrink-0"
                        onClick={() => setOpenStep(artifact)}
                      >
                        <PencilLine size={13} />
                        고치기
                      </button>
                    </div>
                  ))}
              </div>
            );
          })}

          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
            바꿀 수 있는 것은 <b>내용과 문체</b>입니다. 문서의 <b>구조</b>는 바꿀 수 없습니다.{' '}
            <Link
              className="font-semibold text-[var(--primary)] underline underline-offset-2"
              href="/settings/skills"
            >
              기본 지침 보기
              <ExternalLink size={11} className="ml-0.5 inline align-[-1px]" />
            </Link>
          </p>
        </div>
      )}
    </SectionCard>
  );
}
