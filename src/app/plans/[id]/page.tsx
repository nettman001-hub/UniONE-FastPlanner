'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  GitBranch,
  History,
  Info,
  Lightbulb,
  ListTree,
  MessageSquare,
  MonitorSmartphone,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  EmptyState,
  Field,
  InlineText,
  Modal,
  RegenerateTag,
  SectionCard,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { FixWithAi } from '@/components/FixWithAi';
import { PlanSkills } from '@/components/PlanSkills';
import { usePlannerStore } from '@/lib/store';
import { hasArtifact } from '@/lib/artifact-status';
import { BRIEF_QUESTIONS } from '@/lib/brief-questions';
import { issueFixPrompt } from '@/lib/ai/fix-prompt';
import { useGenerate } from '@/lib/useGenerate';
import { useEngine } from '@/lib/useEngine';
import { costOfArtifact } from '@/lib/credits';
import { issueSummary, validatePlan, LEVEL_LABEL, type Issue, type IssueLevel } from '@/lib/validate';
import {
  ARTIFACT_LABEL,
  PLATFORM_LABEL,
  type ArtifactKey,
  type Plan,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 상수                                                                 */
/* ------------------------------------------------------------------ */

const STEP_ORDER: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

const STEP_DESC: Record<ArtifactKey, string> = {
  prd: '제품의 목표·타겟·범위를 정의합니다.',
  fs: '요구사항을 기능과 상세 명세로 쪼갭니다.',
  ia: '서비스에 필요한 화면과 계층을 설계합니다.',
  flow: '사용자가 화면을 오가는 경로를 그립니다.',
  wireframe: '화면별 블록 구성을 잡습니다.',
};

const STEP_PATH: Record<ArtifactKey, string> = {
  prd: '/prd',
  fs: '/fs',
  ia: '/ia',
  flow: '/flow',
  wireframe: '/wireframe',
};

const STEP_ICON: Record<ArtifactKey, ReactNode> = {
  prd: <FileText size={15} />,
  fs: <Table2 size={15} />,
  ia: <ListTree size={15} />,
  flow: <GitBranch size={15} />,
  wireframe: <MonitorSmartphone size={15} />,
};

const LEVEL_CHIP: Record<IssueLevel, string> = {
  error: 'chip chip-danger',
  warn: 'chip chip-warn',
  info: 'chip',
};

/* ------------------------------------------------------------------ */
/* 헬퍼                                                                 */
/* ------------------------------------------------------------------ */

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 산출물별 항목 수 요약. */
function stepCount(plan: Plan, key: ArtifactKey): string {
  switch (key) {
    case 'prd':
      return `목표 ${plan.prd.goals.length}개 · 페르소나 ${plan.prd.personas.length}개`;
    case 'fs':
      return `요구사항 ${plan.requirements.length} · 기능 ${plan.features.length} · 명세 ${plan.specifications.length}`;
    case 'ia':
      return `화면 ${plan.iaPages.length}개`;
    case 'flow':
      return `플로우 ${plan.flows.length}개`;
    case 'wireframe':
      return `와이어프레임 ${plan.wireframes.length}개`;
  }
}

/** 선행 조건이 모자라면 사유를, 갖춰졌으면 null 을 돌려준다. */
function blockedReason(plan: Plan, key: ArtifactKey): string | null {
  if (key === 'ia' && plan.features.length === 0) {
    return '기능명세서를 먼저 만들어 주세요.';
  }
  if ((key === 'flow' || key === 'wireframe') && plan.iaPages.length === 0) {
    return '정보구조도를 먼저 만들어 주세요.';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 페이지                                                               */
/* ------------------------------------------------------------------ */

export default function PlanOverviewPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-[13px] text-[var(--fg-muted)]">불러오는 중…</div>}
    >
      <PlanOverview />
    </Suspense>
  );
}

function PlanOverview() {
  const { id: planId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));
  const renamePlan = usePlannerStore((s) => s.renamePlan);
  const saveVersion = usePlannerStore((s) => s.saveVersion);
  const restoreVersion = usePlannerStore((s) => s.restoreVersion);
  const removeVersion = usePlannerStore((s) => s.removeVersion);
  const addComment = usePlannerStore((s) => s.addComment);
  const toggleComment = usePlannerStore((s) => s.toggleComment);
  const removeComment = usePlannerStore((s) => s.removeComment);

  const { generate, generateAll, pending, autoRunning, cancel } = useGenerate(plan);
  /* 고급 엔진은 값이 두 배다. 보여 주는 값과 깎이는 값이 갈리면 안 된다. */
  const engine = useEngine();

  const [briefOpen, setBriefOpen] = useState(false);
  /** 전체 자동 생성 진행 여부·현재 단계는 서버 작업 상태에서 온다. */
  const running = autoRunning;
  const autoStep = running ? pending : null;
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');
  const [commentBody, setCommentBody] = useState('');

  /*
   * `?start=prd` — 어디를 눌러야 하는지 표시만 한다.
   *
   * 예전에는 여기서 곧바로 생성을 걸었다(`?autogen=prd`). 그런데 세 단계를 채우고
   * `다음` 을 누른 것뿐인데 크레딧이 나가기 시작하니, 사용자 입장에서는 시킨 적 없는
   * 일이 벌어지는 셈이었다. **시작 버튼은 사용자가 누른다.** 우리는 그 버튼이
   * 어디 있는지만 알려 준다.
   */
  const startParam = searchParams.get('start');
  const [nudge, setNudge] = useState<ArtifactKey | null>(null);
  const nudgeDone = useRef(false);
  useEffect(() => {
    if (nudgeDone.current) return;
    if (!plan || startParam !== 'prd') return;
    nudgeDone.current = true;
    setNudge('prd');
    router.replace(`/plans/${planId}`);
  }, [startParam, plan, planId, router]);

  const issues = useMemo(() => (plan ? validatePlan(plan) : []), [plan]);
  const summary = useMemo(() => issueSummary(issues), [issues]);

  if (!plan) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;
  }

  const busy = pending !== null || running;
  const unresolved = plan.comments.filter((c) => !c.resolved);
  const recentComments = [...plan.comments]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  /* 단일 산출물 생성 */
  const handleGenerate = async (key: ArtifactKey) => {
    // 눌렀으면 신호는 할 일을 다 했다.
    setNudge(null);
    if (hasArtifact(plan, key)) {
      const ok = await confirm({
        title: `${ARTIFACT_LABEL[key]}을(를) 다시 생성할까요?`,
        message: '기존 내용을 모두 덮어씁니다. 직접 편집한 부분도 사라집니다.',
        confirmLabel: '다시 생성',
        danger: true,
      });
      if (!ok) return;
    }
    await generate(key);
  };

  /*
   * 전체 자동 생성.
   *
   * 5단계를 **한 작업으로 서버에 맡긴다.** 이어 달리는 것은 서버가 하므로
   * 화면을 옮기거나 탭을 닫아도 끝까지 진행된다.
   */
  const handleGenerateAll = async () => {
    if (busy) return;
    if (STEP_ORDER.some((key) => hasArtifact(plan, key))) {
      const ok = await confirm({
        title: '전체 자동 생성',
        message:
          'PRD부터 와이어프레임까지 순서대로 새로 만듭니다.\n이미 만들어 둔 산출물은 모두 덮어써집니다.',
        confirmLabel: '전체 생성',
        danger: true,
      });
      if (!ok) return;
    }
    await generateAll();
  };

  /* 버전 저장 */
  const handleSaveVersion = () => {
    saveVersion(planId, versionLabel.trim());
    setVersionOpen(false);
    setVersionLabel('');
    toast('현재 상태를 버전으로 저장했습니다.', 'ok');
  };

  const handleRestore = async (versionId: string, label: string) => {
    const ok = await confirm({
      title: '이 버전으로 되돌릴까요?',
      message: `"${label}" 시점의 문서로 전체를 되돌립니다.\n지금 작업 중인 내용은 사라집니다.`,
      confirmLabel: '복원',
      danger: true,
    });
    if (!ok) return;
    restoreVersion(planId, versionId);
    toast('선택한 버전으로 복원했습니다.', 'ok');
  };

  const handleRemoveVersion = async (versionId: string, label: string) => {
    const ok = await confirm({
      title: '버전을 삭제할까요?',
      message: `"${label}" 스냅샷을 삭제합니다. 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeVersion(planId, versionId);
  };

  const handleAddComment = () => {
    const body = commentBody.trim();
    if (!body) return;
    addComment(planId, 'prd', 'overview', body);
    setCommentBody('');
    toast('코멘트를 남겼습니다.', 'ok');
  };

  const handleRemoveComment = async (commentId: string) => {
    const ok = await confirm({
      title: '코멘트를 삭제할까요?',
      message: '삭제한 코멘트는 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeComment(planId, commentId);
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="flex flex-col gap-4">
        {/* -------------------------------------------------------- */}
        {/* 상단 요약                                                 */}
        {/* -------------------------------------------------------- */}
        <section className="card p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <InlineText
              value={plan.brief.title}
              placeholder="서비스명"
              onChange={(next) => renamePlan(planId, next.trim() || plan.brief.title)}
              className="text-[17px] font-extrabold tracking-tight"
            />
            {plan.brief.oneLiner && (
              <p className="text-[13px] leading-relaxed text-[var(--fg-muted)]">
                {plan.brief.oneLiner}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip chip-primary">{PLATFORM_LABEL[plan.brief.platform]}</span>
              {plan.brief.targetUser && (
                <span className="chip max-w-full overflow-hidden text-ellipsis">
                  타겟 · {plan.brief.targetUser}
                </span>
              )}
              {plan.brief.purpose && (
                <span className="chip max-w-full overflow-hidden text-ellipsis">
                  목적 · {plan.brief.purpose}
                </span>
              )}
              <span className="chip">수정 {formatDateTime(plan.updatedAt)}</span>
            </div>

            <div>
              <button
                className="btn btn-ghost btn-sm -ml-2"
                onClick={() => setBriefOpen((v) => !v)}
                aria-expanded={briefOpen}
              >
                {briefOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                브리프 {briefOpen ? '접기' : '보기'}
              </button>
            </div>

            {briefOpen && (
              <div className="fade-in grid gap-2 sm:grid-cols-2">
                <BriefCard title="서비스 아이디어" body={plan.brief.idea} full />
                <BriefCard title="참고 서비스" body={plan.brief.reference} />
                <BriefCard title="꼭 포함할 기능" body={plan.brief.mustHave} />
                {/*
                  기획할 때 고른 답을 여기서 볼 수 있어야 한다. 안 보이면 문서가
                  왜 이렇게 나왔는지 알 수 없고, 잘못 고른 것도 못 찾는다.

                  다만 **답한 게 없으면 칸 자체를 안 보인다.** 빈 칸에
                  "입력하지 않았습니다" 만 떠 있으면 뭔가 빠뜨린 것처럼 보이는데,
                  이 둘은 건너뛰어도 되는 것들이다.
                */}
                {answersText(plan.brief) && (
                  <BriefCard title="요구분석" body={answersText(plan.brief)} full />
                )}
                {followupsText(plan.brief) && (
                  <BriefCard title="추가 문답" body={followupsText(plan.brief)} full />
                )}
              </div>
            )}
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* 산출물 파이프라인                                          */}
        {/* -------------------------------------------------------- */}
        <SectionCard
          title="산출물 파이프라인"
          description="PRD부터 와이어프레임까지 순서대로 만들어 나갑니다."
          action={
            <button
              className={`btn btn-primary btn-sm${running ? ' is-busy' : ''}`}
              disabled={busy}
              onClick={() => void handleGenerateAll()}
            >
              {running ? <Spinner size={13} /> : <Wand2 size={13} />}
              {running && autoStep ? `${ARTIFACT_LABEL[autoStep]} 생성중` : '전체 자동 생성'}
            </button>
          }
        >
          <div className="flex flex-col gap-2.5">
            {running && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-3 py-2 text-[12.5px] font-semibold text-[var(--primary)]">
                <Spinner size={13} />
                <span className="min-w-0 flex-1">
                  {autoStep
                    ? `${STEP_ORDER.indexOf(autoStep) + 1}/5 · ${ARTIFACT_LABEL[autoStep]}을(를) 만들고 있습니다.`
                    : '준비 중입니다.'}
                </span>
                {/* 다섯 단계는 몇 분이 걸린다. 잘못 걸었을 때 기다리는 수밖에 없으면 안 된다. */}
                <button
                  className="btn btn-sm shrink-0"
                  onClick={cancel}
                  title="지금까지 만들어진 것은 그대로 두고 멈춥니다. 나머지는 이어서 만들 수 있습니다."
                >
                  <Square size={11} />
                  멈추기
                </button>
              </div>
            )}

            {STEP_ORDER.map((key, index) => {
              const done = hasArtifact(plan, key);
              const reason = blockedReason(plan, key);
              const active = autoStep === key || pending === key;
              /* 아직 안 만들었고, 지금 아무것도 안 돌고, 막힌 이유도 없을 때만 신호를 준다. */
              const nudged = nudge === key && !done && !busy && reason === null;
              return (
                <div
                  key={key}
                  className={`rounded-xl border p-3 transition ${
                    active
                      ? 'border-[var(--primary-border)] bg-[var(--primary-soft)]'
                      : 'border-[var(--border)] bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-2.5">
                      <span
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                          done
                            ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
                            : 'bg-[var(--surface-3)] text-[var(--fg-subtle)]'
                        }`}
                      >
                        {done ? <Check size={13} /> : index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[var(--fg-muted)]">{STEP_ICON[key]}</span>
                          <span className="text-[13.5px] font-extrabold tracking-tight">
                            {ARTIFACT_LABEL[key]}
                          </span>
                          <span className={done ? 'chip chip-ok' : 'chip'}>
                            {done ? '생성 완료' : '미생성'}
                          </span>
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                          {STEP_DESC[key]}
                        </p>
                        <p className="mt-1 text-[11.5px] text-[var(--fg-subtle)]">
                          {stepCount(plan, key)} · {costOfArtifact(key, engine)} 크레딧
                        </p>
                        {reason && (
                          <p className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-[var(--warn)]">
                            <AlertTriangle size={12} />
                            {reason}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                      {/*
                        움직임만으로는 신호가 약하다 — 색을 못 보는 사용자도 있고,
                        움직임을 꺼 둔 사용자도 있다. 글자로도 같이 말한다.
                      */}
                      {nudged && (
                        <span className="chip chip-primary whitespace-nowrap">
                          여기서 시작하세요
                        </span>
                      )}
                      <button
                        className={`btn btn-primary btn-sm${pending === key ? ' is-busy' : ''}${
                          nudged ? ' nudge' : ''
                        }`}
                        disabled={busy || reason !== null}
                        title={reason ?? undefined}
                        onClick={() => void handleGenerate(key)}
                      >
                        {pending === key ? <Spinner size={13} /> : <Sparkles size={13} />}
                        {pending === key ? '생성중' : done ? '다시 생성' : 'AI로 생성'}
                      </button>
                      <Link className="btn btn-sm" href={`/plans/${planId}${STEP_PATH[key]}`}>
                        열기
                        <ArrowRight size={13} />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* -------------------------------------------------------- */}
        {/* 이 플랜의 작성 지침                                        */}
        {/* -------------------------------------------------------- */}
        {/*
          파이프라인 **바로 아래**에 둔다. 지침은 만들기 전에 정해야 쓸모가
          있는데, 아래쪽에 두면 다 만들고 나서야 눈에 들어온다.
        */}
        <PlanSkills planId={planId} />

        {/* -------------------------------------------------------- */}
        {/* 정합성 검사                                                */}
        {/* -------------------------------------------------------- */}
        <SectionCard
          title="정합성 검사"
          description="산출물끼리 연결이 끊긴 곳을 찾아 줍니다."
          action={
            <div className="flex items-center gap-1.5">
              <span className={summary.error > 0 ? 'chip chip-danger' : 'chip'}>
                오류 {summary.error}
              </span>
              <span className={summary.warn > 0 ? 'chip chip-warn' : 'chip'}>
                경고 {summary.warn}
              </span>
              <span className="chip">제안 {summary.info}</span>
            </div>
          }
        >
          {issues.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-transparent bg-[var(--ok-soft)] px-3 py-2.5 text-[13px] font-semibold text-[var(--ok)]">
              <ShieldCheck size={15} />
              정합성 문제를 찾지 못했습니다.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} planId={planId} />
              ))}
            </ul>
          )}
        </SectionCard>

        {/* -------------------------------------------------------- */}
        {/* 버전 기록                                                  */}
        {/* -------------------------------------------------------- */}
        <SectionCard
          title="버전 기록"
          description="큰 수정 전에 저장해 두면 언제든 되돌릴 수 있습니다."
          action={
            <button className="btn btn-sm" onClick={() => setVersionOpen(true)}>
              <Save size={13} />
              현재 상태 저장
            </button>
          }
        >
          {plan.versions.length === 0 ? (
            <EmptyState
              icon={<History size={22} />}
              title="저장된 버전이 없습니다."
              description="큰 수정 전에 저장해 두면 되돌릴 수 있습니다."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {plan.versions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold">{version.label}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--fg-subtle)]">
                      {formatDateTime(version.createdAt)} · 요구사항{' '}
                      {version.snapshot.requirements.length} · 화면{' '}
                      {version.snapshot.iaPages.length}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="btn btn-sm"
                      onClick={() => void handleRestore(version.id, version.label)}
                    >
                      <RotateCcw size={13} />
                      복원
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleRemoveVersion(version.id, version.label)}
                      aria-label={`${version.label} 삭제`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* -------------------------------------------------------- */}
        {/* 코멘트                                                     */}
        {/* -------------------------------------------------------- */}
        <SectionCard
          title="코멘트"
          description="검토 의견을 남기고 해결 여부를 관리합니다."
          action={
            <span className={unresolved.length > 0 ? 'chip chip-warn' : 'chip chip-ok'}>
              <MessageSquare size={11} />
              미해결 {unresolved.length}건
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 sm:flex-row">
              <input
                className="input"
                value={commentBody}
                placeholder="개요에 남길 코멘트를 입력하세요"
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddComment();
                }}
              />
              <button
                className="btn btn-primary shrink-0"
                disabled={!commentBody.trim()}
                onClick={handleAddComment}
              >
                <Plus size={13} />
                남기기
              </button>
            </div>

            {recentComments.length === 0 ? (
              <p className="text-[12.5px] text-[var(--fg-subtle)]">아직 코멘트가 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentComments.map((comment) => (
                  <li
                    key={comment.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip">{comment.targetType}</span>
                      <span className="id-tag">{comment.targetId}</span>
                      <span className="text-[11.5px] font-semibold text-[var(--fg-muted)]">
                        {comment.author}
                      </span>
                      <span className="text-[11px] text-[var(--fg-subtle)]">
                        {formatDateTime(comment.createdAt)}
                      </span>
                      {comment.resolved && <span className="chip chip-ok">해결됨</span>}
                    </div>
                    <p
                      className={`mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                        comment.resolved
                          ? 'text-[var(--fg-subtle)] line-through'
                          : 'text-[var(--fg)]'
                      }`}
                    >
                      {comment.body}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleComment(planId, comment.id)}
                      >
                        <Check size={13} />
                        {comment.resolved ? '되돌리기' : '해결'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleRemoveComment(comment.id)}
                      >
                        <Trash2 size={13} />
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {plan.comments.length > recentComments.length && (
              <p className="text-[11.5px] text-[var(--fg-subtle)]">
                전체 {plan.comments.length}건 중 최근 {recentComments.length}건을 보여 줍니다.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      {/* 버전 저장 모달 */}
      <Modal
        open={versionOpen}
        title="현재 상태 저장"
        description="지금 시점의 문서 전체를 스냅샷으로 남깁니다."
        onClose={() => setVersionOpen(false)}
        width={440}
        footer={
          <>
            <button className="btn" onClick={() => setVersionOpen(false)}>
              취소
            </button>
            <button className="btn btn-primary" onClick={handleSaveVersion}>
              저장
            </button>
          </>
        }
      >
        <Field label="버전 이름" hint="비워 두면 순번으로 자동 저장됩니다.">
          <input
            className="input"
            value={versionLabel}
            placeholder="예: 1차 검토 전"
            autoFocus
            onChange={(e) => setVersionLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveVersion();
            }}
          />
        </Field>
      </Modal>

      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 지역 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

/** 기획할 때 고른 답을 사람이 읽는 줄로. 안 고른 것은 빼고 보여 준다. */
function answersText(brief: Plan['brief']): string {
  const picked = brief.answers ?? {};
  const lines: string[] = [];
  for (const q of BRIEF_QUESTIONS) {
    const chosen = q.choices.filter((c) => (picked[q.key] ?? []).includes(c.value));
    if (chosen.length > 0) lines.push(`${q.ask} ${chosen.map((c) => c.label).join(', ')}`);
  }
  return lines.join('\n');
}

function followupsText(brief: Plan['brief']): string {
  return (brief.followups ?? [])
    .filter((f) => f.answer.trim())
    .map((f) => `${f.question}\n  ${f.answer}`)
    .join('\n');
}

function BriefCard({ title, body, full }: { title: string; body?: string; full?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 ${
        full ? 'sm:col-span-2' : ''
      }`}
    >
      <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold text-[var(--fg-muted)]">
        <Lightbulb size={12} />
        {title}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--fg)]">
        {body?.trim() ? body : <span className="text-[var(--fg-subtle)]">입력하지 않았습니다.</span>}
      </p>
    </div>
  );
}

