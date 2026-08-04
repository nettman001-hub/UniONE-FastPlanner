'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutGrid,
  Link2,
  ListTree,
  PanelTop,
  Plus,
  Rows3,
  Search,
  Settings2,
  Sparkles,
  Table2,
  Trash2,
} from 'lucide-react';
import { EmptyState, InlineText, Spinner, useConfirm } from '@/components/ui';
import { GeneratingState } from '@/components/GeneratingState';
import { NextStepButton } from '@/components/StepNav';
import { PlaceFeaturesModal, UnplacedChip } from '@/components/PlaceFeatures';
import { usePlannerStore } from '@/lib/store';
import { useGenerate } from '@/lib/useGenerate';
import { pageTree } from '@/lib/export';
import {
  IA_PAGE_TYPE_LABEL,
  type Feature,
  type IaPage,
  type IaPageType,
  type Requirement,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 상수 · 유틸                                                          */
/* ------------------------------------------------------------------ */

const PAGE_TYPES: IaPageType[] = ['page', 'modal', 'tab', 'section'];

type ViewMode = 'tree' | 'table' | 'sitemap';

function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order;
}

function TypeIcon({ type, size = 14 }: { type: IaPageType; size?: number }) {
  const common = { size, className: 'text-[var(--fg-subtle)]' } as const;
  if (type === 'modal') return <AppWindow {...common} />;
  if (type === 'tab') return <PanelTop {...common} />;
  if (type === 'section') return <Rows3 {...common} />;
  return <FileText {...common} />;
}

/** 부모를 따라 올라가며 조상 이름을 뿌리부터 순서대로 모은다. */
function ancestorNames(page: IaPage, byId: Map<string, IaPage>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: IaPage | undefined = page;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return names;
}

