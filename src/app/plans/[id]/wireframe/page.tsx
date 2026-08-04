'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Monitor,
  MonitorSmartphone,
  Plus,
  Printer,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  EmptyState,
  InlineText,
  ListEditor,
  Modal,
  RegenerateTag,
  Spinner,
  useConfirm,
} from '@/components/ui';
import { WireframeView } from '@/components/WireframeView';
import { GeneratingState } from '@/components/GeneratingState';
import { NextStepButton } from '@/components/StepNav';
import { IssueBar } from '@/components/IssueBar';
import { usePlannerStore } from '@/lib/store';
import { hasArtifact } from '@/lib/artifact-status';
import { useGenerate } from '@/lib/useGenerate';
import { validatePlan } from '@/lib/validate';
import { pageTree } from '@/lib/export';
import { stalePages, type StalePage } from '@/lib/ia/wireframe-sync';
import { uid } from '@/lib/ids';
import {
  WIREFRAME_BLOCK_LABEL,
  type IaPage,
  type Wireframe,
  type WireframeBlock,
  type WireframeBlockType,
} from '@/lib/types';

const BLOCK_TYPES = Object.keys(WIREFRAME_BLOCK_LABEL) as WireframeBlockType[];

/** AI 생성 시 한 번에 권장하는 최대 화면 수 */
const RECOMMENDED_MAX = 10;