function IssueRow({ issue, planId }: { issue: Issue; planId: string }) {
  const shown = issue.targets.slice(0, 5);
  const rest = issue.targets.length - shown.length;

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={LEVEL_CHIP[issue.level]}>
              {issue.level === 'info' ? <Info size={11} /> : <AlertTriangle size={11} />}
              {LEVEL_LABEL[issue.level]}
            </span>
            <span className="chip">{ARTIFACT_LABEL[issue.artifact]}</span>
            <span className="text-[13px] font-bold">{issue.title}</span>
            {issue.regenerate && <RegenerateTag />}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            {issue.detail}
          </p>
          {shown.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {shown.map((target, index) => (
                <li key={`${issue.id}-${index}`} className="chip">
                  {target}
                </li>
              ))}
              {rest > 0 && <li className="chip">외 {rest}건</li>}
            </ul>
          )}
        </div>
        {/*
          `수정하러 가기` 만 있으면 화면에 도착한 뒤가 막막하다 — 지적된 항목을
          표에서 눈으로 찾아내는 일이 남는다. 지적에 이미 대상 ID 가 다 있으므로
          그대로 에이전트에게 넘긴다.
        */}
        <div className="flex shrink-0 gap-1.5">
          <FixWithAi planId={planId} prompt={issueFixPrompt(issue)} />
          {issue.href && (
            <Link className="btn btn-sm shrink-0" href={`/plans/${planId}${issue.href}`}>
              <CheckCircle2 size={13} />
              직접 수정
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
