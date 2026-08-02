'use client';

/**
 * 유저 플로우 SVG 렌더러.
 *
 * 외부 라이브러리 없이 BFS 로 rank(세로 단계)를 계산하고,
 * 같은 rank 를 가로로 나란히 배치한 뒤 직교 연결선을 그린다.
 */

import { useId, useMemo, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  FLOW_NODE_TYPE_LABEL,
  type FlowNode,
  type FlowNodeType,
  type IaPage,
  type UserFlow,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 레이아웃 상수                                                        */
/* ------------------------------------------------------------------ */

const HGAP = 32;
const VGAP = 96;
const PAD = 28;
const MIN_W = 140;
const MAX_W = 220;
const LINE_H = 15;
const FONT = 12;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.2;

/* ------------------------------------------------------------------ */
/* 텍스트 계측 · 줄바꿈                                                 */
/* ------------------------------------------------------------------ */

/** 12px 기준 대략적인 글자 폭. 한글은 전각, 라틴은 반각으로 본다. */
const LATIN = /[\u0000-\u00ff]/;

function charWidth(ch: string): number {
  return LATIN.test(ch) ? 6.6 : 12;
}

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/** 최대 폭(px)에 맞춰 라벨을 여러 줄로 나눈다. 12~14자 정도에서 끊긴다. */
function wrapLabel(label: string, maxWidth: number): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['(이름 없음)'];

  const lines: string[] = [];
  let current = '';

  const hardSplit = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (chunk && textWidth(chunk + ch) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (textWidth(word) <= maxWidth) current = word;
    else hardSplit(word);
  }
  if (current) lines.push(current);

  if (lines.length <= 4) return lines;
  const kept = lines.slice(0, 4);
  kept[3] = `${kept[3].slice(0, Math.max(1, kept[3].length - 1))}…`;
  return kept;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* 레이아웃 계산                                                        */
/* ------------------------------------------------------------------ */

interface Placed {
  node: FlowNode;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
}

interface EdgeDraw {
  id: string;
  d: string;
  label?: string;
  labelX: number;
  labelY: number;
}

interface Layout {
  nodes: Placed[];
  edges: EdgeDraw[];
  width: number;
  height: number;
}

function measure(node: FlowNode): { lines: string[]; w: number; h: number } {
  const wrapWidth = node.type === 'decision' ? 120 : MAX_W - 36;
  const lines = wrapLabel(node.label, wrapWidth);
  const longest = lines.reduce((max, line) => Math.max(max, textWidth(line)), 0);
  const textH = lines.length * LINE_H;

  if (node.type === 'decision') {
    return {
      lines,
      w: clamp(Math.round(longest * 1.7) + 44, MIN_W, MAX_W),
      h: Math.max(70, textH + 52),
    };
  }
  const base = clamp(Math.round(longest) + 36, MIN_W, MAX_W);
  return {
    lines,
    w: node.type === 'system' ? Math.min(MAX_W, base + 20) : base,
    h: Math.max(48, textH + 26),
  };
}

function buildLayout(flow: UserFlow): Layout {
  const nodes = flow.nodes;
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = flow.edges.filter((e) => byId.has(e.from) && byId.has(e.to));

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  /* 시작점 선정 — start 노드 > 들어오는 엣지가 없는 노드 > 첫 노드 */
  let roots = nodes.filter((n) => n.type === 'start');
  if (roots.length === 0) roots = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  if (roots.length === 0) roots = [nodes[0]];

  const rank = new Map<string, number>();
  const discovered: string[] = [];
  const visited = new Set<string>();

  const bfs = (startId: string) => {
    if (visited.has(startId)) return;
    visited.add(startId);
    rank.set(startId, 0);
    discovered.push(startId);
    const queue: string[] = [startId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentRank = rank.get(currentId) ?? 0;
      for (const next of adjacency.get(currentId) ?? []) {
        // 사이클이 있어도 이미 방문한 노드는 다시 큐에 넣지 않는다.
        if (visited.has(next)) continue;
        visited.add(next);
        rank.set(next, currentRank + 1);
        discovered.push(next);
        queue.push(next);
      }
    }
  };

  for (const root of roots) bfs(root.id);
  // 어떤 시작점에서도 닿지 않는 노드(도달 불가)도 빠뜨리지 않는다.
  for (const node of nodes) bfs(node.id);

  /* rank 별 묶기 (BFS 발견 순서 유지) */
  const maxRank = discovered.reduce((max, id) => Math.max(max, rank.get(id) ?? 0), 0);
  const rows: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of discovered) rows[rank.get(id) ?? 0].push(id);

  /* 선 교차를 줄이기 위해 상위 rank 부모의 평균 위치로 정렬 */
  const indexInRow = new Map<string, number>();
  rows[0].forEach((id, i) => indexInRow.set(id, i));
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.to) ?? [];
    list.push(edge.from);
    parents.set(edge.to, list);
  }
  for (let r = 1; r <= maxRank; r += 1) {
    const row = rows[r];
    const weight = new Map<string, number>();
    row.forEach((id, i) => {
      const ups = (parents.get(id) ?? []).filter((p) => (rank.get(p) ?? -1) === r - 1);
      const positions = ups.map((p) => indexInRow.get(p) ?? 0);
      weight.set(id, positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : i);
    });
    row.sort((a, b) => (weight.get(a) ?? 0) - (weight.get(b) ?? 0));
    row.forEach((id, i) => indexInRow.set(id, i));
  }

  /* 좌표 배치 */
  const sizes = new Map<string, { lines: string[]; w: number; h: number }>();
  for (const node of nodes) sizes.set(node.id, measure(node));

  const rowWidths = rows.map((row) =>
    row.reduce((sum, id, i) => sum + (sizes.get(id)!.w + (i > 0 ? HGAP : 0)), 0),
  );
  const contentW = Math.max(MIN_W, ...rowWidths);

  const placed: Placed[] = [];
  let cursorY = PAD;
  let bottom = PAD;
  rows.forEach((row, r) => {
    const rowH = row.reduce((max, id) => Math.max(max, sizes.get(id)!.h), 0);
    let x = PAD + (contentW - rowWidths[r]) / 2;
    for (const id of row) {
      const size = sizes.get(id)!;
      placed.push({
        node: byId.get(id)!,
        lines: size.lines,
        x,
        y: cursorY + (rowH - size.h) / 2,
        w: size.w,
        h: size.h,
        rank: r,
      });
      x += size.w + HGAP;
    }
    bottom = Math.max(bottom, cursorY + rowH);
    cursorY += Math.max(VGAP, rowH + 44);
  });

  const posById = new Map(placed.map((p) => [p.node.id, p]));

  /* 연결선 */
  const drawn: EdgeDraw[] = [];
  let backIndex = 0;
  for (const edge of edges) {
    const a = posById.get(edge.from);
    const b = posById.get(edge.to);
    if (!a || !b) continue;

    const ax = Math.round(a.x + a.w / 2);
    const bx = Math.round(b.x + b.w / 2);

    if (b.rank > a.rank) {
      const y1 = Math.round(a.y + a.h);
      const y2 = Math.round(b.y) - 2;
      const my = Math.round((y1 + y2) / 2);
      const d =
        Math.abs(ax - bx) < 2
          ? `M ${ax} ${y1} L ${bx} ${y2}`
          : `M ${ax} ${y1} L ${ax} ${my} L ${bx} ${my} L ${bx} ${y2}`;
      drawn.push({
        id: edge.id,
        d,
        label: edge.label?.trim() || undefined,
        labelX: Math.abs(ax - bx) < 2 ? ax : Math.round((ax + bx) / 2),
        labelY: my - 8,
      });
      continue;
    }

    // 되돌아가는 연결선 · 같은 단계 연결선은 오른쪽으로 우회시킨다.
    const routeX = PAD + contentW + 22 + backIndex * 16;
    backIndex += 1;
    const ayC = Math.round(a.y + a.h / 2);
    const byC = Math.round(b.y + b.h / 2);
    drawn.push({
      id: edge.id,
      d: `M ${Math.round(a.x + a.w)} ${ayC} L ${routeX} ${ayC} L ${routeX} ${byC} L ${Math.round(
        b.x + b.w,
      ) + 2} ${byC}`,
      label: edge.label?.trim() || undefined,
      labelX: routeX,
      labelY: Math.round((ayC + byC) / 2),
    });
  }

  const backExtra = backIndex > 0 ? 40 + backIndex * 16 + 56 : 0;

  return {
    nodes: placed,
    edges: drawn,
    width: Math.round(contentW + PAD * 2 + backExtra),
    height: Math.round(bottom + PAD),
  };
}