function ancestorIds(page: IaPage, byId: Map<string, IaPage>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>([page.id]);
  let cursor = page.parentId ? byId.get(page.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    ids.push(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* 페이지                                                               */
/* ------------------------------------------------------------------ */

export default function IaArchitecturePage() {
  const { id: planId } = useParams<{ id: string }>();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));

  const addIaPage = usePlannerStore((s) => s.addIaPage);
  const updateIaPage = usePlannerStore((s) => s.updateIaPage);
  const removeIaPage = usePlannerStore((s) => s.removeIaPage);
  const moveIaPage = usePlannerStore((s) => s.moveIaPage);

  const { generate, pending } = useGenerate(plan);
  const { confirm, dialog } = useConfirm();

  const [view, setView] = useState<ViewMode>('tree');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [openDetail, setOpenDetail] = useState<string[]>([]);
  const [unlinkedOpen, setUnlinkedOpen] = useState(false);

  const pages = useMemo(() => plan?.iaPages ?? [], [plan?.iaPages]);
  const features = useMemo(() => plan?.features ?? [], [plan?.features]);
  const requirements = useMemo(() => plan?.requirements ?? [], [plan?.requirements]);
  const roleNames = useMemo(
    () => (plan?.prd.roles ?? []).map((r) => r.name).filter((name) => name.trim() !== ''),
    [plan?.prd.roles],
  );

  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const tree = useMemo(() => pageTree(pages), [pages]);
  const featureById = useMemo(() => new Map(features.map((f) => [f.id, f])), [features]);

  /** 기능 ID → 그 기능이 배치된 화면 목록 */
  const featureOwners = useMemo(() => {
    const map = new Map<string, IaPage[]>();
    for (const page of pages) {
      for (const fid of page.featureIds) {
        const list = map.get(fid) ?? [];
        list.push(page);
        map.set(fid, list);
      }
    }
    return map;
  }, [pages]);

  const childCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const page of pages) {
      if (!page.parentId) continue;
      map.set(page.parentId, (map.get(page.parentId) ?? 0) + 1);
    }
    return map;
  }, [pages]);

  /** 요구사항별로 묶은 기능 목록 (요구사항이 사라진 기능은 마지막 그룹) */
  const featureGroups = useMemo(() => {
    const groups: { key: string; label: string; features: Feature[] }[] = [];
    for (const req of [...requirements].sort(byOrder)) {
      const list = features.filter((f) => f.requirementId === req.id).sort(byOrder);
      if (list.length > 0) groups.push({ key: req.id, label: `${req.id} · ${req.title}`, features: list });
    }
    const orphan = features
      .filter((f) => !requirements.some((r: Requirement) => r.id === f.requirementId))
      .sort(byOrder);
    if (orphan.length > 0) groups.push({ key: '__orphan', label: '분류 없는 기능', features: orphan });
    return groups;
  }, [requirements, features]);

  const linkedFeatureIds = useMemo(() => {
    const set = new Set<string>();
    for (const page of pages) for (const fid of page.featureIds) if (featureById.has(fid)) set.add(fid);
    return set;
  }, [pages, featureById]);

  const unlinkedFeatures = useMemo(
    () => features.filter((f) => !linkedFeatureIds.has(f.id)),
    [features, linkedFeatureIds],
  );

  const rootCount = pages.filter((p) => !p.parentId).length;
  const maxDepth = tree.reduce((max, row) => Math.max(max, row.depth + 1), 0);

  /* 검색 · 접기를 반영한 트리 행 --------------------------------------- */
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q !== '') {
      const keep = new Set<string>();
      for (const page of pages) {
        const hit = [page.id, page.name, page.path, page.description].some((part) =>
          part.toLowerCase().includes(q),
        );
        if (!hit) continue;
        keep.add(page.id);
        for (const ancestorId of ancestorIds(page, byId)) keep.add(ancestorId);
      }
      return tree.filter((row) => keep.has(row.page.id));
    }
    const hidden = new Set(collapsed);
    return tree.filter((row) => ancestorIds(row.page, byId).every((aid) => !hidden.has(aid)));
  }, [tree, pages, byId, query, collapsed]);

  const searching = query.trim() !== '';

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleDetail = (id: string) =>
    setOpenDetail((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /* 액션 ------------------------------------------------------------- */
  const canGenerate = features.length > 0;

  const handleGenerate = async () => {
    if (!plan || !canGenerate) return;
    if (plan.generated.ia || pages.length > 0) {
      const ok = await confirm({
        title: '정보구조도를 다시 생성할까요?',
        message:
          '지금까지 편집한 화면 구조와 기능 연결이 모두 새로 생성된 내용으로 덮어써집니다. 되돌릴 수 없습니다.',
        confirmLabel: '다시 생성',
        danger: true,
      });
      if (!ok) return;
    }
    await generate('ia');
  };

  const handleAdd = (parentId: string | null) => {
    if (!plan) return;
    const id = addIaPage(plan.id, parentId);
    if (parentId) setCollapsed((prev) => prev.filter((x) => x !== parentId));
    setOpenDetail((prev) => [...prev, id]);
  };

  const handleRemove = async (page: IaPage) => {
    if (!plan) return;
    const doomed = new Set<string>([page.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of pages) {
        if (candidate.parentId && doomed.has(candidate.parentId) && !doomed.has(candidate.id)) {
          doomed.add(candidate.id);
          changed = true;
        }
      }
    }
    const descendants = doomed.size - 1;
    const ok = await confirm({
      title: `${page.id} ${page.name} 화면을 삭제할까요?`,
      message:
        descendants > 0
          ? `하위 화면 ${descendants}개도 함께 삭제됩니다. 이 화면들에 연결된 와이어프레임과 플로우 연결도 함께 정리됩니다. 되돌릴 수 없습니다.`
          : '이 화면에 연결된 와이어프레임과 플로우 연결도 함께 정리됩니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeIaPage(plan.id, page.id);
    setOpenDetail((prev) => prev.filter((x) => x !== page.id));
  };

  if (!plan) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;
  }

  const generating = pending === 'ia';

  const generateButton = (
    <button
      className={`btn btn-primary btn-sm${generating ? ' is-busy' : ''}`}
      disabled={pending !== null || !canGenerate}
      title={canGenerate ? undefined : '기능명세서를 먼저 만들어야 합니다.'}
      onClick={() => void handleGenerate()}
    >
      {generating ? <Spinner size={13} /> : <Sparkles size={13} />}
      {generating ? '생성중' : plan.generated.ia ? '다시 생성' : 'AI로 생성'}
    </button>
  );

  /* ---------------------------------------------------------------- */
  /* 미생성 상태                                                       */
  /* ---------------------------------------------------------------- */
  if (pages.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {dialog}
        <header className="mb-4">
          <h1 className="text-[19px] font-extrabold tracking-tight">정보구조도 (IA)</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            서비스의 모든 화면을 계층 구조로 정리하고, 각 화면에서 어떤 기능이 쓰이는지 연결합니다.
          </p>
        </header>
        <div className="card">
          {pending === 'ia' ? (
            <GeneratingState artifact="ia" />
          ) : (
            <EmptyState
              icon={<ListTree size={26} />}
              title="아직 정보구조도가 없습니다"
              description={
                canGenerate
                  ? '기능명세서를 기준으로 화면 계층과 기능 배치를 한 번에 만들어 드립니다. 직접 화면을 추가해 처음부터 작성할 수도 있습니다.'
                  : '기능명세서가 없어 AI 생성을 할 수 없습니다. 기능명세서를 먼저 만들거나, 화면을 직접 추가해 주세요.'
              }
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {generateButton}
                  <button className="btn btn-sm" onClick={() => handleAdd(null)}>
                    <Plus size={13} />
                    직접 추가
                  </button>
                </div>
              }
            />
          )}
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 본 화면                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className={`mx-auto w-full ${view === 'tree' ? 'max-w-5xl' : 'max-w-6xl'} p-4 sm:p-6`}>
      {dialog}

      {/* 상단 툴바 */}
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[19px] font-extrabold tracking-tight">정보구조도 (IA)</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip">전체 화면 {pages.length}</span>
              <span className="chip">1depth {rootCount}</span>
              <span className="chip">최대 depth {maxDepth}</span>
              <span
                className={
                  features.length > 0 && linkedFeatureIds.size === features.length
                    ? 'chip chip-ok'
                    : 'chip chip-primary'
                }
                title="화면에 배치된 기능 수 / 전체 기능 수"
              >
                <Link2 size={11} />
                연결된 기능 {linkedFeatureIds.size}/{features.length}
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
                <Table2 size={13} />
                <span>표</span>
              </button>
              <button
                className={`btn btn-sm rounded-none border-0 ${view === 'sitemap' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setView('sitemap')}
              >
                <LayoutGrid size={13} />
                사이트맵
              </button>
            </div>
            {generateButton}
            <NextStepButton planId={planId} current="ia" />
          </div>
        </div>

        {!canGenerate && (
          <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">
            기능명세서가 없어 AI 생성을 사용할 수 없습니다. 기능명세서를 먼저 만들어 주세요.
          </p>
        )}

        {/* 검색 */}
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]"
          />
          <input
            className="input pl-8"
            value={query}
            placeholder="화면명 · 경로 · 설명 검색"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* 미연결 기능 — 누르면 배치 창이 열린다 */}
        <UnplacedChip count={unlinkedFeatures.length} onClick={() => setUnlinkedOpen(true)} />
      </header>

      {view === 'tree' && (
        <TreeView
          rows={visibleRows}
          pages={pages}
          collapsed={collapsed}
          searching={searching}
          openDetail={openDetail}
          childCount={childCount}
          featureById={featureById}
          featureOwners={featureOwners}
          featureGroups={featureGroups}
          roleNames={roleNames}
          onToggleCollapse={toggleCollapse}
          onToggleDetail={toggleDetail}
          onChange={(id, patch) => updateIaPage(plan.id, id, patch)}
          onAddChild={(parentId) => handleAdd(parentId)}
          onMove={(id, direction) => moveIaPage(plan.id, id, direction)}
          onRemove={(page) => void handleRemove(page)}
          onAddRoot={() => handleAdd(null)}
        />
      )}

      {view === 'table' && (
        <TableView rows={visibleRows} byId={byId} featureById={featureById} />
      )}

      {view === 'sitemap' && <SitemapView rows={visibleRows} featureById={featureById} />}

      {/* 미연결 기능 배치 */}
      <PlaceFeaturesModal open={unlinkedOpen} plan={plan} onClose={() => setUnlinkedOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 트리 보기                                                            */
/* ------------------------------------------------------------------ */

interface FeatureGroup {
  key: string;
  label: string;
  features: Feature[];
}

function TreeView({
  rows,
  pages,
  collapsed,
  searching,
  openDetail,
  childCount,
  featureById,
  featureOwners,
  featureGroups,
  roleNames,
  onToggleCollapse,
  onToggleDetail,
  onChange,
  onAddChild,
  onMove,
  onRemove,
  onAddRoot,
}: {
  rows: { page: IaPage; depth: number }[];
  pages: IaPage[];
  collapsed: string[];
  searching: boolean;
  openDetail: string[];
  childCount: Map<string, number>;
  featureById: Map<string, Feature>;
  featureOwners: Map<string, IaPage[]>;
  featureGroups: FeatureGroup[];
  roleNames: string[];
  onToggleCollapse: (id: string) => void;
  onToggleDetail: (id: string) => void;
  onChange: (id: string, patch: Partial<IaPage>) => void;
  onAddChild: (parentId: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (page: IaPage) => void;
  onAddRoot: () => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <h2 className="section-title">화면 계층</h2>
        <button className="btn btn-sm" onClick={onAddRoot}>
          <Plus size={13} />
          1depth 페이지 추가
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-[var(--fg-muted)]">
          검색 조건에 맞는 화면이 없습니다.
        </p>
      ) : (
        <ul>
          {rows.map(({ page, depth }) => {
            const children = childCount.get(page.id) ?? 0;
            const isCollapsed = !searching && collapsed.includes(page.id);
            const detailOpen = openDetail.includes(page.id);
            const siblings = pages
              .filter((p) => p.parentId === page.parentId)
              .sort((a, b) => a.order - b.order);
            const index = siblings.findIndex((p) => p.id === page.id);
            const linked = page.featureIds.filter((fid) => featureById.has(fid));

            return (
              <li key={page.id} className="border-b border-[var(--border)] last:border-b-0">
                <div className="px-2 py-2 hover:bg-[var(--surface-2)]">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                    {/* 들여쓰기 + 이름 */}
                    <div className="flex min-w-0 basis-full items-center gap-1 sm:flex-1 sm:basis-auto">
                      {Array.from({ length: depth }).map((_, i) => (
                        <span
                          key={i}
                          className="ml-1.5 h-6 w-2.5 shrink-0 border-l border-[var(--border-strong)]"
                          aria-hidden
                        />
                      ))}
                      {children > 0 ? (
                        <button
                          className="btn btn-ghost btn-sm shrink-0 px-1"
                          onClick={() => onToggleCollapse(page.id)}
                          aria-label={isCollapsed ? '펼치기' : '접기'}
                        >
                          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        </button>
                      ) : (
                        <span className="w-[22px] shrink-0" aria-hidden />
                      )}
                      <span className="shrink-0">
                        <TypeIcon type={page.type} />
                      </span>
                      <span className="id-tag shrink-0">{page.id}</span>
                      <div className="min-w-0 flex-1">
                        <InlineText
                          className="py-1 text-[13px] font-semibold"
                          value={page.name}
                          placeholder="화면명"
                          onChange={(name) => onChange(page.id, { name })}
                        />
                      </div>
                    </div>

                    {/* 경로 · 유형 · 요약 */}
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <div className="w-32 shrink-0 sm:w-40">
                        <InlineText
                          className="mono py-1 text-[12px]"
                          value={page.path}
                          placeholder="/path"
                          onChange={(path) => onChange(page.id, { path })}
                        />
                      </div>
                      <select
                        className="select shrink-0"
                        style={{ width: 'auto', padding: '4px 6px', fontSize: 12 }}
                        value={page.type}
                        aria-label="페이지 유형"
                        onChange={(e) => onChange(page.id, { type: e.target.value as IaPageType })}
                      >
                        {PAGE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {IA_PAGE_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                      <span
                        className={linked.length > 0 ? 'chip chip-primary' : 'chip'}
                        title="연결된 기능 수"
                      >
                        <Link2 size={11} />
                        {linked.length}
                      </span>
                      {page.roles.slice(0, 2).map((role) => (
                        <span key={role} className="chip" title="접근 역할">
                          {role}
                        </span>
                      ))}
                      {page.roles.length > 2 && (
                        <span className="chip" title={page.roles.join(', ')}>
                          +{page.roles.length - 2}
                        </span>
                      )}
                    </div>

                    {/* 액션 */}
                    <div className="ml-auto flex shrink-0 items-center gap-0.5">
                      <button
                        className="btn btn-ghost btn-sm px-1.5"
                        onClick={() => onAddChild(page.id)}
                        title="하위 페이지 추가"
                        aria-label={`${page.name} 하위 페이지 추가`}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm px-1.5"
                        disabled={index <= 0}
                        onClick={() => onMove(page.id, -1)}
                        title="위로"
                        aria-label={`${page.name} 위로 이동`}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm px-1.5"
                        disabled={index < 0 || index >= siblings.length - 1}
                        onClick={() => onMove(page.id, 1)}
                        title="아래로"
                        aria-label={`${page.name} 아래로 이동`}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className={`btn btn-sm px-1.5 ${detailOpen ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => onToggleDetail(page.id)}
                        title="상세"
                        aria-expanded={detailOpen}
                      >
                        <Settings2 size={13} />
                      </button>
                      <button
                        className="btn btn-danger btn-sm px-1.5"
                        onClick={() => onRemove(page)}
                        title="삭제"
                        aria-label={`${page.name} 삭제`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {detailOpen && (
                  <PageDetail
                    page={page}
                    roleNames={roleNames}
                    featureGroups={featureGroups}
                    featureOwners={featureOwners}
                    onChange={(patch) => onChange(page.id, patch)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 상세 패널                                                            */
/* ------------------------------------------------------------------ */

function PageDetail({
  page,
  roleNames,
  featureGroups,
  featureOwners,
  onChange,
}: {
  page: IaPage;
  roleNames: string[];
  featureGroups: FeatureGroup[];
  featureOwners: Map<string, IaPage[]>;
  onChange: (patch: Partial<IaPage>) => void;
}) {
  const [featureQuery, setFeatureQuery] = useState('');

  const toggleRole = (role: string) => {
    const next = page.roles.includes(role)
      ? page.roles.filter((r) => r !== role)
      : [...page.roles, role];
    onChange({ roles: next });
  };

  const toggleFeature = (featureId: string) => {
    const next = page.featureIds.includes(featureId)
      ? page.featureIds.filter((id) => id !== featureId)
      : [...page.featureIds, featureId];
    onChange({ featureIds: next });
  };

  const q = featureQuery.trim().toLowerCase();
  const groups = featureGroups
    .map((group) => ({
      ...group,
      features:
        q === ''
          ? group.features
          : group.features.filter((f) =>
              [f.id, f.name, f.description].some((part) => part.toLowerCase().includes(q)) ||
              group.label.toLowerCase().includes(q),
            ),
    }))
    .filter((group) => group.features.length > 0);

  return (
    <div className="flex flex-col gap-4 border-t border-[var(--border)] bg-[var(--surface-2)] px-3 py-3.5 sm:px-4">
      <div>
        <span className="label">설명</span>
        <InlineText
          multiline
          rows={3}
          value={page.description}
          placeholder="이 화면에서 사용자가 무엇을 하는지 적어 주세요."
          onChange={(description) => onChange({ description })}
        />
      </div>

      <div>
        <span className="label">접근 역할</span>
        {roleNames.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            PRD에 사용자 역할이 없습니다. PRD에서 역할을 먼저 정의해 주세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {roleNames.map((role) => {
              const on = page.roles.includes(role);
              return (
                <button
                  key={role}
                  className={`${on ? 'chip chip-primary' : 'chip'} cursor-pointer`}
                  aria-pressed={on}
                  onClick={() => toggleRole(role)}
                >
                  {on && <Check size={11} />}
                  {role}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="label mb-0">상세 기능 연결</span>
          <span className="chip">{page.featureIds.length}개 연결됨</span>
        </div>

        {featureGroups.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            연결할 기능이 없습니다. 기능명세서를 먼저 만들어 주세요.
          </p>
        ) : (
          <>
            <div className="relative mb-2">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]"
              />
              <input
                className="input py-1.5 pl-8 text-[12.5px]"
                value={featureQuery}
                placeholder="기능 검색"
                onChange={(e) => setFeatureQuery(e.target.value)}
              />
            </div>

            {groups.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-[var(--fg-muted)]">
                검색 조건에 맞는 기능이 없습니다.
              </p>
            ) : (
              <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                {groups.map((group) => (
                  <div key={group.key}>
                    <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-muted)]">
                      {group.label}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {group.features.map((feature) => {
                        const on = page.featureIds.includes(feature.id);
                        const others = (featureOwners.get(feature.id) ?? []).filter(
                          (p) => p.id !== page.id,
                        );
                        return (
                          <li key={feature.id}>
                            <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--surface-2)]">
                              <input
                                type="checkbox"
                                className="mt-0.5 shrink-0 accent-[var(--primary)]"
                                checked={on}
                                onChange={() => toggleFeature(feature.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="id-tag">{feature.id}</span>
                                  <span className="text-[12.5px] font-semibold">{feature.name}</span>
                                </span>
                                {others.length > 0 && (
                                  <span className="mt-0.5 block text-[11px] text-[var(--fg-subtle)]">
                                    이미 배치: {others.map((p) => p.name).join(', ')}
                                  </span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 표 보기                                                              */
/* ------------------------------------------------------------------ */

function TableView({
  rows,
  byId,
  featureById,
}: {
  rows: { page: IaPage; depth: number }[];
  byId: Map<string, IaPage>;
  featureById: Map<string, Feature>;
}) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="px-4 py-10 text-center text-[12.5px] text-[var(--fg-muted)]">
          검색 조건에 맞는 화면이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>페이지ID</th>
            <th>Depth</th>
            <th>1depth</th>
            <th>2depth</th>
            <th>3depth</th>
            <th>경로</th>
            <th>유형</th>
            <th>접근 역할</th>
            <th>연결 기능</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ page, depth }) => {
            const names = ancestorNames(page, byId);
            const linked = page.featureIds
              .map((fid) => featureById.get(fid))
              .filter((f): f is Feature => Boolean(f));
            return (
              <tr key={page.id}>
                <td className="id-tag whitespace-nowrap">{page.id}</td>
                <td className="tabular-nums">{depth + 1}</td>
                <td className={depth === 0 ? 'font-semibold' : ''}>{names[0] ?? ''}</td>
                <td className={depth === 1 ? 'font-semibold' : ''}>{names[1] ?? ''}</td>
                <td className={depth >= 2 ? 'font-semibold' : ''}>{names[2] ?? ''}</td>
                <td className="mono whitespace-nowrap text-[12px] text-[var(--fg-muted)]">
                  {page.path}
                </td>
                <td className="whitespace-nowrap text-[12px]">{IA_PAGE_TYPE_LABEL[page.type]}</td>
                <td className="text-[12px] text-[var(--fg-muted)]">
                  {page.roles.join(', ') || '전체'}
                </td>
                <td className="min-w-40">
                  {linked.length === 0 ? (
                    <span className="text-[12px] text-[var(--fg-subtle)]">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {linked.map((f) => (
                        <span key={f.id} className="chip" title={f.name}>
                          {f.id}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="min-w-40 text-[12px] text-[var(--fg-muted)]">{page.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 사이트맵 보기                                                        */
/* ------------------------------------------------------------------ */

function SitemapView({
  rows,
  featureById,
}: {
  rows: { page: IaPage; depth: number }[];
  featureById: Map<string, Feature>;
}) {
  // 1depth 를 컬럼으로, 그 아래 하위 화면을 순서대로 카드로 쌓는다.
  const columns: { root: { page: IaPage; depth: number }; items: { page: IaPage; depth: number }[] }[] =
    [];
  for (const row of rows) {
    if (row.depth === 0) {
      columns.push({ root: row, items: [] });
    } else if (columns.length > 0) {
      columns[columns.length - 1].items.push(row);
    }
  }

  if (columns.length === 0) {
    return (
      <div className="card">
        <p className="px-4 py-10 text-center text-[12.5px] text-[var(--fg-muted)]">
          표시할 1depth 화면이 없습니다.
        </p>
      </div>
    );
  }

  const linkedCount = (page: IaPage) =>
    page.featureIds.filter((fid) => featureById.has(fid)).length;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {columns.map(({ root, items }) => (
        <section key={root.page.id} className="card flex flex-col overflow-hidden">
          <header className="border-b border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeIcon type={root.page.type} size={13} />
              <span className="id-tag">{root.page.id}</span>
              <h3 className="section-title text-[var(--primary)]">{root.page.name}</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5">
              <span className="mono text-[11.5px] text-[var(--fg-muted)]">{root.page.path}</span>
              <span className="chip chip-primary">
                <Link2 size={11} />
                {linkedCount(root.page)}
              </span>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-1.5 p-2.5">
            {items.length === 0 ? (
              <p className="px-1 py-4 text-center text-[12px] text-[var(--fg-subtle)]">
                하위 화면 없음
              </p>
            ) : (
              items.map(({ page, depth }) => (
                <div
                  key={page.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2"
                  style={{ marginLeft: (depth - 1) * 12 }}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TypeIcon type={page.type} size={12} />
                    <span className="id-tag">{page.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                      {page.name}
                    </span>
                    <span className={linkedCount(page) > 0 ? 'chip chip-primary' : 'chip'}>
                      <Link2 size={10} />
                      {linkedCount(page)}
                    </span>
                  </div>
                  <p className="mono mt-0.5 truncate text-[11px] text-[var(--fg-muted)]">
                    {page.path}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
