'use client';

/**
 * 기능명세서 마인드맵.
 *
 * PRD → 요구사항 → 기능 → 상세명세 4단을 가로로 펼친다.
 * 노드는 HTML 로, 연결선만 SVG 로 그린다. 텍스트 줄바꿈·호버·포커스를
 * 브라우저에 맡길 수 있어 SVG 로 전부 그리는 것보다 편집 UI 에 맞다.
 * (플로우차트는 이미지로 내보내야 하므로 반대로 전부 SVG 다.)
 *
 * 세로 배치 규칙: 상세명세 한 줄이 기본 단위이고, 기능은 자기 명세들의 한가운데,
 * 요구사항은 자기 기능들의 한가운데에 놓인다. 그래서 줄이 겹치지 않는다.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Maximize2, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import type { FsTreeNode } from '@/lib/fs-tree';
import type { WorkStatus } from '@/lib/types';

/* 배치 상수 -------------------------------------------------------- */
const ROW_H = 54; // 상세명세 한 줄이 차지하는 세로 간격
const NODE_H = 38;
const REQ_H = 44;
const GAP_X = 56;
const PAD = 24;
const REQ_GAP = 20; // 요구사항 묶음 사이 여백

const W_ROOT = 92;
const W_REQ = 200;
const W_FEATURE = 248;
const W_SPEC = 228;

const X_ROOT = PAD;
const X_REQ = X_ROOT + W_ROOT + GAP_X;
const X_FEATURE = X_REQ + W_REQ + GAP_X;
const X_SPEC = X_FEATURE + W_FEATURE + GAP_X;
const CANVAS_W = X_SPEC + W_SPEC + PAD;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.1;

/**
 * 요구사항 가지마다 다른 색을 준다. 자식은 같은 색을 물려받아 어느 줄기인지 보인다.
 * 배경·테두리에만 색을 쓰고 글자는 `--fg` 로 두어 다크 모드에서도 읽힌다.
 */
export const BRANCH_HUES = [152, 205, 262, 33, 340, 12, 187, 291];
const HUES = BRANCH_HUES;

const STATUS_COLOR: Record<WorkStatus, string> = {
  작성전: 'var(--border-strong)',
  작성중: 'var(--warn)',
  검토중: 'var(--primary)',
  확정: 'var(--ok)',
};

type MapKind = 'root' | 'requirement' | 'feature' | 'spec' | 'add-feature' | 'add-spec' | 'add-req';

