'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  LayoutList,
  ListTree,
  MousePointerClick,
  Plus,
  Search,
  Sparkles,
  Table2,
  Trash2,
} from 'lucide-react';
import { EmptyState, Field, InlineText, ListEditor, Spinner, useConfirm } from '@/components/ui';
import { usePlannerStore } from '@/lib/store';
import { useGenerate } from '@/lib/useGenerate';
import {
  PRIORITY_LABEL,
  WORK_STATUS_ORDER,
  type Feature,
  type IaPage,
  type Priority,
  type Requirement,
  type Specification,
  type WorkStatus,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 상수 · 유틸                                                          */
/* ------------------------------------------------------------------ */

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];

const PRIORITY_CHIP: Record<Priority, string> = {
  P0: 'chip chip-danger',
  P1: 'chip chip-warn',
  P2: 'chip chip-primary',
  P3: 'chip',
};

const STATUS_COLOR: Record<WorkStatus, string> = {
  작성전: 'var(--border-strong)',
  작성중: 'var(--warn)',
  검토중: 'var(--primary)',
  확정: 'var(--ok)',
};

type Selection =
  | { kind: 'requirement'; id: string }
  | { kind: 'feature'; id: string }
  | { kind: 'specification'; id: string }
  | null;

interface TreeFeature {
  feature: Feature;
  specs: Specification[];
}
interface TreeNode {
  req: Requirement;
  features: TreeFeature[];
}

function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order;
}

function PriorityBadge({ value }: { value: Priority }) {
  return (
    <span className={PRIORITY_CHIP[value]} title={`우선순위 ${value}`}>
      {value}
    </span>
  );
}

function StatusDot({ value }: { value: WorkStatus }) {
  return (
    <span
      className="size-1.5 shrink-0 rounded-full"
      style={{ background: STATUS_COLOR[value] }}
      title={value}
    />
  );
}