/* ------------------------------------------------------------------ */
/* 노드 도형                                                            */
/* ------------------------------------------------------------------ */

function shapeFill(type: FlowNodeType): string {
  return type === 'start' || type === 'end' ? 'var(--primary-soft)' : 'var(--surface)';
}

function shapeStroke(type: FlowNodeType, selected: boolean): string {
  if (selected) return 'var(--primary)';
  return type === 'start' || type === 'end' ? 'var(--primary-border)' : 'var(--border-strong)';
}

function NodeShape({ placed, selected }: { placed: Placed; selected: boolean }) {
  const { node, x, y, w, h } = placed;
  const fill = shapeFill(node.type);
  const stroke = shapeStroke(node.type, selected);
  const strokeWidth = selected ? 2.5 : 1.4;

  if (node.type === 'decision') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return (
      <polygon
        points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  }

  if (node.type === 'system') {
    const skew = 14;
    return (
      <polygon
        points={`${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  }

  const rx = node.type === 'start' || node.type === 'end' ? 16 : 8;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      {node.type === 'screen' && (
        <rect x={x + 1.5} y={y + 1.5} width={w - 3} height={3} rx={1.5} fill="var(--primary)" />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 본체                                                                 */
/* ------------------------------------------------------------------ */

export interface FlowCanvasProps {
  flow: UserFlow;
  pages: IaPage[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export function FlowCanvas({ flow, pages, selectedNodeId, onSelectNode }: FlowCanvasProps) {
  const [scale, setScale] = useState(1);
  const rawId = useId();
  const arrowId = `fc-arrow-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  const layout = useMemo(() => buildLayout(flow), [flow]);
  const pageName = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) map.set(page.id, page.name);
    return map;
  }, [pages]);

  if (layout.nodes.length === 0) {
    return (
      <div className="empty">
        <p className="text-[13px] font-bold text-[var(--fg)]">아직 단계가 없습니다</p>
        <p className="text-[12.5px] text-[var(--fg-muted)]">
          오른쪽 편집 패널에서 노드를 추가하거나 AI로 생성해 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-[var(--fg-subtle)]">
          단계 {flow.nodes.length}개 · 연결선 {flow.edges.length}개 · 노드를 눌러 편집합니다
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

      <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
        <div style={{ width: layout.width * scale, height: layout.height * scale }}>
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMin meet"
            style={{ transform: `scale(${scale})`, transformOrigin: '0 0', display: 'block' }}
            role="img"
            aria-label={`${flow.name} 플로우차트`}
          >
            <defs>
              <marker
                id={arrowId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-strong)" />
              </marker>
            </defs>

            {/* 연결선 */}
            <g>
              {layout.edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                  markerEnd={`url(#${arrowId})`}
                />
              ))}
            </g>

            {/* 연결선 라벨 */}
            <g>
              {layout.edges
                .filter((edge) => edge.label)
                .map((edge) => {
                  const width = textWidth(edge.label!) * 0.875 + 12;
                  return (
                    <g key={`label-${edge.id}`}>
                      <rect
                        x={edge.labelX - width / 2}
                        y={edge.labelY - 8}
                        width={width}
                        height={16}
                        rx={4}
                        fill="var(--surface)"
                        stroke="var(--border)"
                        strokeWidth={1}
                      />
                      <text
                        x={edge.labelX}
                        y={edge.labelY}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={10.5}
                        fontWeight={600}
                        fill="var(--fg-muted)"
                      >
                        {edge.label}
                      </text>
                    </g>
                  );
                })}
            </g>

            {/* 노드 */}
            <g>
              {layout.nodes.map((placed) => {
                const { node, x, y, w, h, lines } = placed;
                const selected = node.id === selectedNodeId;
                const cx = x + w / 2;
                const firstY = y + h / 2 - ((lines.length - 1) * LINE_H) / 2;
                const badge = node.pageId ? pageName.get(node.pageId) : undefined;
                const badgeText = badge && badge.length > 9 ? `${badge.slice(0, 8)}…` : badge;
                const badgeW = badgeText ? textWidth(badgeText) * 0.8 + 14 : 0;

                return (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelectNode(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectNode(node.id);
                      }
                    }}
                    aria-label={`${FLOW_NODE_TYPE_LABEL[node.type]} ${node.label}`}
                  >
                    <NodeShape placed={placed} selected={selected} />
                    <text
                      x={cx}
                      y={firstY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={FONT}
                      fontWeight={600}
                      fill="var(--fg)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {lines.map((line, i) => (
                        <tspan key={i} x={cx} dy={i === 0 ? 0 : LINE_H}>
                          {line}
                        </tspan>
                      ))}
                    </text>

                    {badgeText && (
                      <g style={{ pointerEvents: 'none' }}>
                        <rect
                          x={x + w - badgeW - 6}
                          y={y + h - 8}
                          width={badgeW}
                          height={16}
                          rx={8}
                          fill="var(--surface-3)"
                          stroke="var(--border)"
                          strokeWidth={1}
                        />
                        <text
                          x={x + w - badgeW / 2 - 6}
                          y={y + h}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={9.5}
                          fontWeight={700}
                          fill="var(--fg-muted)"
                        >
                          {badgeText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

export default FlowCanvas;