export default function WireframePage() {
  const { id: planId } = useParams<{ id: string }>();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));

  const addWireframe = usePlannerStore((s) => s.addWireframe);
  const updateWireframe = usePlannerStore((s) => s.updateWireframe);
  const removeWireframe = usePlannerStore((s) => s.removeWireframe);

  const { generate, pending } = useGenerate(plan);
  const { confirm, dialog } = useConfirm();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [checkedPageIds, setCheckedPageIds] = useState<string[]>([]);
  const [newPageId, setNewPageId] = useState('');
  const [newBlockType, setNewBlockType] = useState<WireframeBlockType>('header');

  const iaPages = useMemo(() => plan?.iaPages ?? [], [plan?.iaPages]);
  const wireframes = useMemo(
    () => [...(plan?.wireframes ?? [])].sort((a, b) => a.order - b.order),
    [plan?.wireframes],
  );
  const pageRows = useMemo(() => pageTree(iaPages), [iaPages]);
  const pageById = useMemo(() => new Map(iaPages.map((p) => [p.id, p])), [iaPages]);
  const wireframePageIds = useMemo(() => new Set(wireframes.map((w) => w.pageId)), [wireframes]);

  const current = useMemo(
    () => wireframes.find((w) => w.id === selectedId) ?? wireframes[0],
    [wireframes, selectedId],
  );

  /** 선택된 화면이 사라지면 첫 화면으로 되돌린다. */
  useEffect(() => {
    if (current && current.id !== selectedId) setSelectedId(current.id);
    if (!current && selectedId !== null) setSelectedId(null);
  }, [current, selectedId]);

  /** 빈 화면 추가용 기본 선택값 */
  useEffect(() => {
    if (newPageId && pageById.has(newPageId)) return;
    const candidate = pageRows.find(({ page }) => !wireframePageIds.has(page.id)) ?? pageRows[0];
    setNewPageId(candidate?.page.id ?? '');
  }, [pageRows, pageById, wireframePageIds, newPageId]);

  /** 이 화면에서 고칠 수 있는 지적만. */
  const wfIssues = useMemo(
    () => (plan ? validatePlan(plan).filter((i) => i.artifact === 'wireframe') : []),
    [plan],
  );

  if (!plan) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;
  }

  const canGenerate = iaPages.length > 0;
  const generating = pending === 'wireframe';

  /**
   * 화면에 기능이 더 붙었는데 그림은 그대로인 화면들.
   * 정보구조도에서 기능을 배치한 뒤 여기가 뒤처지면 개발팀은
   * "기능명세서에는 있는데 화면에는 없는 것" 을 받게 된다.
   */
  const stale = stalePages(plan);

  /* 액션 -------------------------------------------------------------- */

  const openGenerateModal = () => {
    const missing = pageRows.filter(({ page }) => !wireframePageIds.has(page.id)).map((r) => r.page.id);
    setCheckedPageIds(missing.length > 0 ? missing.slice(0, RECOMMENDED_MAX) : pageRows.slice(0, RECOMMENDED_MAX).map((r) => r.page.id));
    setGenOpen(true);
  };

  /** 뒤처진 화면만 골라 생성 창을 연다. */
  const openStaleModal = () => {
    setCheckedPageIds(stale.map((s2) => s2.page.id).slice(0, RECOMMENDED_MAX));
    setGenOpen(true);
  };

  const runGenerate = async () => {
    if (checkedPageIds.length === 0) return;
    setGenOpen(false);
    const overwrite = checkedPageIds.filter((pid) => wireframePageIds.has(pid));
    if (overwrite.length > 0) {
      const ok = await confirm({
        title: `이미 만든 화면 ${overwrite.length}개를 다시 생성할까요?`,
        message:
          '선택한 화면의 기존 블록 구성은 새로 생성된 내용으로 덮어써집니다. 선택하지 않은 화면은 그대로 유지됩니다. 되돌릴 수 없습니다.',
        confirmLabel: '다시 생성',
        danger: true,
      });
      if (!ok) return;
    }
    await generate('wireframe', { pageIds: checkedPageIds, merge: true });
  };

  const handleAddBlank = () => {
    if (!newPageId) return;
    const id = addWireframe(plan.id, newPageId);
    setSelectedId(id);
    setSelectedBlockId(null);
  };

  const handleRemoveWireframe = async (wireframe: Wireframe) => {
    const ok = await confirm({
      title: `${wireframe.id} ${wireframe.name} 화면을 삭제할까요?`,
      message: '이 와이어프레임의 블록 구성이 모두 사라집니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    removeWireframe(plan.id, wireframe.id);
    setSelectedBlockId(null);
  };

  const setBlocks = (blocks: WireframeBlock[]) => {
    if (!current) return;
    updateWireframe(plan.id, current.id, { blocks });
  };

  const patchBlock = (blockId: string, patch: Partial<WireframeBlock>) => {
    if (!current) return;
    setBlocks(current.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    if (!current) return;
    const next = [...current.blocks];
    const target = next[index + direction];
    if (!target) return;
    next[index + direction] = next[index];
    next[index] = target;
    setBlocks(next);
  };

  const handleRemoveBlock = async (block: WireframeBlock) => {
    if (!current) return;
    const ok = await confirm({
      title: `${WIREFRAME_BLOCK_LABEL[block.type]} 블록을 삭제할까요?`,
      message: '블록에 적은 제목·구성 항목·메모가 함께 사라집니다. 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    setBlocks(current.blocks.filter((b) => b.id !== block.id));
    if (selectedBlockId === block.id) setSelectedBlockId(null);
  };

  const handleAddBlock = () => {
    if (!current) return;
    const block: WireframeBlock = {
      id: uid('blk'),
      type: newBlockType,
      title: WIREFRAME_BLOCK_LABEL[newBlockType],
      items: [],
    };
    setBlocks([...current.blocks, block]);
    setSelectedBlockId(block.id);
  };

  /* 공통 조각 --------------------------------------------------------- */

  const generateButton = (
    <button
      className={`btn btn-primary btn-sm${generating ? ' is-busy' : ''}`}
      disabled={pending !== null || !canGenerate}
      title={canGenerate ? undefined : '정보구조도를 먼저 만들어야 합니다.'}
      onClick={openGenerateModal}
    >
      {generating ? <Spinner size={13} /> : <Sparkles size={13} />}
      {generating ? '생성중' : hasArtifact(plan, 'wireframe') ? '다시 생성' : 'AI로 생성'}
    </button>
  );

  const addBlankControl = (
    <div className="flex items-center gap-1.5">
      <select
        className="select min-w-0 flex-1"
        style={{ padding: '5px 8px', fontSize: 12 }}
        value={newPageId}
        aria-label="와이어프레임을 추가할 화면"
        onChange={(e) => setNewPageId(e.target.value)}
      >
        {pageRows.map(({ page, depth }) => (
          <option key={page.id} value={page.id}>
            {`${'— '.repeat(depth)}${page.name} (${page.path})`}
          </option>
        ))}
      </select>
      <button className="btn btn-sm shrink-0" disabled={!newPageId} onClick={handleAddBlank}>
        <Plus size={13} />
        빈 화면
      </button>
    </div>
  );

  const generateModal = (
    <Modal
      open={genOpen}
      title="와이어프레임을 그릴 화면 선택"
      description={`정보구조도의 화면 중 그릴 대상을 고르세요. 한 번에 ${RECOMMENDED_MAX}개 이하를 권장합니다.`}
      onClose={() => setGenOpen(false)}
      width={560}
      footer={
        <>
          <button className="btn" onClick={() => setGenOpen(false)}>
            취소
          </button>
          <button
            className="btn btn-primary"
            disabled={checkedPageIds.length === 0}
            onClick={() => void runGenerate()}
          >
            <Sparkles size={14} />
            {checkedPageIds.length}개 화면 생성
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-[var(--fg-muted)]">
            선택 {checkedPageIds.length} / 전체 {pageRows.length}
          </span>
          <span className="flex gap-1.5">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setCheckedPageIds(pageRows.map((r) => r.page.id))}
            >
              전체 선택
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCheckedPageIds([])}>
              전체 해제
            </button>
          </span>
        </div>

        {checkedPageIds.length > RECOMMENDED_MAX && (
          <p className="chip chip-warn h-auto whitespace-normal py-1 text-left leading-relaxed">
            {RECOMMENDED_MAX}개를 넘으면 생성이 오래 걸리고 품질이 떨어질 수 있습니다.
          </p>
        )}

        <ul className="flex max-h-[46vh] flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
          {pageRows.map(({ page, depth }) => {
            const on = checkedPageIds.includes(page.id);
            const has = wireframePageIds.has(page.id);
            return (
              <li key={page.id} style={{ paddingLeft: depth * 14 }}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--surface)]">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 accent-[var(--primary)]"
                    checked={on}
                    onChange={() =>
                      setCheckedPageIds((prev) =>
                        prev.includes(page.id)
                          ? prev.filter((x) => x !== page.id)
                          : [...prev, page.id],
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="id-tag">{page.id}</span>
                      <span className="text-[12.5px] font-semibold">{page.name}</span>
                      {has && <span className="chip chip-warn">기존 화면 덮어씀</span>}
                    </span>
                    <span className="mono mt-0.5 block truncate text-[11px] text-[var(--fg-subtle)]">
                      {page.path}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );

  /* ---------------------------------------------------------------- */
  /* 미생성 상태                                                       */
  /* ---------------------------------------------------------------- */
  if (wireframes.length === 0 || !current) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {dialog}
        {generateModal}
        <header className="mb-4">
          <h1 className="text-[19px] font-extrabold tracking-tight">와이어프레임</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            정보구조도의 화면마다 어떤 요소가 어떤 순서로 놓이는지 저해상도 목업으로 정리합니다.
          </p>
        </header>
        <div className="card">
          {pending === 'wireframe' ? (
            <GeneratingState artifact="wireframe" />
          ) : (
            <EmptyState
              icon={<MonitorSmartphone size={26} />}
              title="아직 와이어프레임이 없습니다"
              description={
                canGenerate
                  ? '정보구조도의 화면을 골라 블록 구성을 한 번에 만들어 드립니다. 빈 화면을 추가해 직접 그릴 수도 있습니다.'
                  : '정보구조도가 없어 와이어프레임을 만들 수 없습니다. 정보구조도를 먼저 만들어 주세요.'
              }
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {generateButton}
                  {canGenerate && addBlankControl}
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
  const currentPage: IaPage | undefined = pageById.get(current.pageId);

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      {dialog}
      {generateModal}

      {/* 상단 툴바 */}
      <header className="no-print mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[19px] font-extrabold tracking-tight">와이어프레임</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="chip">화면 {wireframes.length}개</span>
            <span className="chip">블록 {current.blocks.length}개</span>
            <span className="chip">
              화면 미작성 {Math.max(0, iaPages.length - wireframePageIds.size)}개
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {generateButton}
          <NextStepButton planId={planId} current="wireframe" />
        </div>
      </header>

      {!canGenerate && (
        <p className="no-print mb-3 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          정보구조도가 없어 AI 생성을 사용할 수 없습니다. 정보구조도를 먼저 만들어 주세요.
        </p>
      )}

      <StaleBanner stale={stale} onFix={openStaleModal} disabled={pending !== null} />

      <IssueBar planId={planId} artifact="wireframe" issues={wfIssues} />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_330px]">
        {/* 좌측 · 화면 목록 */}
        <aside className="no-print card flex flex-col overflow-hidden lg:max-h-[76vh]">
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <h2 className="section-title">화면 목록</h2>
          </div>
          <ul className="flex-1 overflow-y-auto p-1.5">
            {wireframes.map((wireframe) => {
              const page = pageById.get(wireframe.pageId);
              const active = wireframe.id === current.id;
              return (
                <li key={wireframe.id}>
                  <button
                    className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition ${
                      active
                        ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                        : 'hover:bg-[var(--surface-2)]'
                    }`}
                    onClick={() => {
                      setSelectedId(wireframe.id);
                      setSelectedBlockId(null);
                    }}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      {wireframe.device === 'mobile' ? (
                        <Smartphone size={12} className="shrink-0" />
                      ) : (
                        <Monitor size={12} className="shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {page?.name ?? wireframe.name}
                      </span>
                    </span>
                    <span className="flex w-full items-center gap-1.5">
                      <span className="mono min-w-0 flex-1 truncate text-[11px] text-[var(--fg-subtle)]">
                        {page?.path ?? '연결된 화면 없음'}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-[var(--fg-subtle)]">
                        블록 {wireframe.blocks.length}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--border)] p-2">{addBlankControl}</div>
        </aside>

        {/* 중앙 · 미리보기 */}
        <section className="min-w-0">
          <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="id-tag">{current.id}</span>
              <h2 className="truncate text-[14px] font-extrabold tracking-tight">
                {currentPage?.name ?? current.name}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="flex overflow-hidden rounded-lg border border-[var(--border-strong)]">
                <button
                  className={`btn btn-sm rounded-none border-0 ${
                    current.device === 'mobile' ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => updateWireframe(plan.id, current.id, { device: 'mobile' })}
                >
                  <Smartphone size={13} />
                  모바일
                </button>
                <button
                  className={`btn btn-sm rounded-none border-0 ${
                    current.device === 'desktop' ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => updateWireframe(plan.id, current.id, { device: 'desktop' })}
                >
                  <Monitor size={13} />
                  데스크톱
                </button>
              </div>
              <button className="btn btn-sm" onClick={() => window.print()}>
                <Printer size={13} />
                인쇄/PDF
              </button>
              <button
                className="btn btn-danger btn-sm px-1.5"
                title="이 화면 삭제"
                aria-label={`${current.name} 화면 삭제`}
                onClick={() => void handleRemoveWireframe(current)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          <WireframeView
            wireframe={current}
            page={currentPage}
            selectedBlockId={selectedBlockId}
            onSelectBlock={(blockId) =>
              setSelectedBlockId((prev) => (prev === blockId ? null : blockId))
            }
          />
        </section>

        {/* 우측 · 블록 편집기 */}
        <aside className="no-print min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card flex flex-col overflow-hidden xl:max-h-[76vh]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <h2 className="section-title">블록 편집</h2>
              <span className="chip">{current.blocks.length}개</span>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
              {current.blocks.length === 0 ? (
                <p className="px-2 py-8 text-center text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                  블록이 없습니다. 아래에서 유형을 골라 추가해 주세요.
                </p>
              ) : (
                current.blocks.map((block, index) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    index={index}
                    total={current.blocks.length}
                    selected={selectedBlockId === block.id}
                    onSelect={() =>
                      setSelectedBlockId((prev) => (prev === block.id ? null : block.id))
                    }
                    onChange={(patch) => patchBlock(block.id, patch)}
                    onMove={(direction) => moveBlock(index, direction)}
                    onRemove={() => void handleRemoveBlock(block)}
                  />
                ))
              )}
            </div>

            <div className="flex items-center gap-1.5 border-t border-[var(--border)] p-2">
              <select
                className="select min-w-0 flex-1"
                style={{ padding: '5px 8px', fontSize: 12 }}
                value={newBlockType}
                aria-label="추가할 블록 유형"
                onChange={(e) => setNewBlockType(e.target.value as WireframeBlockType)}
              >
                {BLOCK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {WIREFRAME_BLOCK_LABEL[type]}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm shrink-0" onClick={handleAddBlock}>
                <Plus size={13} />
                블록 추가
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 블록 편집 카드                                                       */
/* ------------------------------------------------------------------ */

function BlockCard({
  block,
  index,
  total,
  selected,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  block: WireframeBlock;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<WireframeBlock>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2"
      style={selected ? { outline: '2px solid var(--primary)', outlineOffset: -1 } : undefined}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1">
        <span className="w-5 shrink-0 text-center text-[11px] font-bold text-[var(--fg-subtle)]">
          {index + 1}
        </span>
        <select
          className="select min-w-0 flex-1"
          style={{ padding: '4px 6px', fontSize: 12 }}
          value={block.type}
          aria-label={`${index + 1}번 블록 유형`}
          onChange={(e) => onChange({ type: e.target.value as WireframeBlockType })}
        >
          {BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {WIREFRAME_BLOCK_LABEL[type]}
            </option>
          ))}
        </select>
        <button
          className="btn btn-ghost btn-sm shrink-0 px-1"
          disabled={index === 0}
          title="위로"
          aria-label={`${index + 1}번 블록 위로 이동`}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          className="btn btn-ghost btn-sm shrink-0 px-1"
          disabled={index >= total - 1}
          title="아래로"
          aria-label={`${index + 1}번 블록 아래로 이동`}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={13} />
        </button>
        <button
          className="btn btn-danger btn-sm shrink-0 px-1"
          title="삭제"
          aria-label={`${index + 1}번 블록 삭제`}
          onClick={onRemove}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <div>
          <span className="label mb-1">제목</span>
          <InlineText
            value={block.title}
            placeholder="블록 제목"
            onChange={(title) => onChange({ title })}
          />
        </div>
        <div>
          <span className="label mb-1">구성 항목</span>
          <ListEditor
            items={block.items}
            placeholder="화면에 보일 문구"
            addLabel="항목 추가"
            onChange={(items) => onChange({ items })}
          />
        </div>
        <div>
          <span className="label mb-1">기획 메모</span>
          <InlineText
            value={block.note ?? ''}
            placeholder="동작·예외 등 메모"
            onChange={(note) => onChange({ note })}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 뒤처진 화면 안내                                                     */
/* ------------------------------------------------------------------ */

/**
 * 기능이 더 붙었는데 그림은 그대로인 화면을 알린다.
 *
 * 정합성 검사에서도 잡히지만, **여기서 바로 고칠 수 있어야** 실제로 고쳐진다.
 * 개요 화면까지 갔다가 돌아오게 만들면 대부분 그냥 넘어간다.
 */
function StaleBanner({
  stale,
  onFix,
  disabled,
}: {
  stale: StalePage[];
  onFix: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (stale.length === 0) return null;

  const missing = stale.filter((s) => s.reason === 'missing').length;
  const changed = stale.length - missing;

  return (
    <div
      className="no-print card mb-3 flex flex-col gap-2 px-4 py-3"
      style={{ background: 'var(--warn-soft)', borderColor: 'transparent' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RefreshCw size={14} style={{ color: 'var(--warn)' }} />
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold" style={{ color: 'var(--warn)' }}>
          {stale.length}개 화면의 와이어프레임이 최신이 아닙니다
          {changed > 0 && missing > 0 && ` (기능 추가 ${changed} · 미작성 ${missing})`}
        </p>
        <RegenerateTag />
        <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '어떤 화면인지 보기'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={onFix} disabled={disabled}>
          <Sparkles size={13} />
          이 화면들 다시 만들기
        </button>
      </div>

      {open && (
        <ul className="flex flex-col gap-1.5 rounded-lg bg-[var(--surface)] p-2.5">
          {stale.map(({ page, reason, addedFeatures }) => (
            <li key={page.id} className="text-[12px] leading-relaxed">
              <span className="id-tag">{page.id}</span>{' '}
              <span className="font-semibold">{page.name}</span>{' '}
              <span className="chip">{reason === 'missing' ? '와이어프레임 없음' : '기능 추가됨'}</span>
              <p className="mt-0.5 text-[11.5px] text-[var(--fg-muted)]">
                {reason === 'missing' ? '이 화면의 기능: ' : '그림에 없는 기능: '}
                {addedFeatures.join(', ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