function PrioritySelect({
  value,
  onChange,
  compact,
}: {
  value: Priority;
  onChange: (next: Priority) => void;
  compact?: boolean;
}) {
  return (
    <select
      className="select"
      style={compact ? { padding: '4px 6px', fontSize: 12 } : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value as Priority)}
      aria-label="우선순위"
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {p} · {PRIORITY_LABEL[p]}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({
  value,
  onChange,
  compact,
}: {
  value: WorkStatus;
  onChange: (next: WorkStatus) => void;
  compact?: boolean;
}) {
  return (
    <select
      className="select"
      style={compact ? { padding: '4px 6px', fontSize: 12 } : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value as WorkStatus)}
      aria-label="상태"
    >
      {WORK_STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* 페이지                                                               */
/* ------------------------------------------------------------------ */

export default function FsPage() {
  const { id: planId } = useParams<{ id: string }>();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));

  const addRequirement = usePlannerStore((s) => s.addRequirement);
  const updateRequirement = usePlannerStore((s) => s.updateRequirement);
  const removeRequirement = usePlannerStore((s) => s.removeRequirement);
  const addFeature = usePlannerStore((s) => s.addFeature);
  const updateFeature = usePlannerStore((s) => s.updateFeature);
  const removeFeature = usePlannerStore((s) => s.removeFeature);
  const addSpecification = usePlannerStore((s) => s.addSpecification);
  const updateSpecification = usePlannerStore((s) => s.updateSpecification);
  const removeSpecification = usePlannerStore((s) => s.removeSpecification);

  const { generate, pending } = useGenerate(plan);
  const { confirm, dialog } = useConfirm();

  const [view, setView] = useState<'tree' | 'table'>('tree');
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkStatus>('all');
  const [selection, setSelection] = useState<Selection>(null);
  const [openReqs, setOpenReqs] = useState<string[]>([]);
  const [openFeatures, setOpenFeatures] = useState<string[]>([]);

  const requirements = plan?.requirements ?? [];
  const features = plan?.features ?? [];
  const specifications = plan?.specifications ?? [];
  const iaPages = plan?.iaPages ?? [];

  /* 필터링된 트리 --------------------------------------------------- */
  const tree = useMemo<TreeNode[]>(() => {
    const reqs = plan?.requirements ?? [];
    const fns = plan?.features ?? [];
    const sps = plan?.specifications ?? [];
    const q = query.trim().toLowerCase();
    const hit = (...parts: string[]) =>
      q === '' || parts.some((part) => part.toLowerCase().includes(q));
    const prioOk = (p: Priority) => priorityFilter === 'all' || priorityFilter === p;
    const statusOk = (s: WorkStatus) => statusFilter === 'all' || statusFilter === s;

    return [...reqs]
      .sort(byOrder)
      .map((req) => {
        const reqHit = hit(req.id, req.title, req.description, req.category);
        const nodes: TreeFeature[] = [...fns]
          .filter((f) => f.requirementId === req.id)
          .sort(byOrder)
          .map((feature) => {
            const featureHit = reqHit || hit(feature.id, feature.name, feature.description);
            const specs = [...sps]
              .filter((s) => s.featureId === feature.id)
              .sort(byOrder)
              .filter(
                (s) =>
                  (featureHit ||
                    hit(
                      s.id,
                      s.title,
                      s.actor,
                      s.precondition,
                      ...s.mainFlow,
                      ...s.exceptions,
                      ...s.acceptanceCriteria,
                    )) &&
                  prioOk(s.priority) &&
                  statusOk(s.status),
              );
            return { feature, specs, keep: featureHit && prioOk(feature.priority) && statusOk(feature.status) };
          })
          .filter((node) => node.keep || node.specs.length > 0)
          .map(({ feature, specs }) => ({ feature, specs }));

        return { req, features: nodes, keep: reqHit && prioOk(req.priority) };
      })
      .filter((node) => node.keep || node.features.length > 0)
      .map(({ req, features: list }) => ({ req, features: list }));
  }, [requirements, features, specifications, query, priorityFilter, statusFilter]);

  const searching = query.trim() !== '' || priorityFilter !== 'all' || statusFilter !== 'all';
  const isReqOpen = (id: string) => searching || openReqs.includes(id);
  const isFeatureOpen = (id: string) => searching || openFeatures.includes(id);
  const toggleReq = (id: string) =>
    setOpenReqs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleFeature = (id: string) =>
    setOpenFeatures((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const p0Count = features.filter((f) => f.priority === 'P0').length;

  const pagesOfFeature = (featureId: string): IaPage[] =>
    [...iaPages].filter((p) => p.featureIds.includes(featureId)).sort(byOrder);

  const linkedPageCount = (featureId: string) => {
    const ids = new Set(pagesOfFeature(featureId).map((p) => p.id));
    for (const spec of specifications) {
      if (spec.featureId !== featureId) continue;
      for (const pid of spec.pageIds) ids.add(pid);
    }
    return ids.size;
  };

  /* 액션 ------------------------------------------------------------ */
  const handleGenerate = async () => {
    if (!plan) return;
    if (plan.generated.fs || requirements.length > 0) {
      const ok = await confirm({
        title: '기능명세서를 다시 생성할까요?',
        message:
          '지금까지 편집한 요구사항·기능·상세 명세가 모두 새로 생성된 내용으로 덮어써집니다. 되돌릴 수 없습니다.',
        confirmLabel: '다시 생성',
        danger: true,
      });
      if (!ok) return;
    }
    await generate('fs');
  };

  const handleAddRequirement = () => {
    if (!plan) return;
    const id = addRequirement(plan.id);
    setSelection({ kind: 'requirement', id });
    setOpenReqs((prev) => [...prev, id]);
  };

  const handleAddFeature = (requirementId: string) => {
    if (!plan) return;
    const id = addFeature(plan.id, requirementId);
    setSelection({ kind: 'feature', id });
    setOpenReqs((prev) => (prev.includes(requirementId) ? prev : [...prev, requirementId]));
    setOpenFeatures((prev) => [...prev, id]);
  };

  const handleAddSpec = (featureId: string) => {
    if (!plan) return;
    const id = addSpecification(plan.id, featureId);
    setSelection({ kind: 'specification', id });
    setOpenFeatures((prev) => (prev.includes(featureId) ? prev : [...prev, featureId]));
  };

  const handleRemoveRequirement = async (req: Requirement) => {
    if (!plan) return;
    const childFeatures = features.filter((f) => f.requirementId === req.id);
    const childSpecs = specifications.filter((s) =>
      childFeatures.some((f) => f.id === s.featureId),
    );
    const ok = await confirm({
      title: `${req.id} 요구사항을 삭제할까요?`,
      message: `하위 기능 ${childFeatures.length}개와 상세 명세 ${childSpecs.length}개도 함께 삭제됩니다. 정보구조도에 걸린 기능 연결도 정리됩니다. 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeRequirement(plan.id, req.id);
    setSelection(null);
  };

  const handleRemoveFeature = async (feature: Feature) => {
    if (!plan) return;
    const childSpecs = specifications.filter((s) => s.featureId === feature.id);
    const ok = await confirm({
      title: `${feature.id} 기능을 삭제할까요?`,
      message: `하위 상세 명세 ${childSpecs.length}개도 함께 삭제되고, 화면에 걸린 연결도 해제됩니다. 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeFeature(plan.id, feature.id);
    setSelection(null);
  };

  const handleRemoveSpec = async (spec: Specification) => {
    if (!plan) return;
    const ok = await confirm({
      title: `${spec.id} 상세 명세를 삭제할까요?`,
      message: '되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeSpecification(plan.id, spec.id);
    setSelection(null);
  };

  if (!plan) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;
  }

  const generating = pending === 'fs';
  const selectedRequirement =
    selection?.kind === 'requirement' ? requirements.find((r) => r.id === selection.id) : undefined;
  const selectedFeature =
    selection?.kind === 'feature' ? features.find((f) => f.id === selection.id) : undefined;
  const selectedSpec =
    selection?.kind === 'specification'
      ? specifications.find((s) => s.id === selection.id)
      : undefined;

  /* ---------------------------------------------------------------- */
  /* 미생성 상태                                                       */
  /* ---------------------------------------------------------------- */
  if (requirements.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {dialog}
        <header className="mb-4">
          <h1 className="text-[19px] font-extrabold tracking-tight">기능명세서 (FS)</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            요구사항(REQ)을 기능(FN)으로, 기능을 상세 명세(SP)로 쪼개어 개발이 바로 착수할 수 있는
            단위까지 정리합니다.
          </p>
        </header>
        <div className="card">
          <EmptyState
            icon={<Table2 size={26} />}
            title="아직 기능명세서가 없습니다"
            description={
              plan.generated.prd
                ? 'PRD를 기준으로 요구사항·기능·상세 명세를 한 번에 만들어 드립니다. 직접 항목을 추가해 처음부터 작성할 수도 있습니다.'
                : 'PRD를 먼저 만들면 더 정확한 기능명세서를 얻을 수 있습니다. 지금 바로 생성하거나 직접 작성할 수도 있습니다.'
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={pending !== null}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? <Spinner size={13} /> : <Sparkles size={13} />}
                  AI로 생성
                </button>
                <button className="btn btn-sm" onClick={handleAddRequirement}>
                  <Plus size={13} />
                  직접 추가
                </button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 본 화면                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className={`mx-auto w-full ${view === 'table' ? 'max-w-6xl' : 'max-w-5xl'} p-4 sm:p-6`}>
      {dialog}

      {/* 상단 툴바 */}
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[19px] font-extrabold tracking-tight">기능명세서 (FS)</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip">요구사항 {requirements.length}</span>
              <span className="chip">기능 {features.length}</span>
              <span className="chip">상세명세 {specifications.length}</span>
              <span className="chip chip-danger" title="우선순위 P0 기능 수">
                필수(P0) {p0Count}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <div className="flex overflow-hidden rounded-lg border border-[var(--border-strong)]">
              <button
                className={`btn btn-sm rounded-none border-0 ${view === 'tree' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setView('tree')}
              >
                <ListTree size={13} />
                트리
              </button>
              <button
                className={`btn btn-sm rounded-none border-0 ${view === 'table' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setView('table')}
              >
                <LayoutList size={13} />
                <span>표</span>
              </button>
            </div>
            <button
              className="btn btn-primary btn-sm"
              disabled={pending !== null}
              onClick={() => void handleGenerate()}
            >
              {generating ? <Spinner size={13} /> : <Sparkles size={13} />}
              {plan.generated.fs ? '다시 생성' : 'AI로 생성'}
            </button>
          </div>
        </div>

        {/* 검색 · 필터 */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]"
            />
            <input
              className="input pl-8"
              value={query}
              placeholder="요구사항 · 기능 · 명세 검색"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              className="select"
              style={{ width: 'auto' }}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as 'all' | Priority)}
              aria-label="우선순위 필터"
            >
              <option value="all">전체 우선순위</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p} · {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ width: 'auto' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | WorkStatus)}
              aria-label="상태 필터"
            >
              <option value="all">전체 상태</option>
              {WORK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {view === 'table' ? (
        /* ---------------- 표 보기 ---------------- */
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>요구사항ID</th>
                <th>요구사항</th>
                <th>기능ID</th>
                <th>기능명</th>
                <th>설명</th>
                <th>우선순위</th>
                <th>상태</th>
                <th>명세 수</th>
                <th>연결 화면 수</th>
              </tr>
            </thead>
            <tbody>
              {tree.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <p className="py-6 text-center text-[12.5px] text-[var(--fg-muted)]">
                      조건에 맞는 항목이 없습니다.
                    </p>
                  </td>
                </tr>
              )}
              {tree.flatMap((node) =>
                node.features.length === 0
                  ? [
                      <tr key={node.req.id}>
                        <td className="id-tag whitespace-nowrap">{node.req.id}</td>
                        <td className="font-semibold">{node.req.title}</td>
                        <td colSpan={2} className="text-[12px] text-[var(--fg-subtle)]">
                          하위 기능 없음
                        </td>
                        <td className="text-[12px] text-[var(--fg-muted)]">{node.req.description}</td>
                        <td>
                          <PrioritySelect
                            compact
                            value={node.req.priority}
                            onChange={(priority) =>
                              updateRequirement(plan.id, node.req.id, { priority })
                            }
                          />
                        </td>
                        <td className="text-[12px] text-[var(--fg-subtle)]">—</td>
                        <td className="text-[12px] text-[var(--fg-subtle)]">—</td>
                        <td className="text-[12px] text-[var(--fg-subtle)]">—</td>
                      </tr>,
                    ]
                  : node.features.map((child, index) => (
                      <tr key={child.feature.id}>
                        <td className="id-tag whitespace-nowrap">
                          {index === 0 ? node.req.id : ''}
                        </td>
                        <td className="min-w-32 font-semibold">
                          {index === 0 ? node.req.title : ''}
                        </td>
                        <td className="whitespace-nowrap">
                          <button
                            className="id-tag cursor-pointer hover:text-[var(--primary)]"
                            onClick={() => {
                              setView('tree');
                              setSelection({ kind: 'feature', id: child.feature.id });
                            }}
                          >
                            {child.feature.id}
                          </button>
                        </td>
                        <td className="min-w-32">{child.feature.name}</td>
                        <td className="min-w-40 text-[12px] text-[var(--fg-muted)]">
                          {child.feature.description}
                        </td>
                        <td>
                          <PrioritySelect
                            compact
                            value={child.feature.priority}
                            onChange={(priority) =>
                              updateFeature(plan.id, child.feature.id, { priority })
                            }
                          />
                        </td>
                        <td>
                          <StatusSelect
                            compact
                            value={child.feature.status}
                            onChange={(status) =>
                              updateFeature(plan.id, child.feature.id, { status })
                            }
                          />
                        </td>
                        <td className="text-center tabular-nums">
                          {specifications.filter((s) => s.featureId === child.feature.id).length}
                        </td>
                        <td className="text-center tabular-nums">
                          {linkedPageCount(child.feature.id)}
                        </td>
                      </tr>
                    )),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* ---------------- 트리 + 편집 ---------------- */
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* 좌: 요구사항 트리 */}
          <aside className="card w-full shrink-0 overflow-hidden lg:sticky lg:top-4 lg:w-[260px]">
            <div className="max-h-[52vh] overflow-y-auto p-2 lg:max-h-[calc(100dvh-9rem)]">
              {tree.length === 0 ? (
                <p className="px-2 py-8 text-center text-[12.5px] text-[var(--fg-muted)]">
                  조건에 맞는 항목이 없습니다.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {tree.map((node) => {
                    const open = isReqOpen(node.req.id);
                    const active = selection?.kind === 'requirement' && selection.id === node.req.id;
                    const featureCount = features.filter(
                      (f) => f.requirementId === node.req.id,
                    ).length;
                    return (
                      <li key={node.req.id}>
                        <div
                          className={`flex items-center gap-1 rounded-lg px-1 py-1 ${
                            active ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--surface-2)]'
                          }`}
                        >
                          <button
                            className="btn btn-ghost btn-sm shrink-0 px-1"
                            onClick={() => toggleReq(node.req.id)}
                            aria-label={open ? '접기' : '펼치기'}
                          >
                            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                          <button
                            className="min-w-0 flex-1 cursor-pointer py-0.5 text-left"
                            onClick={() => setSelection({ kind: 'requirement', id: node.req.id })}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="id-tag">{node.req.id}</span>
                              <PriorityBadge value={node.req.priority} />
                            </span>
                            <span
                              className={`mt-0.5 block truncate text-[12.5px] font-bold ${
                                active ? 'text-[var(--primary)]' : ''
                              }`}
                            >
                              {node.req.title}
                            </span>
                          </button>
                          <span className="chip shrink-0" title="하위 기능 개수">
                            {featureCount}
                          </span>
                        </div>

                        {open && (
                          <ul className="mb-1 ml-3.5 flex flex-col gap-0.5 border-l border-[var(--border)] pl-1.5">
                            {node.features.map((child) => {
                              const fOpen = isFeatureOpen(child.feature.id);
                              const fActive =
                                selection?.kind === 'feature' && selection.id === child.feature.id;
                              return (
                                <li key={child.feature.id}>
                                  <div
                                    className={`flex items-center gap-1 rounded-lg px-1 py-1 ${
                                      fActive
                                        ? 'bg-[var(--primary-soft)]'
                                        : 'hover:bg-[var(--surface-2)]'
                                    }`}
                                  >
                                    <button
                                      className="btn btn-ghost btn-sm shrink-0 px-1"
                                      onClick={() => toggleFeature(child.feature.id)}
                                      aria-label={fOpen ? '접기' : '펼치기'}
                                    >
                                      {fOpen ? (
                                        <ChevronDown size={12} />
                                      ) : (
                                        <ChevronRight size={12} />
                                      )}
                                    </button>
                                    <button
                                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-0.5 text-left"
                                      onClick={() =>
                                        setSelection({ kind: 'feature', id: child.feature.id })
                                      }
                                    >
                                      <StatusDot value={child.feature.status} />
                                      <span className="min-w-0 flex-1">
                                        <span className="id-tag block">{child.feature.id}</span>
                                        <span
                                          className={`block truncate text-[12px] font-semibold ${
                                            fActive ? 'text-[var(--primary)]' : ''
                                          }`}
                                        >
                                          {child.feature.name}
                                        </span>
                                      </span>
                                    </button>
                                  </div>

                                  {fOpen && (
                                    <ul className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-[var(--border)] pl-1.5">
                                      {child.specs.map((spec) => {
                                        const sActive =
                                          selection?.kind === 'specification' &&
                                          selection.id === spec.id;
                                        return (
                                          <li key={spec.id}>
                                            <button
                                              className={`flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-left ${
                                                sActive
                                                  ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                                                  : 'hover:bg-[var(--surface-2)]'
                                              }`}
                                              onClick={() =>
                                                setSelection({
                                                  kind: 'specification',
                                                  id: spec.id,
                                                })
                                              }
                                            >
                                              <StatusDot value={spec.status} />
                                              <span className="id-tag shrink-0">{spec.id}</span>
                                              <span className="min-w-0 flex-1 truncate text-[12px]">
                                                {spec.title}
                                              </span>
                                            </button>
                                          </li>
                                        );
                                      })}
                                      <li>
                                        <button
                                          className="btn btn-ghost btn-sm w-full justify-start"
                                          onClick={() => handleAddSpec(child.feature.id)}
                                        >
                                          <Plus size={12} />
                                          상세명세
                                        </button>
                                      </li>
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                            <li>
                              <button
                                className="btn btn-ghost btn-sm w-full justify-start"
                                onClick={() => handleAddFeature(node.req.id)}
                              >
                                <Plus size={12} />
                                기능
                              </button>
                            </li>
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="border-t border-[var(--border)] p-2">
              <button className="btn btn-sm w-full" onClick={handleAddRequirement}>
                <Plus size={13} />
                요구사항 추가
              </button>
            </div>
          </aside>

          {/* 우: 편집 패널 */}
          <section className="min-w-0 flex-1">
            {selectedRequirement ? (
              <RequirementEditor
                key={selectedRequirement.id}
                requirement={selectedRequirement}
                featureCount={features.filter((f) => f.requirementId === selectedRequirement.id).length}
                onChange={(patch) => updateRequirement(plan.id, selectedRequirement.id, patch)}
                onAddFeature={() => handleAddFeature(selectedRequirement.id)}
                onRemove={() => void handleRemoveRequirement(selectedRequirement)}
              />
            ) : selectedFeature ? (
              <FeatureEditor
                key={selectedFeature.id}
                feature={selectedFeature}
                requirements={[...requirements].sort(byOrder)}
                placedPages={pagesOfFeature(selectedFeature.id)}
                specCount={specifications.filter((s) => s.featureId === selectedFeature.id).length}
                onChange={(patch) => updateFeature(plan.id, selectedFeature.id, patch)}
                onAddSpec={() => handleAddSpec(selectedFeature.id)}
                onRemove={() => void handleRemoveFeature(selectedFeature)}
              />
            ) : selectedSpec ? (
              <SpecificationEditor
                key={selectedSpec.id}
                spec={selectedSpec}
                feature={features.find((f) => f.id === selectedSpec.featureId)}
                pages={[...iaPages].sort(byOrder)}
                onChange={(patch) => updateSpecification(plan.id, selectedSpec.id, patch)}
                onRemove={() => void handleRemoveSpec(selectedSpec)}
              />
            ) : (
              <div className="card">
                <EmptyState
                  icon={<MousePointerClick size={24} />}
                  title="왼쪽에서 항목을 선택하세요"
                  description="요구사항·기능·상세 명세를 고르면 이곳에서 바로 편집할 수 있습니다."
                />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 편집 패널 — 요구사항                                                  */
/* ------------------------------------------------------------------ */

function PanelShell({
  id,
  title,
  badge,
  onRemove,
  removeLabel,
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  onRemove: () => void;
  removeLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="id-tag">{id}</span>
          <h2 className="section-title">{title}</h2>
          {badge}
        </div>
        <button className="btn btn-danger btn-sm shrink-0" onClick={onRemove}>
          <Trash2 size={13} />
          {removeLabel}
        </button>
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}

function RequirementEditor({
  requirement,
  featureCount,
  onChange,
  onAddFeature,
  onRemove,
}: {
  requirement: Requirement;
  featureCount: number;
  onChange: (patch: Partial<Requirement>) => void;
  onAddFeature: () => void;
  onRemove: () => void;
}) {
  return (
    <PanelShell
      id={requirement.id}
      title="요구사항"
      badge={<span className="chip">하위 기능 {featureCount}</span>}
      onRemove={onRemove}
      removeLabel="삭제"
    >
      <Field label="요구사항명">
        <InlineText
          value={requirement.title}
          placeholder="예: 회원 가입 및 로그인"
          onChange={(title) => onChange({ title })}
        />
      </Field>
      <Field label="설명">
        <InlineText
          multiline
          rows={4}
          value={requirement.description}
          placeholder="이 요구사항이 왜 필요한지, 어디까지 포함하는지 적어 주세요."
          onChange={(description) => onChange({ description })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="분류" hint="예: 회원, 콘텐츠, 결제">
          <InlineText
            value={requirement.category}
            placeholder="분류"
            onChange={(category) => onChange({ category })}
          />
        </Field>
        <Field label="우선순위">
          <PrioritySelect
            value={requirement.priority}
            onChange={(priority) => onChange({ priority })}
          />
        </Field>
      </div>
      <div>
        <button className="btn btn-sm" onClick={onAddFeature}>
          <Plus size={13} />
          이 요구사항에 기능 추가
        </button>
      </div>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ */
/* 편집 패널 — 기능                                                      */
/* ------------------------------------------------------------------ */

function FeatureEditor({
  feature,
  requirements,
  placedPages,
  specCount,
  onChange,
  onAddSpec,
  onRemove,
}: {
  feature: Feature;
  requirements: Requirement[];
  placedPages: IaPage[];
  specCount: number;
  onChange: (patch: Partial<Feature>) => void;
  onAddSpec: () => void;
  onRemove: () => void;
}) {
  return (
    <PanelShell
      id={feature.id}
      title="기능"
      badge={<span className="chip">상세명세 {specCount}</span>}
      onRemove={onRemove}
      removeLabel="삭제"
    >
      <Field label="기능명">
        <InlineText
          value={feature.name}
          placeholder="예: 이메일 로그인"
          onChange={(name) => onChange({ name })}
        />
      </Field>
      <Field label="설명">
        <InlineText
          multiline
          rows={3}
          value={feature.description}
          placeholder="기능이 하는 일을 한두 문장으로 적어 주세요."
          onChange={(description) => onChange({ description })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="우선순위">
          <PrioritySelect value={feature.priority} onChange={(priority) => onChange({ priority })} />
        </Field>
        <Field label="상태">
          <StatusSelect value={feature.status} onChange={(status) => onChange({ status })} />
        </Field>
      </div>
      <Field label="상위 요구사항">
        <select
          className="select"
          value={feature.requirementId}
          onChange={(e) => onChange({ requirementId: e.target.value })}
        >
          {requirements.every((r) => r.id !== feature.requirementId) && (
            <option value={feature.requirementId}>{feature.requirementId} (삭제된 요구사항)</option>
          )}
          {requirements.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {r.title}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <span className="label">이 기능이 배치된 화면</span>
        {placedPages.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            아직 어느 화면에도 배치되지 않았습니다. 정보구조도에서 화면에 연결해 주세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {placedPages.map((page) => (
              <span key={page.id} className="chip chip-primary" title={page.path}>
                {page.id} · {page.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <button className="btn btn-sm" onClick={onAddSpec}>
          <Plus size={13} />
          이 기능에 상세명세 추가
        </button>
      </div>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ */
/* 편집 패널 — 상세 명세                                                 */
/* ------------------------------------------------------------------ */

function SpecificationEditor({
  spec,
  feature,
  pages,
  onChange,
  onRemove,
}: {
  spec: Specification;
  feature: Feature | undefined;
  pages: IaPage[];
  onChange: (patch: Partial<Specification>) => void;
  onRemove: () => void;
}) {
  const togglePage = (pageId: string) => {
    const next = spec.pageIds.includes(pageId)
      ? spec.pageIds.filter((id) => id !== pageId)
      : [...spec.pageIds, pageId];
    onChange({ pageIds: next });
  };

  return (
    <PanelShell
      id={spec.id}
      title="상세 명세"
      badge={
        feature ? (
          <span className="chip" title="상위 기능">
            {feature.id} · {feature.name}
          </span>
        ) : undefined
      }
      onRemove={onRemove}
      removeLabel="삭제"
    >
      <Field label="상세 기능명">
        <InlineText
          value={spec.title}
          placeholder="예: 이메일과 비밀번호로 로그인한다"
          onChange={(title) => onChange({ title })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="수행 주체" hint="이 동작을 하는 사람 또는 시스템">
          <InlineText
            value={spec.actor}
            placeholder="예: 일반 사용자"
            onChange={(actor) => onChange({ actor })}
          />
        </Field>
        <Field label="사전 조건">
          <InlineText
            value={spec.precondition}
            placeholder="예: 회원 가입이 완료된 상태"
            onChange={(precondition) => onChange({ precondition })}
          />
        </Field>
      </div>

      <Field label="기본 흐름" hint="번호 순서대로 실행됩니다.">
        <ListEditor
          items={spec.mainFlow}
          placeholder="예: 로그인 버튼을 누른다"
          addLabel="단계 추가"
          onChange={(mainFlow) => onChange({ mainFlow })}
        />
      </Field>
      <Field label="예외 처리" hint="실패·거절·타임아웃 등 정상 흐름에서 벗어나는 경우">
        <ListEditor
          items={spec.exceptions}
          placeholder="예: 비밀번호가 5회 틀리면 계정을 잠근다"
          addLabel="예외 추가"
          onChange={(exceptions) => onChange({ exceptions })}
        />
      </Field>
      <Field label="인수 조건" hint="QA 가 이 기준으로 검증합니다.">
        <ListEditor
          items={spec.acceptanceCriteria}
          placeholder="예: 올바른 정보 입력 시 3초 안에 홈으로 이동한다"
          addLabel="조건 추가"
          onChange={(acceptanceCriteria) => onChange({ acceptanceCriteria })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="우선순위">
          <PrioritySelect value={spec.priority} onChange={(priority) => onChange({ priority })} />
        </Field>
        <Field label="상태">
          <StatusSelect value={spec.status} onChange={(status) => onChange({ status })} />
        </Field>
      </div>

      <div>
        <span className="label">연결 화면</span>
        {pages.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            정보구조도를 먼저 만들면 화면을 연결할 수 있습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pages.map((page) => {
              const on = spec.pageIds.includes(page.id);
              return (
                <button
                  key={page.id}
                  className={`${on ? 'chip chip-primary' : 'chip'} cursor-pointer`}
                  onClick={() => togglePage(page.id)}
                  title={page.path}
                  aria-pressed={on}
                >
                  {on && <Check size={11} />}
                  {page.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PanelShell>
  );
}