interface MapNode {
  key: string;
  kind: MapKind;
  /** 도메인 ID — 실제 항목일 때만 */
  domainId?: string;
  /** 추가 버튼이 어디에 붙을지 */
  parentId?: string;
  label: string;
  /** 1 / 1.1 / 1.1.1 */
  no?: string;
  status?: WorkStatus;
  hue: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MapEdge {
  key: string;
  from: MapNode;
  to: MapNode;
  hue: number | null;
}

export type MapSelection =
  | { kind: 'requirement'; id: string }
  | { kind: 'feature'; id: string }
  | { kind: 'specification'; id: string }
  | null;

/* 배치 계산 -------------------------------------------------------- */

function buildLayout(tree: FsTreeNode[]) {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const reqNodes: MapNode[] = [];

  let cursor = PAD;

  tree.forEach((node, ri) => {
    const hue = HUES[ri % HUES.length];
    const branchNodes: MapNode[] = [];

    if (node.features.length === 0) {
      // 기능이 하나도 없으면 두 칸 모두 자리표시자를 놓아 열 구조를 보여 준다.
      const addFeature: MapNode = {
        key: `add-fn-${node.req.id}`,
        kind: 'add-feature',
        parentId: node.req.id,
        label: '핵심 기능 추가',
        hue,
        x: X_FEATURE,
        y: cursor,
        w: W_FEATURE,
        h: NODE_H,
      };
      const addSpec: MapNode = {
        key: `add-sp-${node.req.id}`,
        kind: 'add-spec',
        label: '상세 기능 추가',
        hue: null,
        x: X_SPEC,
        y: cursor,
        w: W_SPEC,
        h: NODE_H,
      };
      nodes.push(addFeature, addSpec);
      branchNodes.push(addFeature);
      cursor += ROW_H;
    } else {
      node.features.forEach((child, fi) => {
        const featureTop = cursor;
        const specNodes: MapNode[] = [];

        if (child.specs.length === 0) {
          const addSpec: MapNode = {
            key: `add-sp-${child.feature.id}`,
            kind: 'add-spec',
            parentId: child.feature.id,
            label: '상세 기능 추가',
            hue,
            x: X_SPEC,
            y: cursor,
            w: W_SPEC,
            h: NODE_H,
          };
          nodes.push(addSpec);
          specNodes.push(addSpec);
          cursor += ROW_H;
        } else {
          child.specs.forEach((spec, si) => {
            const specNode: MapNode = {
              key: `sp-${spec.id}`,
              kind: 'spec',
              domainId: spec.id,
              label: spec.title,
              no: `${ri + 1}.${fi + 1}.${si + 1}`,
              status: spec.status,
              hue,
              x: X_SPEC,
              y: cursor,
              w: W_SPEC,
              h: NODE_H,
            };
            nodes.push(specNode);
            specNodes.push(specNode);
            cursor += ROW_H;
          });
        }

        // 자기 명세들의 한가운데
        const featureNode: MapNode = {
          key: `fn-${child.feature.id}`,
          kind: 'feature',
          domainId: child.feature.id,
          label: child.feature.name,
          no: `${ri + 1}.${fi + 1}`,
          status: child.feature.status,
          hue,
          x: X_FEATURE,
          y: (featureTop + cursor - ROW_H) / 2,
          w: W_FEATURE,
          h: NODE_H,
        };
        nodes.push(featureNode);
        branchNodes.push(featureNode);
        specNodes.forEach((specNode) =>
          edges.push({ key: `e-${featureNode.key}-${specNode.key}`, from: featureNode, to: specNode, hue }),
        );
      });
    }

    // 자기 기능들의 한가운데
    const first = branchNodes[0];
    const last = branchNodes[branchNodes.length - 1];
    const reqNode: MapNode = {
      key: `req-${node.req.id}`,
      kind: 'requirement',
      domainId: node.req.id,
      label: node.req.title,
      no: String(ri + 1),
      hue,
      x: X_REQ,
      y: (first.y + last.y + NODE_H - REQ_H) / 2,
      w: W_REQ,
      h: REQ_H,
    };
    nodes.push(reqNode);
    reqNodes.push(reqNode);
    branchNodes.forEach((child) =>
      edges.push({ key: `e-${reqNode.key}-${child.key}`, from: reqNode, to: child, hue }),
    );

    cursor += REQ_GAP;
  });

  // 요구사항 추가 자리표시자
  const addReq: MapNode = {
    key: 'add-req',
    kind: 'add-req',
    label: '요구사항 추가',
    hue: null,
    x: X_REQ,
    y: tree.length === 0 ? PAD : cursor,
    w: W_REQ,
    h: NODE_H,
  };
  nodes.push(addReq);
  cursor += ROW_H;

  const anchors = reqNodes.length > 0 ? reqNodes : [addReq];
  const rootNode: MapNode = {
    key: 'root',
    kind: 'root',
    label: 'PRD',
    hue: null,
    x: X_ROOT,
    y: (anchors[0].y + anchors[anchors.length - 1].y + anchors[anchors.length - 1].h - REQ_H) / 2,
    w: W_ROOT,
    h: REQ_H,
  };
  nodes.push(rootNode);
  reqNodes.forEach((reqNode) =>
    edges.push({ key: `e-root-${reqNode.key}`, from: rootNode, to: reqNode, hue: reqNode.hue }),
  );

  return { nodes, edges, width: CANVAS_W, height: Math.max(cursor + PAD, 240) };
}

/** 부모 오른쪽 변에서 자식 왼쪽 변으로 잇는 완만한 곡선. */
function edgePath(from: MapNode, to: MapNode) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/* 컴포넌트 --------------------------------------------------------- */

export function FsMindmap({
  planId,
  tree,
  selection,
  onSelect,
  onAddRequirement,
  onAddFeature,
  onAddSpec,
}: {
  planId: string;
  tree: FsTreeNode[];
  selection: MapSelection;
  onSelect: (next: MapSelection) => void;
  onAddRequirement: () => void;
  onAddFeature: (requirementId: string) => void;
  onAddSpec: (featureId: string) => void;
}) {
  const [scale, setScale] = useState(1);
  const layout = useMemo(() => buildLayout(tree), [tree]);

  const isSelected = (node: MapNode) => {
    if (!selection || !node.domainId) return false;
    if (node.kind === 'requirement') return selection.kind === 'requirement' && selection.id === node.domainId;
    if (node.kind === 'feature') return selection.kind === 'feature' && selection.id === node.domainId;
    if (node.kind === 'spec') return selection.kind === 'specification' && selection.id === node.domainId;
    return false;
  };

  const activate = (node: MapNode) => {
    switch (node.kind) {
      case 'requirement':
        return onSelect({ kind: 'requirement', id: node.domainId! });
      case 'feature':
        return onSelect({ kind: 'feature', id: node.domainId! });
      case 'spec':
        return onSelect({ kind: 'specification', id: node.domainId! });
      case 'add-req':
        return onAddRequirement();
      case 'add-feature':
        return onAddFeature(node.parentId!);
      case 'add-spec':
        return node.parentId ? onAddSpec(node.parentId) : undefined;
      default:
        return undefined;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-[var(--fg-subtle)]">
          왼쪽부터 PRD · 요구사항 · 기능 · 상세명세 — 노드를 눌러 편집합니다
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setScale((v) => Math.max(ZOOM_MIN, Number((v - ZOOM_STEP).toFixed(2))))}
            disabled={scale <= ZOOM_MIN}
            aria-label="축소"
          >
            <ZoomOut size={13} />
          </button>
          <span className="w-10 text-center text-[11px] font-semibold text-[var(--fg-muted)]">
            {Math.round(scale * 100)}%
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setScale((v) => Math.min(ZOOM_MAX, Number((v + ZOOM_STEP).toFixed(2))))}
            disabled={scale >= ZOOM_MAX}
            aria-label="확대"
          >
            <ZoomIn size={13} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScale(1)} aria-label="기본 배율">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
        <div
          className="relative"
          style={{
            width: layout.width * scale,
            height: layout.height * scale,
          }}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={layout.width}
              height={layout.height}
              aria-hidden
            >
              {layout.edges.map((edge) => (
                <path
                  key={edge.key}
                  d={edgePath(edge.from, edge.to)}
                  fill="none"
                  strokeWidth={1.5}
                  stroke={
                    edge.hue === null
                      ? 'var(--border-strong)'
                      : `hsl(${edge.hue} 60% 50% / 0.55)`
                  }
                />
              ))}
            </svg>

