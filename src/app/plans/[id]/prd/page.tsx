'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  FileText,
  MessageSquare,
  PencilLine,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  EmptyState,
  InlineText,
  ListEditor,
  Modal,
  SectionCard,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { GeneratingState } from '@/components/GeneratingState';
import { NextStepButton } from '@/components/StepNav';
import { IssueBar } from '@/components/IssueBar';
import { usePlannerStore } from '@/lib/store';
import { hasArtifact } from '@/lib/artifact-status';
import { download, slugify, toPrdJson } from '@/lib/export';
import { useGenerate } from '@/lib/useGenerate';
import { validatePlan } from '@/lib/validate';
import type {
  Comment,
  Prd,
  PrdGoal,
  PrdMetric,
  PrdMilestone,
  PrdPersona,
  PrdRisk,
  PrdRole,
  PrdUserScenario,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 섹션 정의                                                            */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { key: 'overview', label: '제품 개요' },
  { key: 'background', label: '배경 및 문제 정의' },
  { key: 'goals', label: '핵심 목표' },
  { key: 'personas', label: '타겟 유저' },
  { key: 'roles', label: '사용자 역할' },
  { key: 'userScenarios', label: '핵심 시나리오' },
  { key: 'environment', label: '사용 환경' },
  { key: 'coreValues', label: '핵심 가치' },
  { key: 'successMetrics', label: '성공 지표' },
  { key: 'scope', label: '범위' },
  { key: 'futureScope', label: '향후 확장 기능' },
  { key: 'milestones', label: '개발 마일스톤' },
  { key: 'risks', label: '주요 리스크' },
  { key: 'technicalNotes', label: '기술/보안 요구사항' },
  { key: 'constraints', label: '제약사항' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const SECTION_LABEL = SECTIONS.reduce(
  (acc, section) => {
    acc[section.key] = section.label;
    return acc;
  },
  {} as Record<SectionKey, string>,
);

function localId(prefix: string, index: number): string {
  return `${prefix}_${Date.now()}_${index}`;
}

function scrollToSection(key: SectionKey) {
  document.getElementById(`prd-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* 페이지                                                               */
/* ------------------------------------------------------------------ */

export default function PrdPage() {
  const { id: planId } = useParams<{ id: string }>();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));
  const updatePrd = usePlannerStore((s) => s.updatePrd);
  const addComment = usePlannerStore((s) => s.addComment);
  const toggleComment = usePlannerStore((s) => s.toggleComment);
  const removeComment = usePlannerStore((s) => s.removeComment);

  const { generate, pending } = useGenerate(plan);
  const { confirm, dialog } = useConfirm();
  const toast = useToast();

  const [mode, setMode] = useState<'doc' | 'edit'>('edit');
  const [commentSection, setCommentSection] = useState<SectionKey | null>(null);

  const comments = plan?.comments;
  const commentsBySection = useMemo(() => {
    const map = new Map<string, Comment[]>();
    for (const comment of comments ?? []) {
      if (comment.targetType !== 'prd') continue;
      const list = map.get(comment.targetId) ?? [];
      list.push(comment);
      map.set(comment.targetId, list);
    }
    return map;
  }, [comments]);

  /** 이 화면에서 고칠 수 있는 지적만. */
  const prdIssues = useMemo(
    () => (plan ? validatePlan(plan).filter((i) => i.artifact === 'prd') : []),
    [plan],
  );

  if (!plan) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;
  }

  const prd = plan.prd;
  const patch = (next: Partial<Prd>) => updatePrd(planId, next);

  const openCount = (key: SectionKey) =>
    (commentsBySection.get(key) ?? []).filter((c) => !c.resolved).length;

  const handleGenerate = async () => {
    if (hasArtifact(plan, 'prd')) {
      const ok = await confirm({
        title: 'PRD를 다시 생성할까요?',
        message:
          '현재 작성된 PRD 내용이 AI 초안으로 모두 덮어써집니다.\n되돌릴 수 없으니 필요하면 먼저 버전을 저장하세요.',
        confirmLabel: '다시 생성',
        danger: true,
      });
      if (!ok) return;
    }
    await generate('prd');
  };

  /** PRD 한 문서를 JSON 파일로 내려받는다. 화면에 보이는 값 그대로(자동 저장된 편집 내용 포함). */
  const handleDownload = () => {
    const filename = `${slugify(plan.brief.title)}-PRD.json`;
    download(filename, toPrdJson(plan), 'application/json;charset=utf-8');
    toast(`${filename} 을 내려받았습니다.`, 'ok');
  };

  const prdReady = hasArtifact(plan, 'prd');
  const downloadButton = (
    <button
      className="btn btn-sm"
      // 비어 있는 PRD 를 받아 봐야 쓸 곳이 없고, 생성 중이면 곧 통째로 바뀐다.
      disabled={!prdReady || pending === 'prd'}
      title={prdReady ? 'PRD 를 JSON 파일로 내려받습니다' : 'PRD 를 만든 뒤에 받을 수 있습니다'}
      onClick={handleDownload}
    >
      <Download size={13} />
      다운받기
    </button>
  );

  const generateButton = (
    <button
      className={`btn btn-primary btn-sm${pending === 'prd' ? ' is-busy' : ''}`}
      disabled={pending !== null}
      onClick={() => void handleGenerate()}
    >
      {pending === 'prd' ? <Spinner size={13} /> : <Sparkles size={13} />}
      {pending === 'prd' ? '생성중' : hasArtifact(plan, 'prd') ? '다시 생성' : 'AI로 생성'}
    </button>
  );

  /* ---------------------------------------------------------------- */
  /* 목표                                                              */
  /* ---------------------------------------------------------------- */

  const setGoals = (goals: PrdGoal[]) => patch({ goals });

  const moveGoal = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= prd.goals.length) return;
    const next = [...prd.goals];
    const swap = next[target];
    next[target] = next[index];
    next[index] = swap;
    setGoals(next);
  };

  /* ---------------------------------------------------------------- */
  /* 렌더                                                              */
  /* ---------------------------------------------------------------- */

  const toolbar = (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 pb-3 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-extrabold tracking-tight">
            프로덕트 요구사항 (PRD)
          </h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--fg-subtle)]">
            입력한 내용은 자동 저장됩니다.
          </p>
        </div>
        {/* max-w-full + flex-wrap: 버튼이 하나 늘어도 좁은 화면에서 가로로 넘치지 않고 두 줄로 접힌다. */}
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            <button
              className={mode === 'doc' ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setMode('doc')}
            >
              <FileText size={13} />
              문서 보기
            </button>
            <button
              className={mode === 'edit' ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setMode('edit')}
            >
              <PencilLine size={13} />
              편집
            </button>
          </div>
          {downloadButton}
          {generateButton}
          <NextStepButton planId={planId} current="prd" />
        </div>
      </div>

      {hasArtifact(plan, 'prd') && (
        <div className="mt-2.5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {SECTIONS.map((section) => {
            const count = openCount(section.key);
            return (
              <button
                key={section.key}
                className="chip shrink-0 hover:border-[var(--primary-border)] hover:text-[var(--primary)]"
                onClick={() => scrollToSection(section.key)}
              >
                {section.label}
                {count > 0 && <span className="text-[var(--warn)]">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (!hasArtifact(plan, 'prd')) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {toolbar}
        <div className="card">
          {pending === 'prd' ? (
            <GeneratingState artifact="prd" />
          ) : (
            <EmptyState
              icon={<FileText size={30} />}
              title="아직 PRD가 없습니다"
              description="서비스 아이디어를 바탕으로 AI가 초안을 만들어 드립니다. 생성 후에는 모든 항목을 직접 편집할 수 있습니다."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {generateButton}
                  <button className="btn btn-sm" onClick={() => patch({})}>
                    <PencilLine size={13} />
                    직접 작성하기
                  </button>
                </div>
              }
            />
          )}
        </div>
        {dialog}
      </div>
    );
  }

  const sectionAction = (key: SectionKey) => (
    <CommentButton count={openCount(key)} onClick={() => setCommentSection(key)} />
  );

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      {toolbar}

      <IssueBar planId={planId} artifact="prd" issues={prdIssues} />

      {mode === 'doc' ? (
        <DocView prd={prd} title={plan.brief.title} oneLiner={plan.brief.oneLiner} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* 1. 제품 개요 */}
          <div id="prd-overview" className="scroll-mt-32">
            <SectionCard
              title="1. 제품 개요"
              description="이 제품이 무엇이고 누구에게 어떤 가치를 주는지 요약합니다."
              action={sectionAction('overview')}
            >
              <InlineText
                multiline
                rows={5}
                value={prd.overview}
                placeholder="예) 소상공인이 5분 만에 예약 페이지를 만들 수 있는 노코드 서비스입니다."
                onChange={(overview) => patch({ overview })}
              />
            </SectionCard>
          </div>

          {/* 2. 배경 및 문제 정의 */}
          <div id="prd-background" className="scroll-mt-32">
            <SectionCard
              title="2. 배경 및 문제 정의"
              description="왜 지금 이 제품이 필요한지, 어떤 문제를 푸는지 적습니다."
              action={sectionAction('background')}
            >
              <InlineText
                multiline
                rows={5}
                value={prd.background}
                placeholder="현재 사용자가 겪는 문제와 기존 대안의 한계를 적어 주세요."
                onChange={(background) => patch({ background })}
              />
            </SectionCard>
          </div>

          {/* 3. 핵심 목표 */}
          <div id="prd-goals" className="scroll-mt-32">
            <SectionCard
              title="3. 핵심 목표"
              description="달성하려는 목표와 판단 지표를 함께 적으면 검증이 쉬워집니다."
              action={sectionAction('goals')}
            >
              {prd.goals.length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 목표가 없습니다. 아래에서 추가하세요.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>#</th>
                        <th>목표</th>
                        <th style={{ width: '32%' }}>판단 지표</th>
                        <th style={{ width: 116 }}>순서 / 삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prd.goals.map((goal, index) => (
                        <tr key={goal.id}>
                          <td className="id-tag pt-4">{index + 1}</td>
                          <td>
                            <InlineText
                              value={goal.text}
                              placeholder="목표를 입력하세요"
                              onChange={(text) =>
                                setGoals(
                                  prd.goals.map((g) => (g.id === goal.id ? { ...g, text } : g)),
                                )
                              }
                            />
                          </td>
                          <td>
                            <InlineText
                              value={goal.metric ?? ''}
                              placeholder="예) 가입 후 7일 재방문율 40%"
                              onChange={(metric) =>
                                setGoals(
                                  prd.goals.map((g) => (g.id === goal.id ? { ...g, metric } : g)),
                                )
                              }
                            />
                          </td>
                          <td>
                            <div className="flex items-center gap-0.5">
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={index === 0}
                                onClick={() => moveGoal(index, -1)}
                                aria-label="위로 이동"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={index === prd.goals.length - 1}
                                onClick={() => moveGoal(index, 1)}
                                aria-label="아래로 이동"
                              >
                                <ArrowDown size={13} />
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() =>
                                  void confirm({
                                    title: '목표를 삭제할까요?',
                                    message: `"${goal.text || '(내용 없음)'}" 목표를 삭제합니다.`,
                                    confirmLabel: '삭제',
                                    danger: true,
                                  }).then((ok) => {
                                    if (ok) setGoals(prd.goals.filter((g) => g.id !== goal.id));
                                  })
                                }
                                aria-label="삭제"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  setGoals([
                    ...prd.goals,
                    { id: localId('goal', prd.goals.length), text: '', metric: '' },
                  ])
                }
              >
                <Plus size={13} />
                목표 추가
              </button>
            </SectionCard>
          </div>

          {/* 4. 타겟 유저 */}
          <div id="prd-personas" className="scroll-mt-32">
            <SectionCard
              title="4. 타겟 유저"
              description="핵심 사용자 유형을 페르소나로 정리합니다."
              action={sectionAction('personas')}
            >
              {prd.personas.length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 페르소나가 없습니다.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {prd.personas.map((persona, index) => (
                    <PersonaCard
                      key={persona.id}
                      persona={persona}
                      index={index}
                      onChange={(next) =>
                        patch({
                          personas: prd.personas.map((p) => (p.id === persona.id ? next : p)),
                        })
                      }
                      onRemove={() =>
                        void confirm({
                          title: '페르소나를 삭제할까요?',
                          message: `"${persona.name || '(이름 없음)'}" 페르소나를 삭제합니다.`,
                          confirmLabel: '삭제',
                          danger: true,
                        }).then((ok) => {
                          if (ok)
                            patch({ personas: prd.personas.filter((p) => p.id !== persona.id) });
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  patch({
                    personas: [
                      ...prd.personas,
                      {
                        id: localId('persona', prd.personas.length),
                        name: '',
                        summary: '',
                        needs: [],
                        painPoints: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={13} />
                페르소나 추가
              </button>
            </SectionCard>
          </div>

          {/* 5. 사용자 역할 */}
          <div id="prd-roles" className="scroll-mt-32">
            <SectionCard
              title="5. 사용자 역할"
              description="역할별 권한은 이후 정보구조도의 접근 권한과 연결됩니다."
              action={sectionAction('roles')}
            >
              {prd.roles.length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 역할이 없습니다.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>역할명</th>
                        <th style={{ width: '30%' }}>설명</th>
                        <th>권한</th>
                        <th style={{ width: 56 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {prd.roles.map((role) => (
                        <tr key={role.id}>
                          <td>
                            <InlineText
                              value={role.name}
                              placeholder="예) 일반 사용자"
                              onChange={(name) => updateRole(role.id, { name })}
                            />
                          </td>
                          <td>
                            <InlineText
                              value={role.description}
                              placeholder="역할 설명"
                              onChange={(description) => updateRole(role.id, { description })}
                            />
                          </td>
                          <td>
                            <ListEditor
                              items={role.permissions}
                              placeholder="예) 예약 생성"
                              addLabel="권한 추가"
                              onChange={(permissions) => updateRole(role.id, { permissions })}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                void confirm({
                                  title: '역할을 삭제할까요?',
                                  message: `"${role.name || '(이름 없음)'}" 역할을 삭제합니다.`,
                                  confirmLabel: '삭제',
                                  danger: true,
                                }).then((ok) => {
                                  if (ok) patch({ roles: prd.roles.filter((r) => r.id !== role.id) });
                                })
                              }
                              aria-label="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  patch({
                    roles: [
                      ...prd.roles,
                      {
                        id: localId('role', prd.roles.length),
                        name: '',
                        description: '',
                        permissions: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={13} />
                역할 추가
              </button>
            </SectionCard>
          </div>

          {/* 6. 핵심 사용자 시나리오 */}
          <div id="prd-userScenarios" className="scroll-mt-32">
            <SectionCard
              title="6. 핵심 사용자 시나리오"
              description="타겟 사용자가 제품을 통해 핵심 가치를 경험하는 주요 여정을 정의합니다."
              action={sectionAction('userScenarios')}
            >
              {(prd.userScenarios ?? []).length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 사용자 시나리오가 없습니다.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>시나리오명</th>
                        <th style={{ width: '20%' }}>주 사용자</th>
                        <th>시나리오 흐름</th>
                        <th style={{ width: 56 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(prd.userScenarios ?? []).map((scenario) => (
                        <tr key={scenario.id}>
                          <td>
                            <InlineText
                              value={scenario.title}
                              placeholder="예) 첫 등록 및 확인"
                              onChange={(title) => updateUserScenario(scenario.id, { title })}
                            />
                          </td>
                          <td>
                            <InlineText
                              value={scenario.actor}
                              placeholder="예) 대표 사용자"
                              onChange={(actor) => updateUserScenario(scenario.id, { actor })}
                            />
                          </td>
                          <td>
                            <InlineText
                              multiline
                              rows={2}
                              value={scenario.scenario}
                              placeholder="사용자의 행동과 시스템 반응 흐름"
                              onChange={(scen) =>
                                updateUserScenario(scenario.id, { scenario: scen })
                              }
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                void confirm({
                                  title: '시나리오를 삭제할까요?',
                                  message: `"${scenario.title || '(제목 없음)'}" 시나리오를 삭제합니다.`,
                                  confirmLabel: '삭제',
                                  danger: true,
                                }).then((ok) => {
                                  if (ok)
                                    patch({
                                      userScenarios: (prd.userScenarios ?? []).filter(
                                        (s) => s.id !== scenario.id,
                                      ),
                                    });
                                })
                              }
                              aria-label="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  patch({
                    userScenarios: [
                      ...(prd.userScenarios ?? []),
                      {
                        id: localId('scenario', (prd.userScenarios ?? []).length),
                        title: '',
                        actor: '',
                        scenario: '',
                      },
                    ],
                  })
                }
              >
                <Plus size={13} />
                시나리오 추가
              </button>
            </SectionCard>
          </div>

          {/* 7. 사용 환경 */}
          <div id="prd-environment" className="scroll-mt-32">
            <SectionCard
              title="7. 사용 환경"
              description="지원 범위를 명확히 하면 개발 견적과 QA 범위가 잡힙니다."
              action={sectionAction('environment')}
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <span className="label">플랫폼</span>
                  <ListEditor
                    items={prd.environment.platforms}
                    placeholder="예) 반응형 웹"
                    addLabel="플랫폼 추가"
                    onChange={(platforms) =>
                      patch({ environment: { ...prd.environment, platforms } })
                    }
                  />
                </div>
                <div>
                  <span className="label">기기</span>
                  <ListEditor
                    items={prd.environment.devices}
                    placeholder="예) 데스크톱, 모바일"
                    addLabel="기기 추가"
                    onChange={(devices) => patch({ environment: { ...prd.environment, devices } })}
                  />
                </div>
                <div>
                  <span className="label">브라우저 / OS</span>
                  <ListEditor
                    items={prd.environment.browsers}
                    placeholder="예) Chrome 최신 2개 버전"
                    addLabel="항목 추가"
                    onChange={(browsers) => patch({ environment: { ...prd.environment, browsers } })}
                  />
                </div>
              </div>
            </SectionCard>
          </div>

          {/* 8. 핵심 가치 */}
          <div id="prd-coreValues" className="scroll-mt-32">
            <SectionCard
              title="8. 핵심 가치"
              description="경쟁 서비스와 구별되는 이 제품만의 가치를 적습니다."
              action={sectionAction('coreValues')}
            >
              <ListEditor
                items={prd.coreValues}
                placeholder="예) 설정 없이 3분 안에 시작"
                addLabel="가치 추가"
                onChange={(coreValues) => patch({ coreValues })}
              />
            </SectionCard>
          </div>

          {/* 9. 성공 지표 */}
          <div id="prd-successMetrics" className="scroll-mt-32">
            <SectionCard
              title="9. 성공 지표"
              description="출시 후 측정할 수치를 목표값과 함께 정의합니다."
              action={sectionAction('successMetrics')}
            >
              {prd.successMetrics.length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 지표가 없습니다.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: '48%' }}>지표명</th>
                        <th>목표</th>
                        <th style={{ width: 56 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {prd.successMetrics.map((metric) => (
                        <tr key={metric.id}>
                          <td>
                            <InlineText
                              value={metric.name}
                              placeholder="예) 주간 활성 사용자"
                              onChange={(name) => updateMetric(metric.id, { name })}
                            />
                          </td>
                          <td>
                            <InlineText
                              value={metric.target}
                              placeholder="예) 출시 3개월 내 1,000명"
                              onChange={(target) => updateMetric(metric.id, { target })}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                void confirm({
                                  title: '지표를 삭제할까요?',
                                  message: `"${metric.name || '(이름 없음)'}" 지표를 삭제합니다.`,
                                  confirmLabel: '삭제',
                                  danger: true,
                                }).then((ok) => {
                                  if (ok)
                                    patch({
                                      successMetrics: prd.successMetrics.filter(
                                        (m) => m.id !== metric.id,
                                      ),
                                    });
                                })
                              }
                              aria-label="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  patch({
                    successMetrics: [
                      ...prd.successMetrics,
                      { id: localId('metric', prd.successMetrics.length), name: '', target: '' },
                    ],
                  })
                }
              >
                <Plus size={13} />
                지표 추가
              </button>
            </SectionCard>
          </div>

          {/* 10. 범위 */}
          <div id="prd-scope" className="scroll-mt-32">
            <SectionCard
              title="10. 범위"
              description="이번 버전에 포함할 것과 제외할 것을 나눠 적습니다."
              action={sectionAction('scope')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className="label">포함 (In scope)</span>
                  <ListEditor
                    items={prd.inScope}
                    placeholder="예) 이메일 회원가입"
                    addLabel="포함 항목 추가"
                    onChange={(inScope) => patch({ inScope })}
                  />
                </div>
                <div className="opacity-60 transition hover:opacity-100">
                  <span className="label">제외 (Out of scope)</span>
                  <ListEditor
                    items={prd.outOfScope}
                    placeholder="예) 결제 연동"
                    addLabel="제외 항목 추가"
                    onChange={(outOfScope) => patch({ outOfScope })}
                  />
                </div>
              </div>
            </SectionCard>
          </div>

          {/* 11. 향후 확장 기능 */}
          <div id="prd-futureScope" className="scroll-mt-32">
            <SectionCard
              title="11. 향후 확장 기능"
              description="초기 MVP 이후 Phase 2, 3 단계에서 추진할 기능 로드맵입니다."
              action={sectionAction('futureScope')}
            >
              <ListEditor
                items={prd.futureScope ?? []}
                placeholder="예) 다국어 및 해외 결제 지원"
                addLabel="확장 기능 추가"
                onChange={(futureScope) => patch({ futureScope })}
              />
            </SectionCard>
          </div>

          {/* 12. 개발 마일스톤 */}
          <div id="prd-milestones" className="scroll-mt-32">
            <SectionCard
              title="12. 개발 마일스톤"
              description="단계별 목표 일정과 핵심 산출물을 정리합니다."
              action={sectionAction('milestones')}
            >
              {(prd.milestones ?? []).length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 마일스톤이 없습니다.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>단계 (Phase)</th>
                        <th style={{ width: '22%' }}>목표 기간</th>
                        <th>주요 목표 및 산출물</th>
                        <th style={{ width: 56 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(prd.milestones ?? []).map((ms) => (
                        <tr key={ms.id}>
                          <td>
                            <InlineText
                              value={ms.phase}
                              placeholder="예) Phase 1 (MVP)"
                              onChange={(phase) => updateMilestone(ms.id, { phase })}
                            />
                          </td>
                          <td>
                            <InlineText
                              value={ms.period}
                              placeholder="예) 1~4주차"
                              onChange={(period) => updateMilestone(ms.id, { period })}
                            />
                          </td>
                          <td>
                            <ListEditor
                              items={ms.goals}
                              placeholder="예) 회원가입 및 핵심 CRUD 구현"
                              addLabel="목표 추가"
                              onChange={(goals) => updateMilestone(ms.id, { goals })}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                void confirm({
                                  title: '마일스톤을 삭제할까요?',
                                  message: `"${ms.phase || '(단계명 없음)'}" 단계를 삭제합니다.`,
                                  confirmLabel: '삭제',
                                  danger: true,
                                }).then((ok) => {
                                  if (ok)
                                    patch({
                                      milestones: (prd.milestones ?? []).filter(
                                        (m) => m.id !== ms.id,
                                      ),
                                    });
                                })
                              }
                              aria-label="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  patch({
                    milestones: [
                      ...(prd.milestones ?? []),
                      {
                        id: localId('milestone', (prd.milestones ?? []).length),
                        phase: '',
                        period: '',
                        goals: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={13} />
                마일스톤 추가
              </button>
            </SectionCard>
          </div>

          {/* 13. 주요 리스크 및 대응 */}
          <div id="prd-risks" className="scroll-mt-32">
            <SectionCard
              title="13. 주요 리스크 및 대응 방안"
              description="출시 및 운영 과정에서 예상되는 잠재 위험 요소와 완화 방안을 사전에 대비합니다."
              action={sectionAction('risks')}
            >
              {(prd.risks ?? []).length === 0 ? (
                <p className="py-3 text-[12.5px] text-[var(--fg-subtle)]">
                  등록된 리스크가 없습니다.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: '45%' }}>예상 리스크</th>
                        <th>완화 및 대응 방안</th>
                        <th style={{ width: 56 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(prd.risks ?? []).map((risk) => (
                        <tr key={risk.id}>
                          <td>
                            <InlineText
                              value={risk.risk}
                              placeholder="예) 초기 가입자 온보딩 이탈"
                              onChange={(r) => updateRisk(risk.id, { risk: r })}
                            />
                          </td>
                          <td>
                            <InlineText
                              value={risk.mitigation}
                              placeholder="예) 간소화된 3단계 온보딩 제공"
                              onChange={(m) => updateRisk(risk.id, { mitigation: m })}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                void confirm({
                                  title: '리스크 항목을 삭제할까요?',
                                  message: `"${risk.risk || '(내용 없음)'}" 항목을 삭제합니다.`,
                                  confirmLabel: '삭제',
                                  danger: true,
                                }).then((ok) => {
                                  if (ok)
                                    patch({
                                      risks: (prd.risks ?? []).filter((r) => r.id !== risk.id),
                                    });
                                })
                              }
                              aria-label="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2.5"
                onClick={() =>
                  patch({
                    risks: [
                      ...(prd.risks ?? []),
                      {
                        id: localId('risk', (prd.risks ?? []).length),
                        risk: '',
                        mitigation: '',
                      },
                    ],
                  })
                }
              >
                <Plus size={13} />
                리스크 추가
              </button>
            </SectionCard>
          </div>

          {/* 14. 보안 및 기술 요구사항 */}
          <div id="prd-technicalNotes" className="scroll-mt-32">
            <SectionCard
              title="14. 보안 및 기술 요구사항"
              description="인증 방식, 암호화, 가용성, 규제 준수 등 비기능적 기술 요구사항을 정리합니다."
              action={sectionAction('technicalNotes')}
            >
              <ListEditor
                items={prd.technicalNotes ?? []}
                placeholder="예) HTTPS 암호화 및 JWT 기반 세션 관리"
                addLabel="기술 요구사항 추가"
                onChange={(technicalNotes) => patch({ technicalNotes })}
              />
            </SectionCard>
          </div>

          {/* 15. 제약사항 */}
          <div id="prd-constraints" className="scroll-mt-32">
            <SectionCard
              title="15. 제약사항"
              description="일정, 예산, 기술, 법·규제 등 사전에 정해진 제약을 적습니다."
              action={sectionAction('constraints')}
            >
              <ListEditor
                items={prd.constraints}
                placeholder="예) 개인정보 국외 이전 불가"
                addLabel="제약 추가"
                onChange={(constraints) => patch({ constraints })}
              />
            </SectionCard>
          </div>
        </div>
      )}

      {commentSection && (
        <CommentDialog
          sectionLabel={SECTION_LABEL[commentSection]}
          comments={commentsBySection.get(commentSection) ?? []}
          onClose={() => setCommentSection(null)}
          onAdd={(body) => addComment(planId, 'prd', commentSection, body)}
          onToggle={(commentId) => toggleComment(planId, commentId)}
          onRemove={(commentId) => removeComment(planId, commentId)}
        />
      )}

      {dialog}
    </div>
  );

  function updateRole(roleId: string, next: Partial<PrdRole>) {
    patch({ roles: prd.roles.map((r) => (r.id === roleId ? { ...r, ...next } : r)) });
  }

  function updateMetric(metricId: string, next: Partial<PrdMetric>) {
    patch({
      successMetrics: prd.successMetrics.map((m) => (m.id === metricId ? { ...m, ...next } : m)),
    });
  }

  function updateUserScenario(scenarioId: string, next: Partial<PrdUserScenario>) {
    patch({
      userScenarios: (prd.userScenarios ?? []).map((s) =>
        s.id === scenarioId ? { ...s, ...next } : s,
      ),
    });
  }

  function updateMilestone(milestoneId: string, next: Partial<PrdMilestone>) {
    patch({
      milestones: (prd.milestones ?? []).map((m) =>
        m.id === milestoneId ? { ...m, ...next } : m,
      ),
    });
  }

  function updateRisk(riskId: string, next: Partial<PrdRisk>) {
    patch({
      risks: (prd.risks ?? []).map((r) => (r.id === riskId ? { ...r, ...next } : r)),
    });
  }
}

/* ------------------------------------------------------------------ */
/* 코멘트                                                               */
/* ------------------------------------------------------------------ */

function CommentButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      className={count > 0 ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
      onClick={onClick}
      title={count > 0 ? `미해결 코멘트 ${count}건` : '코멘트'}
    >
      <MessageSquare size={13} />
      {count > 0 && <span className="text-[var(--warn)]">{count}</span>}
    </button>
  );
}

function CommentDialog({
  sectionLabel,
  comments,
  onClose,
  onAdd,
  onToggle,
  onRemove,
}: {
  sectionLabel: string;
  comments: Comment[];
  onClose: () => void;
  onAdd: (body: string) => void;
  onToggle: (commentId: string) => void;
  onRemove: (commentId: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onAdd(body);
    setDraft('');
  };

  const sorted = [...comments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <Modal
      open
      title={`코멘트 — ${sectionLabel}`}
      description="팀원과 검토 의견을 남겨 두세요. 해결한 코멘트는 체크로 표시됩니다."
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!draft.trim()}>
            <Plus size={13} />
            코멘트 등록
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <textarea
          className="textarea"
          rows={3}
          value={draft}
          placeholder="검토 의견을 입력하세요"
          onChange={(e) => setDraft(e.target.value)}
        />

        {sorted.length === 0 ? (
          <p className="py-2 text-center text-[12.5px] text-[var(--fg-subtle)]">
            아직 코멘트가 없습니다.
          </p>
        ) : (
          <ul className="flex max-h-[42vh] flex-col gap-2 overflow-y-auto">
            {sorted.map((comment) => (
              <li
                key={comment.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12px] font-bold">{comment.author}</span>
                    <span className="shrink-0 text-[11px] text-[var(--fg-subtle)]">
                      {formatDate(comment.createdAt)}
                    </span>
                    {comment.resolved && <span className="chip chip-ok shrink-0">해결됨</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => onToggle(comment.id)}
                      title={comment.resolved ? '미해결로 되돌리기' : '해결 처리'}
                    >
                      {comment.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onRemove(comment.id)}
                      aria-label="코멘트 삭제"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
                <p
                  className={`mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed ${
                    comment.resolved ? 'text-[var(--fg-subtle)] line-through' : 'text-[var(--fg)]'
                  }`}
                >
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 페르소나 카드                                                        */
/* ------------------------------------------------------------------ */

function PersonaCard({
  persona,
  index,
  onChange,
  onRemove,
}: {
  persona: PrdPersona;
  index: number;
  onChange: (next: PrdPersona) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex items-start gap-2">
        <span className="chip chip-primary mt-1.5 shrink-0">페르소나 {index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <InlineText
            value={persona.name}
            placeholder="이름 (예: 30대 카페 사장 김지연)"
            onChange={(name) => onChange({ ...persona, name })}
          />
          <InlineText
            value={persona.summary}
            placeholder="한 줄 소개"
            onChange={(summary) => onChange({ ...persona, summary })}
          />
        </div>
        <button className="btn btn-danger btn-sm shrink-0" onClick={onRemove} aria-label="페르소나 삭제">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <span className="label">니즈</span>
          <ListEditor
            items={persona.needs}
            placeholder="원하는 것"
            addLabel="니즈 추가"
            onChange={(needs) => onChange({ ...persona, needs })}
          />
        </div>
        <div>
          <span className="label">페인포인트</span>
          <ListEditor
            items={persona.painPoints}
            placeholder="불편한 점"
            addLabel="페인포인트 추가"
            onChange={(painPoints) => onChange({ ...persona, painPoints })}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 문서 보기                                                            */
/* ------------------------------------------------------------------ */

function DocSection({
  index,
  id,
  title,
  children,
}: {
  index: number;
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-32 border-t border-[var(--border)] pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-extrabold tracking-tight">
        <span className="text-[var(--primary)]">{String(index).padStart(2, '0')}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function DocParagraph({ value }: { value: string }) {
  if (!value.trim()) {
    return <p className="text-[13px] text-[var(--fg-subtle)]">아직 작성되지 않았습니다.</p>;
  }
  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-[1.85] text-[var(--fg-muted)]">
      {value}
    </p>
  );
}

function DocList({ items, muted = false }: { items: string[]; muted?: boolean }) {
  const visible = items.filter((item) => item.trim());
  if (visible.length === 0) {
    return <p className="text-[13px] text-[var(--fg-subtle)]">항목이 없습니다.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {visible.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className={`flex gap-2 text-[13.5px] leading-relaxed ${
            muted ? 'text-[var(--fg-subtle)]' : 'text-[var(--fg-muted)]'
          }`}
        >
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--border-strong)]" />
          <span className={muted ? 'line-through decoration-[var(--border-strong)]' : ''}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DocView({ prd, title, oneLiner }: { prd: Prd; title: string; oneLiner: string }) {
  return (
    <article className="card px-5 py-7 sm:px-9 sm:py-10">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <p className="text-[11.5px] font-bold tracking-wide text-[var(--primary)]">
          PRODUCT REQUIREMENTS DOCUMENT
        </p>
        <h1 className="mt-1.5 text-[24px] font-extrabold tracking-tight">{title || '제목 없음'}</h1>
        {oneLiner && (
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--fg-muted)]">{oneLiner}</p>
        )}
      </header>

      <div className="flex flex-col gap-6">
        <DocSection index={1} id="prd-overview" title="제품 개요">
          <DocParagraph value={prd.overview} />
        </DocSection>

        <DocSection index={2} id="prd-background" title="배경 및 문제 정의">
          <DocParagraph value={prd.background} />
        </DocSection>

        <DocSection index={3} id="prd-goals" title="핵심 목표">
          {prd.goals.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 목표가 없습니다.</p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {prd.goals.map((goal, index) => (
                <li key={goal.id} className="flex gap-2.5">
                  <span className="chip chip-primary mt-0.5 shrink-0">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold leading-relaxed">{goal.text}</p>
                    {goal.metric && (
                      <p className="mt-0.5 text-[12.5px] text-[var(--fg-subtle)]">
                        지표 · {goal.metric}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DocSection>

        <DocSection index={4} id="prd-personas" title="타겟 유저">
          {prd.personas.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 페르소나가 없습니다.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {prd.personas.map((persona) => (
                <div
                  key={persona.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5"
                >
                  <p className="text-[13.5px] font-extrabold">{persona.name || '이름 없음'}</p>
                  {persona.summary && (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                      {persona.summary}
                    </p>
                  )}
                  <div className="mt-3 flex flex-col gap-2.5">
                    <div>
                      <p className="mb-1 text-[11.5px] font-bold text-[var(--fg-subtle)]">니즈</p>
                      <DocList items={persona.needs} />
                    </div>
                    <div>
                      <p className="mb-1 text-[11.5px] font-bold text-[var(--fg-subtle)]">
                        페인포인트
                      </p>
                      <DocList items={persona.painPoints} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DocSection>

        <DocSection index={5} id="prd-roles" title="사용자 역할">
          {prd.roles.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 역할이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>역할명</th>
                    <th style={{ width: '32%' }}>설명</th>
                    <th>권한</th>
                  </tr>
                </thead>
                <tbody>
                  {prd.roles.map((role) => (
                    <tr key={role.id}>
                      <td className="font-semibold">{role.name || '-'}</td>
                      <td className="text-[var(--fg-muted)]">{role.description || '-'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.filter((p) => p.trim()).length === 0 ? (
                            <span className="text-[var(--fg-subtle)]">-</span>
                          ) : (
                            role.permissions
                              .filter((p) => p.trim())
                              .map((permission, index) => (
                                <span key={`${permission}-${index}`} className="chip">
                                  {permission}
                                </span>
                              ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DocSection>

        <DocSection index={6} id="prd-userScenarios" title="핵심 사용자 시나리오">
          {(prd.userScenarios ?? []).length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 시나리오가 없습니다.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(prd.userScenarios ?? []).map((scenario) => (
                <div
                  key={scenario.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5"
                >
                  <p className="text-[13.5px] font-extrabold">{scenario.title || '제목 없음'}</p>
                  {scenario.actor && (
                    <p className="mt-1 text-[12px] font-semibold text-[var(--primary)]">
                      주 사용자: {scenario.actor}
                    </p>
                  )}
                  {scenario.scenario && (
                    <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                      {scenario.scenario}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </DocSection>

        <DocSection index={7} id="prd-environment" title="사용 환경">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-subtle)]">플랫폼</p>
              <DocList items={prd.environment.platforms} />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-subtle)]">기기</p>
              <DocList items={prd.environment.devices} />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-subtle)]">
                브라우저 / OS
              </p>
              <DocList items={prd.environment.browsers} />
            </div>
          </div>
        </DocSection>

        <DocSection index={8} id="prd-coreValues" title="핵심 가치">
          <DocList items={prd.coreValues} />
        </DocSection>

        <DocSection index={9} id="prd-successMetrics" title="성공 지표">
          {prd.successMetrics.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 지표가 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: '50%' }}>지표명</th>
                    <th>목표</th>
                  </tr>
                </thead>
                <tbody>
                  {prd.successMetrics.map((metric) => (
                    <tr key={metric.id}>
                      <td className="font-semibold">{metric.name || '-'}</td>
                      <td className="text-[var(--fg-muted)]">{metric.target || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DocSection>

        <DocSection index={10} id="prd-scope" title="범위">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11.5px] font-bold text-[var(--ok)]">포함 (In scope)</p>
              <DocList items={prd.inScope} />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-subtle)]">
                제외 (Out of scope)
              </p>
              <DocList items={prd.outOfScope} muted />
            </div>
          </div>
        </DocSection>

        <DocSection index={11} id="prd-futureScope" title="향후 확장 기능">
          <DocList items={prd.futureScope ?? []} />
        </DocSection>

        <DocSection index={12} id="prd-milestones" title="개발 마일스톤">
          {(prd.milestones ?? []).length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 마일스톤이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>단계</th>
                    <th style={{ width: '22%' }}>목표 기간</th>
                    <th>주요 목표 및 산출물</th>
                  </tr>
                </thead>
                <tbody>
                  {(prd.milestones ?? []).map((ms) => (
                    <tr key={ms.id}>
                      <td className="font-semibold">{ms.phase || '-'}</td>
                      <td className="text-[var(--fg-muted)]">{ms.period || '-'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {ms.goals.filter((g) => g.trim()).length === 0 ? (
                            <span className="text-[var(--fg-subtle)]">-</span>
                          ) : (
                            ms.goals
                              .filter((g) => g.trim())
                              .map((g, index) => (
                                <span key={`${g}-${index}`} className="chip">
                                  {g}
                                </span>
                              ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DocSection>

        <DocSection index={13} id="prd-risks" title="주요 리스크 및 대응 방안">
          {(prd.risks ?? []).length === 0 ? (
            <p className="text-[13px] text-[var(--fg-subtle)]">등록된 리스크가 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>예상 리스크</th>
                    <th>완화 및 대응 방안</th>
                  </tr>
                </thead>
                <tbody>
                  {(prd.risks ?? []).map((risk) => (
                    <tr key={risk.id}>
                      <td className="font-semibold">{risk.risk || '-'}</td>
                      <td className="text-[var(--fg-muted)]">{risk.mitigation || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DocSection>

        <DocSection index={14} id="prd-technicalNotes" title="보안 및 기술 요구사항">
          <DocList items={prd.technicalNotes ?? []} />
        </DocSection>

        <DocSection index={15} id="prd-constraints" title="제약사항">
          <DocList items={prd.constraints} />
        </DocSection>
      </div>
    </article>
  );
}
