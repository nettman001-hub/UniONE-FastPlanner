'use client';

import type { ReactNode } from 'react';
import { Image as ImageIcon, Search, StickyNote } from 'lucide-react';
import {
  WIREFRAME_BLOCK_LABEL,
  type IaPage,
  type Wireframe,
  type WireframeBlock,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 저해상도 목업 원시 요소                                              */
/* ------------------------------------------------------------------ */

/** 회색 막대 (텍스트 자리표시자) */
function Bar({ w = '100%', h = 6, className = '' }: { w?: string; h?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 rounded-full bg-[var(--surface-3)] ${className}`}
      style={{ width: w, height: h }}
    />
  );
}

/** 실제 텍스트 (items 내용 노출용) */
function Txt({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`block truncate text-[10.5px] leading-4 ${className}`}>{children}</span>;
}

/** 버튼 모양 */
function FakeButton({ label, solid = false }: { label?: string; solid?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 min-w-16 items-center justify-center rounded px-2 text-[10px] font-semibold ${
        solid
          ? 'bg-[var(--fg-subtle)] text-[var(--surface)]'
          : 'border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--fg-muted)]'
      }`}
    >
      {label && label.trim() !== '' ? label : <Bar w="28px" h={5} />}
    </span>
  );
}

/** 대각선 X 가 그려진 이미지 자리 */
function ImagePlaceholder({ h = 72, label }: { h?: number; label?: string }) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-2)]"
      style={{ height: h }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          x1="0"
          y1="0"
          x2="100"
          y2="100"
          stroke="var(--border-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="100"
          y1="0"
          x2="0"
          y2="100"
          stroke="var(--border-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="relative flex items-center gap-1 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--fg-subtle)]">
        <ImageIcon size={11} />
        {label && label.trim() !== '' ? <span className="max-w-40 truncate">{label}</span> : null}
      </span>
    </div>
  );
}