            {layout.nodes.map((node) => {
              const selected = isSelected(node);
              const ghost = node.kind.startsWith('add-');
              const orphanGhost = ghost && node.kind === 'add-spec' && !node.parentId;

              /* PRD 루트 — 눌러서 PRD 화면으로 이동 */
              if (node.kind === 'root') {
                return (
                  <Link
                    key={node.key}
                    href={`/plans/${planId}/prd`}
                    className="absolute flex items-center justify-center gap-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[12.5px] font-extrabold shadow-sm transition hover:border-[var(--primary-border)] hover:text-[var(--primary)]"
                    style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
                    title="PRD 화면으로 이동"
                  >
                    PRD
                    <ExternalLink size={11} />
                  </Link>
                );
              }

              const hueStyle =
                node.hue === null
                  ? {}
                  : node.kind === 'requirement'
                    ? {
                        background: `hsl(${node.hue} 68% 50% / 0.14)`,
                        borderColor: `hsl(${node.hue} 58% 46% / 0.55)`,
                      }
                    : { borderColor: `hsl(${node.hue} 58% 46% / 0.42)` };

              return (
                <button
                  key={node.key}
                  type="button"
                  disabled={orphanGhost}
                  onClick={() => activate(node)}
                  aria-current={selected ? 'true' : undefined}
                  title={ghost ? node.label : `${node.no ?? ''} ${node.label}`.trim()}
                  className={[
                    'absolute flex items-center gap-1.5 rounded-xl border px-2.5 text-left transition',
                    ghost
                      ? 'border-dashed border-[var(--border-strong)] bg-transparent text-[11.5px] text-[var(--fg-subtle)] justify-center'
                      : 'bg-[var(--surface)] text-[12px] shadow-sm hover:shadow',
                    orphanGhost ? 'cursor-default opacity-45' : 'cursor-pointer',
                    selected ? 'ring-2 ring-[var(--primary)]' : '',
                  ].join(' ')}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    height: node.h,
                    ...(ghost ? {} : hueStyle),
                  }}
                >
                  {ghost ? (
                    <>
                      <Plus size={12} />
                      {node.label}
                    </>
                  ) : (
                    <>
                      {node.status && (
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLOR[node.status] }}
                          title={node.status}
                        />
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          node.kind === 'requirement' ? 'font-bold' : 'font-semibold'
                        }`}
                      >
                        {node.label}
                      </span>
                      {node.no && (
                        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[var(--fg-subtle)]">
                          {node.no}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
