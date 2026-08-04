'use client';

import { useParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  GitBranch,
  Image as ImageIcon,
  Info,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { FlowCanvas } from '@/components/FlowCanvas';
import {
  EmptyState,
  Field,
  InlineText,
  RegenerateTag,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { GeneratingState } from '@/components/GeneratingState';
import { NextStepButton } from '@/components/StepNav';
import { usePlannerStore } from '@/lib/store';
import { hasArtifact } from '@/lib/artifact-status';
import { useGenerate } from '@/lib/useGenerate';
import { slugify, toMermaid } from '@/lib/export';
import { downloadPng, downloadSvg, findChartSvg, serializeSvg } from '@/lib/image-export';
import { validatePlan, LEVEL_LABEL, type Issue } from '@/lib/validate';
import {
  FLOW_NODE_TYPE_LABEL,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
  type UserFlow,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 상수 · 지역 컴포넌트                                                  */
/* ------------------------------------------------------------------ */

const NODE_TYPES = Object.keys(FLOW_NODE_TYPE_LABEL) as FlowNodeType[];

const NODE_TYPE_CHIP: Record<FlowNodeType, string> = {
  start: 'chip chip-primary',
  screen: 'chip',
  action: 'chip',
  decision: 'chip chip-warn',
  system: 'chip',
  end: 'chip chip-ok',
};

function IssueBanner({ issues }: { issues: Issue[] }) {
  const tone = issues.some((i) => i.level === 'error')
    ? 'var(--danger)'
    : issues.some((i) => i.level === 'warn')
      ? 'var(--warn)'
      : 'var(--primary)';

  return (
    <div
      className="card overflow-hidden"
      style={{ borderLeft: `3px solid ${tone}` }}
      role="status"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2">
        <AlertTriangle size={14} style={{ color: tone }} />
        <span className="section-title">플로우 점검 {issues.length}건</span>
        <span className="text-[11.5px] text-[var(--fg-subtle)]">
          도달 불가 단계·빠져나갈 수 없는 단계·분기 누락을 자동으로 찾았습니다
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {issues.map((issue) => (
          <li key={issue.id} className="flex flex-wrap items-start gap-2 px-3.5 py-2.5">
            <span
              className={
                issue.level === 'error'
                  ? 'chip chip-danger'
                  : issue.level === 'warn'
                    ? 'chip chip-warn'
                    : 'chip chip-primary'
              }
            >
              {LEVEL_LABEL[issue.level]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-[var(--fg)]">
                {issue.title}
                {issue.regenerate && <RegenerateTag />}
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                {issue.detail}
              </p>
              {issue.targets.length > 0 && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                  {issue.targets.slice(0, 4).join(' · ')}
                  {issue.targets.length > 4 && ` 외 ${issue.targets.length - 4}건`}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 화면                                                                 */
/* ------------------------------------------------------------------ */

export default function FlowPage() {
  const { id: planId } = useParams<{ id: string }>();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));
  const addFlow = usePlannerStore((s) => s.addFlow);
  const updateFlow = usePlannerStore((s) => s.updateFlow);
  const removeFlow = usePlannerStore((s) => s.removeFlow);

  const { generate, pending } = useGenerate(plan);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const flows = useMemo(
    () => [...(plan?.flows ?? [])].sort((a, b) => a.order - b.order),
    [plan?.flows],
  );
  const flow: UserFlow | undefined = flows.find((f) => f.id === activeFlowId) ?? flows[0];

  const issues = useMemo(
    () => (plan ? validatePlan(plan).filter((i) => i.artifact === 'flow') : []),
    [plan],
  );

  /** 기능이 걸려 있는데 아직 어느 플로우에도 안 나오는 화면 수. */
  const uncoveredCount = useMemo(() => {
    if (!plan) return 0;
    const inFlows = new Set(
      plan.flows.flatMap((f) => f.nodes.map((n) => n.pageId).filter(Boolean) as string[]),
    );
    return plan.iaPages.filter(
      (p) => p.type === 'page' && p.featureIds.length > 0 && !inFlows.has(p.id),
    ).length;
  }, [plan]);
  const mermaid = useMemo(
    () => (plan && flow ? toMermaid(flow.id, plan) : ''),
    [plan, flow],
  );

  if (!plan) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;
  }

  const iaReady = plan.iaPages.length > 0;
  const selectedNode = flow?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  /* --- 액션 ------------------------------------------------------- */

  const handleGenerate = async () => {
    if (!iaReady) return;
    if (hasArtifact(plan, 'flow')) {
      const ok = await confirm({
        title: '유저 플로우를 다시 생성할까요?',
        message: '지금 편집한 플로우가 모두 새 결과로 덮어씌워집니다.',
        confirmLabel: '다시 생성',
        danger: true,
      });
      if (!ok) return;
    }
    const done = await generate('flow');
    if (done) {
      setActiveFlowId(null);
      setSelectedNodeId(null);
    }
  };

  /**
   * 플로우를 **더** 만든다. 지금 있는 것은 하나도 건드리지 않는다.
   *
   * 한 번에 다 만들라고 하면 3~5개에서 멈춘다. 화면이 스무 개를 넘어도 그렇다.
   * 그래서 나눠서 더 만들 수 있어야 하는데, `다시 생성` 은 전부 덮어쓰므로
   * 손으로 다듬어 둔 플로우가 사라진다. 이 버튼은 **뒤에 붙이기만** 한다.
   */
  const handleGenerateMore = async () => {
    if (!iaReady) return;
    const before = plan.flows.length;
    const done = await generate('flow', { merge: true });
    if (done) {
      setSelectedNodeId(null);
      // 새로 붙은 첫 플로우를 열어 준다. 만들어 놓고 안 보이면 안 만든 것처럼 보인다.
      const added = usePlannerStore.getState().plans.find((p) => p.id === planId)?.flows ?? [];
      if (added.length > before) setActiveFlowId(added[before].id);
    }
  };

  const handleAddFlow = () => {
    const id = addFlow(planId);
    setActiveFlowId(id);
    setSelectedNodeId(null);
  };

  const handleRemoveFlow = async () => {
    if (!flow) return;
    const ok = await confirm({
      title: `'${flow.name}' 플로우를 삭제할까요?`,
      message: '이 플로우의 단계와 연결선이 함께 삭제됩니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeFlow(planId, flow.id);
    setActiveFlowId(null);
    setSelectedNodeId(null);
    toast('플로우를 삭제했습니다.', 'ok');
  };

  const patchFlow = (patch: Partial<UserFlow>) => {
    if (!flow) return;
    updateFlow(planId, flow.id, patch);
  };

  const patchNode = (nodeId: string, patch: Partial<FlowNode>) => {
    if (!flow) return;
    patchFlow({ nodes: flow.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) });
  };

  const handleAddNode = () => {
    if (!flow) return;
    const id = `${flow.id}-n${Date.now()}`;
    const node: FlowNode = {
      id,
      type: flow.nodes.length === 0 ? 'start' : 'action',
      label: flow.nodes.length === 0 ? '시작' : '새 단계',
      description: '',
      pageId: null,
    };
    patchFlow({ nodes: [...flow.nodes, node] });
    setSelectedNodeId(id);
  };

  const handleRemoveNode = async (nodeId: string) => {
    if (!flow) return;
    const target = flow.nodes.find((n) => n.id === nodeId);
    const linked = flow.edges.filter((e) => e.from === nodeId || e.to === nodeId).length;
    const ok = await confirm({
      title: `'${target?.label ?? '단계'}'를 삭제할까요?`,
      message:
        linked > 0
          ? `이 단계를 참조하는 연결선 ${linked}개도 함께 삭제됩니다.`
          : '이 단계를 삭제합니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    patchFlow({
      nodes: flow.nodes.filter((n) => n.id !== nodeId),
      edges: flow.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    });
    setSelectedNodeId(null);
  };

  const patchEdge = (edgeId: string, patch: Partial<FlowEdge>) => {
    if (!flow) return;
    patchFlow({ edges: flow.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) });
  };

  const handleAddEdge = () => {
    if (!flow) return;
    if (flow.nodes.length < 2) {
      toast('연결선을 만들려면 단계가 2개 이상 필요합니다.', 'warn');
      return;
    }
    const edge: FlowEdge = {
      id: `${flow.id}-e${Date.now()}`,
      from: flow.nodes[0].id,
      to: flow.nodes[1].id,
      label: '',
    };
    patchFlow({ edges: [...flow.edges, edge] });
  };

  const handleCopyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(mermaid);
      toast('Mermaid 코드를 복사했습니다.', 'ok');
    } catch {
      toast('복사에 실패했습니다. 코드를 직접 선택해 복사해 주세요.', 'danger');
    }
  };

  /** 화면에 그려진 캔버스를 그대로 파일로 뽑는다. */
  const exportCanvas = async (format: 'svg' | 'png') => {
    const svg = findChartSvg(canvasRef.current);
    if (!svg || !flow) {
      toast('내보낼 플로우차트를 찾지 못했습니다.', 'danger');
      return;
    }
    const markup = serializeSvg(svg);
    const filename = `${slugify(plan?.brief.title ?? 'flow')}-${flow.id}.${format}`;
    try {
      if (format === 'svg') downloadSvg(filename, markup);
      else await downloadPng(filename, markup, 2);
      toast(`${flow.name} 플로우차트를 ${format.toUpperCase()} 로 내려받았습니다.`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '이미지 변환에 실패했습니다.', 'danger');
    }
  };

  /* --- 렌더 ------------------------------------------------------- */

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      {dialog}

      {/* 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[17px] font-extrabold tracking-tight">유저 플로우</h2>
          <span className="chip">플로우 {flows.length}개</span>
          {/* 문제와 그것을 푸는 버튼이 같은 줄에 있어야 실제로 눌린다. */}
          {uncoveredCount > 0 && hasArtifact(plan, 'flow') && (
            <span className="chip chip-warn" title="이 화면들을 지나는 여정이 아직 없습니다.">
              플로우에 없는 화면 {uncoveredCount}개
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className={`btn btn-primary btn-sm${pending === 'flow' ? ' is-busy' : ''}`}
            disabled={pending !== null || !iaReady}
            title={iaReady ? undefined : '정보구조도를 먼저 만들어야 플로우를 생성할 수 있습니다.'}
            onClick={() => void handleGenerate()}
          >
            {pending === 'flow' ? <Spinner size={13} /> : <Sparkles size={13} />}
            {pending === 'flow' ? '생성중' : hasArtifact(plan, 'flow') ? '다시 생성' : 'AI로 생성'}
          </button>
          {hasArtifact(plan, 'flow') && (
            <button
              className="btn btn-sm"
              disabled={pending !== null || !iaReady}
              title="지금 있는 플로우는 그대로 두고 새 플로우만 덧붙입니다."
              onClick={() => void handleGenerateMore()}
            >
              <Sparkles size={13} />
              플로우 더 만들기
            </button>
          )}
          <button className="btn btn-sm" onClick={handleAddFlow}>
            <Plus size={13} />
            빈 플로우
          </button>
          <NextStepButton planId={planId} current="flow" />
        </div>
      </div>

      {!iaReady && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0" />
          정보구조도(IA)가 없으면 AI 생성이 막힙니다. 정보구조도를 먼저 만들어 주세요.
        </p>
      )}

      {issues.length > 0 && (
        <div className="mt-4">
          <IssueBanner issues={issues} />
        </div>
      )}

      {flows.length === 0 ? (
        <div className="card mt-4">
          {pending === 'flow' ? (
            <GeneratingState artifact="flow" />
          ) : (
            <EmptyState
              icon={<GitBranch size={26} />}
              title="아직 유저 플로우가 없습니다"
              description="정보구조도를 바탕으로 AI가 핵심 시나리오를 플로우차트로 만들어 줍니다. 직접 추가해 그릴 수도 있습니다."
              action={
                <div className="flex gap-1.5">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={pending !== null || !iaReady}
                    onClick={() => void handleGenerate()}
                  >
                    <Sparkles size={13} />
                    AI로 생성
                  </button>
                  <button className="btn btn-sm" onClick={handleAddFlow}>
                    <Plus size={13} />
                    직접 추가
                  </button>
                </div>
              }
            />
          )}
        </div>
      ) : (
        flow && (
          <>
            {/* 플로우 탭 */}
            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {flows.map((item) => {
                const active = item.id === flow.id;
                return (
                  <button
                    key={item.id}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition ${
                      active
                        ? 'border-[var(--primary-border)] bg-[var(--primary-soft)] text-[var(--primary)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:bg-[var(--surface-2)]'
                    }`}
                    onClick={() => {
                      setActiveFlowId(item.id);
                      setSelectedNodeId(null);
                    }}
                  >
                    <span className="max-w-40 truncate">{item.name}</span>
                    <span className="text-[11px] font-semibold text-[var(--fg-subtle)]">
                      {item.nodes.length}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 플로우 메타 */}
            <div className="card mt-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="id-tag mt-2">{flow.id}</span>
                <button className="btn btn-danger btn-sm shrink-0" onClick={() => void handleRemoveFlow()}>
                  <Trash2 size={13} />
                  삭제
                </button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Field label="플로우명">
                  <InlineText
                    value={flow.name}
                    placeholder="예: 회원가입 후 첫 주문"
                    onChange={(name) => patchFlow({ name })}
                  />
                </Field>
                <Field label="수행 역할">
                  <InlineText
                    value={flow.actor}
                    placeholder="예: 일반 사용자"
                    onChange={(actor) => patchFlow({ actor })}
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="설명">
                  <InlineText
                    value={flow.description}
                    multiline
                    rows={2}
                    placeholder="이 플로우가 다루는 시나리오를 적어 주세요."
                    onChange={(description) => patchFlow({ description })}
                  />
                </Field>
              </div>
            </div>

            {/* 본문 2단 */}
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="card min-w-0 p-3">
                <div className="mb-2 flex items-center justify-end gap-1.5">
                  <span className="mr-auto text-[11.5px] text-[var(--fg-subtle)]">
                    디자인 전달용 이미지
                  </span>
                  <button className="btn btn-sm" onClick={() => void exportCanvas('svg')}>
                    <ImageIcon size={13} />
                    SVG
                  </button>
                  <button className="btn btn-sm" onClick={() => void exportCanvas('png')}>
                    <ImageIcon size={13} />
                    PNG
                  </button>
                </div>
                <div ref={canvasRef}>
                  <FlowCanvas
                    flow={flow}
                    pages={plan.iaPages}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
              </div>

              <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
                {selectedNode ? (
                  /* 노드 편집 */
                  <div className="card overflow-hidden">
                    <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
                      <h3 className="section-title">단계 편집</h3>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedNodeId(null)}
                        aria-label="선택 해제"
                      >
                        <X size={13} />
                        선택 해제
                      </button>
                    </header>
                    <div className="flex flex-col gap-3 p-4">
                      <Field label="라벨">
                        <InlineText
                          value={selectedNode.label}
                          placeholder="단계 이름"
                          onChange={(label) => patchNode(selectedNode.id, { label })}
                        />
                      </Field>
                      <Field label="유형">
                        <select
                          className="select"
                          value={selectedNode.type}
                          onChange={(e) =>
                            patchNode(selectedNode.id, { type: e.target.value as FlowNodeType })
                          }
                        >
                          {NODE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {FLOW_NODE_TYPE_LABEL[type]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="설명">
                        <InlineText
                          value={selectedNode.description ?? ''}
                          multiline
                          rows={3}
                          placeholder="이 단계에서 무슨 일이 일어나는지 적어 주세요."
                          onChange={(description) => patchNode(selectedNode.id, { description })}
                        />
                      </Field>
                      <Field
                        label="연결 화면"
                        hint="정보구조도의 페이지와 연결하면 플로우차트에 페이지명이 표시됩니다."
                      >
                        <select
                          className="select"
                          value={selectedNode.pageId ?? ''}
                          onChange={(e) =>
                            patchNode(selectedNode.id, { pageId: e.target.value || null })
                          }
                        >
                          <option value="">연결 없음</option>
                          {plan.iaPages.map((page) => (
                            <option key={page.id} value={page.id}>
                              {page.id} · {page.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <button
                        className="btn btn-danger btn-sm self-start"
                        onClick={() => void handleRemoveNode(selectedNode.id)}
                      >
                        <Trash2 size={13} />
                        단계 삭제
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 노드 · 연결선 목록 */
                  <div className="flex flex-col gap-4">
                    <div className="card overflow-hidden">
                      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
                        <h3 className="section-title">단계 {flow.nodes.length}개</h3>
                        <button className="btn btn-ghost btn-sm" onClick={handleAddNode}>
                          <Plus size={13} />
                          추가
                        </button>
                      </header>
                      {flow.nodes.length === 0 ? (
                        <p className="px-4 py-5 text-center text-[12.5px] text-[var(--fg-subtle)]">
                          단계를 추가해 플로우를 그려 보세요.
                        </p>
                      ) : (
                        <ul className="divide-y divide-[var(--border)]">
                          {flow.nodes.map((node) => {
                            const page = node.pageId
                              ? plan.iaPages.find((p) => p.id === node.pageId)
                              : undefined;
                            return (
                              <li key={node.id}>
                                <button
                                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[var(--surface-2)]"
                                  onClick={() => setSelectedNodeId(node.id)}
                                >
                                  <span className={NODE_TYPE_CHIP[node.type]}>
                                    {FLOW_NODE_TYPE_LABEL[node.type]}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                                    {node.label || '(이름 없음)'}
                                  </span>
                                  {page && (
                                    <span className="max-w-24 shrink-0 truncate text-[11px] text-[var(--fg-subtle)]">
                                      {page.name}
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div className="card overflow-hidden">
                      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
                        <h3 className="section-title">연결선 {flow.edges.length}개</h3>
                        <button className="btn btn-ghost btn-sm" onClick={handleAddEdge}>
                          <Plus size={13} />
                          추가
                        </button>
                      </header>
                      {flow.edges.length === 0 ? (
                        <p className="px-4 py-5 text-center text-[12.5px] text-[var(--fg-subtle)]">
                          아직 연결선이 없습니다.
                        </p>
                      ) : (
                        <ul className="divide-y divide-[var(--border)]">
                          {flow.edges.map((edge) => (
                            <li key={edge.id} className="flex flex-col gap-1.5 px-3.5 py-3">
                              <div className="flex items-center gap-1.5">
                                <select
                                  className="select"
                                  style={{ padding: '5px 6px', fontSize: 12 }}
                                  value={edge.from}
                                  onChange={(e) => patchEdge(edge.id, { from: e.target.value })}
                                  aria-label="시작 단계"
                                >
                                  {flow.nodes.map((n) => (
                                    <option key={n.id} value={n.id}>
                                      {n.label || n.id}
                                    </option>
                                  ))}
                                </select>
                                <ArrowRight size={13} className="shrink-0 text-[var(--fg-subtle)]" />
                                <select
                                  className="select"
                                  style={{ padding: '5px 6px', fontSize: 12 }}
                                  value={edge.to}
                                  onChange={(e) => patchEdge(edge.id, { to: e.target.value })}
                                  aria-label="도착 단계"
                                >
                                  {flow.nodes.map((n) => (
                                    <option key={n.id} value={n.id}>
                                      {n.label || n.id}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <InlineText
                                  value={edge.label ?? ''}
                                  placeholder="조건 라벨 (예: 로그인 성공)"
                                  onChange={(label) => patchEdge(edge.id, { label })}
                                />
                                <button
                                  className="btn btn-ghost btn-sm shrink-0"
                                  onClick={() =>
                                    patchFlow({ edges: flow.edges.filter((e) => e.id !== edge.id) })
                                  }
                                  aria-label="연결선 삭제"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Mermaid */}
            <div className="card mt-4 overflow-hidden">
              <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
                <div className="min-w-0">
                  <h3 className="section-title">Mermaid 코드</h3>
                  <p className="mt-0.5 text-[11.5px] text-[var(--fg-muted)]">
                    Notion·GitHub·Obsidian 에 그대로 붙여 넣을 수 있습니다.
                  </p>
                </div>
                <button className="btn btn-sm shrink-0" onClick={() => void handleCopyMermaid()}>
                  <Copy size={13} />
                  복사
                </button>
              </header>
              <div className="overflow-x-auto p-4">
                <pre className="text-[12px] leading-relaxed text-[var(--fg-muted)]">{mermaid}</pre>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