/** 블록 제목 */
function BlockTitle({ text, size = 11 }: { text: string; size?: number }) {
  if (text.trim() === '') return null;
  return (
    <p className="font-bold leading-tight text-[var(--fg)]" style={{ fontSize: size }}>
      {text}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* 블록 유형별 표현                                                     */
/* ------------------------------------------------------------------ */

const CHART_HEIGHTS = [46, 72, 34, 88, 58];

function BlockBody({ block, device }: { block: WireframeBlock; device: Wireframe['device'] }) {
  const items = block.items.map((i) => i.trim()).filter((i) => i !== '');
  const cols = device === 'mobile' ? 2 : 3;

  switch (block.type) {
    case 'header':
      return (
        <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5">
          <span className="flex h-4 w-12 shrink-0 items-center justify-center rounded bg-[var(--surface-3)] text-[8px] font-bold text-[var(--fg-subtle)]">
            LOGO
          </span>
          <span className="min-w-0 flex-1 truncate text-[10.5px] font-bold text-[var(--fg)]">
            {block.title}
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            {(items.length > 0 ? items : ['메뉴', '메뉴']).slice(0, device === 'mobile' ? 2 : 5).map((item, i) => (
              <span
                key={i}
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[9.5px] text-[var(--fg-muted)]"
              >
                {item}
              </span>
            ))}
          </span>
        </div>
      );

    case 'nav':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="flex flex-wrap gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5">
            {(items.length > 0 ? items : ['항목 1', '항목 2', '항목 3']).map((item, i) => (
              <span
                key={i}
                className={`rounded px-2 py-1 text-[9.5px] font-semibold ${
                  i === 0
                    ? 'bg-[var(--surface-3)] text-[var(--fg)]'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]'
                }`}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      );

    case 'hero':
      return (
        <div className="flex flex-col items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-3 py-5 text-center">
          <p className="text-[14px] font-extrabold leading-snug text-[var(--fg)]">
            {block.title || '히어로 제목'}
          </p>
          {items[0] ? (
            <p className="max-w-md text-[10.5px] leading-relaxed text-[var(--fg-muted)]">{items[0]}</p>
          ) : (
            <span className="flex w-full max-w-xs flex-col items-center gap-1">
              <Bar w="80%" />
              <Bar w="60%" />
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
            {(items.slice(1).length > 0 ? items.slice(1, 3) : ['시작하기']).map((item, i) => (
              <FakeButton key={i} label={item} solid={i === 0} />
            ))}
          </span>
        </div>
      );

    case 'search':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5">
            <Search size={12} className="shrink-0 text-[var(--fg-subtle)]" />
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--fg-subtle)]">
              {items[0] ?? block.title ?? '검색어를 입력하세요'}
            </span>
          </div>
          {items.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {items.slice(1).map((item, i) => (
                <span
                  key={i}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[9.5px] text-[var(--fg-muted)]"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      );

    case 'filter':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="flex flex-wrap gap-1">
            {(items.length > 0 ? items : ['필터 1', '필터 2', '필터 3']).map((item, i) => (
              <span
                key={i}
                className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                  i === 0
                    ? 'bg-[var(--surface-3)] text-[var(--fg)]'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]'
                }`}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      );

    case 'list':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="flex flex-col divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-[var(--surface)]">
            {(items.length > 0 ? items : ['', '', '']).map((item, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-2">
                <span
                  aria-hidden
                  className="size-6 shrink-0 rounded-full bg-[var(--surface-3)]"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  {item ? (
                    <Txt className="font-semibold text-[var(--fg)]">{item}</Txt>
                  ) : (
                    <Bar w="55%" />
                  )}
                  <Bar w="78%" h={5} />
                </span>
                <Bar w="18px" h={10} className="rounded" />
              </div>
            ))}
          </div>
        </div>
      );

    case 'card-grid':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {(items.length > 0 ? items : ['', '', '', '', '', '']).slice(0, cols * 2).map((item, i) => (
              <div key={i} className="rounded border border-[var(--border)] bg-[var(--surface)] p-1.5">
                <span
                  aria-hidden
                  className="mb-1.5 block h-10 w-full rounded bg-[var(--surface-3)]"
                />
                {item ? (
                  <Txt className="font-semibold text-[var(--fg)]">{item}</Txt>
                ) : (
                  <Bar w="70%" />
                )}
                <span className="mt-1 block">
                  <Bar w="45%" h={5} />
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'table': {
      const headers = items.length > 0 ? items : ['컬럼 1', '컬럼 2', '컬럼 3', '컬럼 4'];
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)]">
            <div
              className="grid gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5"
              style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}
            >
              {headers.map((head, i) => (
                <Txt key={i} className="font-bold text-[var(--fg)]">
                  {head}
                </Txt>
              ))}
            </div>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="grid items-center gap-2 border-b border-[var(--border)] px-2 py-2 last:border-b-0"
                style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}
              >
                {headers.map((_, i) => (
                  <Bar key={i} w={i === 0 ? '80%' : '60%'} />
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'form':
      return (
        <div className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--surface)] p-2">
          <BlockTitle text={block.title} />
          {(items.length > 0 ? items : ['입력 항목 1', '입력 항목 2', '입력 항목 3']).map((item, i) => (
            <div key={i} className="flex flex-col gap-1">
              <Txt className="font-semibold text-[var(--fg-muted)]">{item}</Txt>
              <span
                aria-hidden
                className="block h-6 w-full rounded border border-[var(--border-strong)] bg-[var(--surface-2)]"
              />
            </div>
          ))}
          <span className="mt-0.5 flex justify-end gap-1.5">
            <FakeButton label="취소" />
            <FakeButton label="확인" solid />
          </span>
        </div>
      );

    case 'detail':
      return (
        <div className="flex flex-col gap-2">
          <BlockTitle text={block.title} size={12} />
          <ImagePlaceholder h={device === 'mobile' ? 96 : 120} />
          <div className="flex flex-col divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-[var(--surface)]">
            {(items.length > 0 ? items : ['속성 1', '속성 2', '속성 3']).map((item, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Txt className="w-24 shrink-0 font-semibold text-[var(--fg-muted)]">{item}</Txt>
                <Bar w="55%" />
              </div>
            ))}
          </div>
        </div>
      );

    case 'tabs':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="flex gap-1 overflow-hidden border-b border-[var(--border)]">
            {(items.length > 0 ? items : ['탭 1', '탭 2', '탭 3']).map((item, i) => (
              <span
                key={i}
                className={`truncate px-2 py-1 text-[10px] font-semibold ${
                  i === 0
                    ? 'border-b-2 border-[var(--fg-subtle)] text-[var(--fg)]'
                    : 'text-[var(--fg-subtle)]'
                }`}
              >
                {item}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1 px-1 pt-1">
            <Bar w="90%" />
            <Bar w="70%" />
          </div>
        </div>
      );

    case 'text':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          {items.length > 0 ? (
            items.map((item, i) => (
              <p key={i} className="text-[10.5px] leading-relaxed text-[var(--fg-muted)]">
                {item}
              </p>
            ))
          ) : (
            <span className="flex flex-col gap-1.5">
              <Bar w="100%" />
              <Bar w="92%" />
              <Bar w="64%" />
            </span>
          )}
        </div>
      );

    case 'image':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <ImagePlaceholder h={device === 'mobile' ? 110 : 150} label={items[0]} />
          {items.length > 1 && (
            <p className="text-[10px] text-[var(--fg-subtle)]">{items.slice(1).join(' · ')}</p>
          )}
        </div>
      );

    case 'chart':
      return (
        <div className="flex flex-col gap-1.5">
          <BlockTitle text={block.title} />
          <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-2">
            <div className="flex h-24 items-end justify-around gap-2 border-b border-l border-[var(--border-strong)] px-1 pb-0.5">
              {CHART_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="w-full max-w-8 rounded-t bg-[var(--surface-3)]"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-around gap-2">
              {CHART_HEIGHTS.map((_, i) => (
                <span
                  key={i}
                  className="min-w-0 flex-1 truncate text-center text-[9px] text-[var(--fg-subtle)]"
                >
                  {items[i] ?? `항목 ${i + 1}`}
                </span>
              ))}
            </div>
          </div>
        </div>
      );

    case 'banner':
      return (
        <div className="flex items-center gap-2 rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-[var(--fg-subtle)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold text-[var(--fg)]">
            {block.title || items[0] || '안내 배너'}
          </span>
          {items.length > 0 && block.title !== '' && (
            <span className="hidden shrink-0 truncate text-[10px] text-[var(--fg-muted)] sm:block">
              {items.join(' · ')}
            </span>
          )}
        </div>
      );

    case 'cta':
      return (
        <div className="flex flex-col items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-center">
          <BlockTitle text={block.title} size={12} />
          <span className="flex flex-wrap items-center justify-center gap-2">
            {(items.length > 0 ? items.slice(0, 2) : ['지금 시작하기']).map((item, i) => (
              <span
                key={i}
                className={`inline-flex h-8 min-w-32 items-center justify-center rounded px-3 text-[11px] font-bold ${
                  i === 0
                    ? 'bg-[var(--fg-subtle)] text-[var(--surface)]'
                    : 'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg-muted)]'
                }`}
              >
                {item}
              </span>
            ))}
          </span>
        </div>
      );

    case 'footer':
      return (
        <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-3">
          <p className="text-[10px] font-bold text-[var(--fg-muted)]">{block.title || '푸터'}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {(items.length > 0 ? items : ['이용약관', '개인정보처리방침', '고객센터']).map(
              (item, i) => (
                <span key={i} className="text-[9.5px] text-[var(--fg-subtle)] underline">
                  {item}
                </span>
              ),
            )}
          </div>
        </div>
      );

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* 블록 껍데기                                                          */
/* ------------------------------------------------------------------ */

function BlockShell({
  block,
  device,
  selected,
  onSelect,
}: {
  block: WireframeBlock;
  device: Wireframe['device'];
  selected: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      aria-label={onSelect ? `${WIREFRAME_BLOCK_LABEL[block.type]} 블록 ${block.title}` : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`relative rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 pb-2 pt-4 ${
        onSelect ? 'cursor-pointer hover:border-[var(--border-strong)]' : ''
      }`}
      style={selected ? { outline: '2px solid var(--primary)', outlineOffset: -1 } : undefined}
    >
      <span className="absolute left-1.5 top-0.5 text-[8.5px] font-bold tracking-tight text-[var(--fg-subtle)]">
        {WIREFRAME_BLOCK_LABEL[block.type]}
      </span>
      {block.note && (
        <span
          className="absolute right-1 top-0.5 text-[var(--fg-subtle)]"
          title={block.note}
          aria-label={`메모: ${block.note}`}
        >
          <StickyNote size={11} />
        </span>
      )}
      <BlockBody block={block} device={device} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 와이어프레임 뷰                                                      */
/* ------------------------------------------------------------------ */

export function WireframeView({
  wireframe,
  page,
  selectedBlockId,
  onSelectBlock,
}: {
  wireframe: Wireframe;
  /** 주소창에 경로를 보여 주기 위한 대상 IA 페이지 */
  page?: IaPage | null;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
}) {
  const path = page?.path ?? '/';

  const content =
    wireframe.blocks.length === 0 ? (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-10 text-center">
        <p className="text-[12px] font-bold text-[var(--fg-muted)]">블록이 없습니다</p>
        <p className="text-[11px] leading-relaxed text-[var(--fg-subtle)]">
          아래 편집기에서 블록을 추가하면 이 자리에 그려집니다.
        </p>
      </div>
    ) : (
      wireframe.blocks.map((block) => (
        <BlockShell
          key={block.id}
          block={block}
          device={wireframe.device}
          selected={selectedBlockId === block.id}
          onSelect={onSelectBlock ? () => onSelectBlock(block.id) : undefined}
        />
      ))
    );

  /* 모바일 기기 프레임 ------------------------------------------------ */
  if (wireframe.device === 'mobile') {
    return (
      <div className="flex justify-center">
        <div
          className="w-[375px] max-w-full rounded-[30px] border-2 border-[var(--border-strong)] bg-[var(--surface-2)] p-2.5"
          style={{ boxShadow: 'var(--shadow)' }}
        >
          {/* 노치 바 */}
          <div className="flex items-center justify-center gap-1.5 pb-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--surface-3)]" />
            <span aria-hidden className="h-1.5 w-14 rounded-full bg-[var(--surface-3)]" />
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-2">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[9px] font-bold text-[var(--fg-subtle)]">9:41</span>
              <span className="mono max-w-[60%] truncate text-[9px] text-[var(--fg-subtle)]">
                {path}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">{content}</div>
          </div>
        </div>
      </div>
    );
  }

  /* 데스크톱 브라우저 크롬 -------------------------------------------- */
  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-[900px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)]"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
          <span className="flex shrink-0 gap-1" aria-hidden>
            <span className="size-2 rounded-full bg-[var(--surface-3)]" />
            <span className="size-2 rounded-full bg-[var(--surface-3)]" />
            <span className="size-2 rounded-full bg-[var(--surface-3)]" />
          </span>
          <span className="mono min-w-0 flex-1 truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-[10px] text-[var(--fg-subtle)]">
            {path}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 bg-[var(--surface)] p-2.5">{content}</div>
      </div>
    </div>
  );
}

export default WireframeView;
