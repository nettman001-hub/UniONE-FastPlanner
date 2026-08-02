'use client';

/**
 * 이미지 내보내기.
 *
 * 디자인팀에 넘길 수 있도록 와이어프레임과 플로우차트를 SVG/PNG 로 뽑는다.
 * 화면에 그려진 SVG 는 CSS 변수를 쓰기 때문에, 파일로 뽑을 때는 변수를 실제 색값으로 치환한다.
 */

import { WIREFRAME_BLOCK_LABEL, type IaPage, type Wireframe } from './types';

/* ------------------------------------------------------------------ */
/* 화면에 그려진 SVG 를 파일로                                           */
/* ------------------------------------------------------------------ */

const VAR_PATTERN = /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g;

/** var(--x) 를 현재 테마의 실제 색값으로 바꾼다. */
function resolveCssVars(markup: string): string {
  const computed = getComputedStyle(document.documentElement);
  const cache = new Map<string, string>();
  return markup.replace(VAR_PATTERN, (_match, name: string) => {
    if (!cache.has(name)) cache.set(name, computed.getPropertyValue(name).trim() || '#000000');
    return cache.get(name)!;
  });
}

export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
    const box = svg.getBoundingClientRect();
    clone.setAttribute('width', String(Math.max(1, Math.round(box.width))));
    clone.setAttribute('height', String(Math.max(1, Math.round(box.height))));
  }
  // 배경이 투명하면 밝은 뷰어에서 글씨가 안 보인다.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '100%');
  rect.setAttribute('height', '100%');
  rect.setAttribute('fill', bg || '#ffffff');
  clone.insertBefore(rect, clone.firstChild);

  return resolveCssVars(new XMLSerializer().serializeToString(clone));
}

export function downloadSvg(filename: string, markup: string) {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(filename, blob);
}

/** SVG 문자열을 캔버스에 그려 PNG 로 저장한다. */
export async function downloadPng(filename: string, markup: string, scale = 2): Promise<void> {
  const { width, height } = readSvgSize(markup);
  const image = new Image();
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('이미지를 만들지 못했습니다.'));
    image.src = source;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 사용할 수 없습니다.');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 변환에 실패했습니다.');
  triggerDownload(filename, blob);
}

function readSvgSize(markup: string): { width: number; height: number } {
  const width = Number(/width="([\d.]+)"/.exec(markup)?.[1]);
  const height = Number(/height="([\d.]+)"/.exec(markup)?.[1]);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  const viewBox = /viewBox="([\d.\s-]+)"/.exec(markup)?.[1]?.trim().split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4) return { width: viewBox[2], height: viewBox[3] };
  return { width: 1200, height: 800 };
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* 와이어프레임 → SVG (데이터에서 직접 생성)                             */
/* ------------------------------------------------------------------ */

const PALETTE = {
  paper: '#ffffff',
  frame: '#111827',
  fill: '#eef1f5',
  fillStrong: '#dde2e9',
  line: '#c4ccd6',
  text: '#2b3440',
  textSoft: '#6b7684',
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 글자 수 기준으로 잘라 말줄임 처리한다. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 블록 하나를 그리고 사용한 높이를 돌려준다.
 * 화면에 보이는 렌더러와 별개로, 파일로 뽑을 때 쓰는 단순화된 표현이다.
 */
function drawBlock(
  block: Wireframe['blocks'][number],
  x: number,
  y: number,
  width: number,
): { markup: string; height: number } {
  const parts: string[] = [];
  const pad = 12;
  const titleH = 22;
  const rowH = 18;
  const rows = Math.max(1, Math.min(block.items.length, 6));

  let bodyH: number;
  switch (block.type) {
    case 'header':
    case 'nav':
    case 'banner':
    case 'footer':
      bodyH = 26;
      break;
    case 'hero':
    case 'image':
    case 'detail':
      bodyH = 96;
      break;
    case 'card-grid':
      bodyH = 104;
      break;
    case 'chart':
      bodyH = 90;
      break;
    default:
      bodyH = rows * rowH + 6;
  }

  const height = titleH + bodyH + pad;

  parts.push(
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${PALETTE.paper}" stroke="${PALETTE.line}"/>`,
  );
  parts.push(
    `<text x="${x + 10}" y="${y + 15}" font-size="9" font-weight="700" fill="${PALETTE.textSoft}" letter-spacing="0.4">${escapeXml(
      WIREFRAME_BLOCK_LABEL[block.type].toUpperCase(),
    )}</text>`,
  );
  parts.push(
    `<text x="${x + width - 10}" y="${y + 15}" font-size="10" font-weight="700" text-anchor="end" fill="${PALETTE.text}">${escapeXml(
      clip(block.title, 34),
    )}</text>`,
  );

  const bodyY = y + titleH;
  const inner = width - pad * 2;

  if (block.type === 'card-grid') {
    const cols = 3;
    const gap = 8;
    const cardW = (inner - gap * (cols - 1)) / cols;
    for (let i = 0; i < cols; i += 1) {
      const cx = x + pad + i * (cardW + gap);
      parts.push(
        `<rect x="${cx}" y="${bodyY}" width="${cardW}" height="88" rx="4" fill="${PALETTE.fill}" stroke="${PALETTE.line}"/>`,
      );
      parts.push(
        `<rect x="${cx + 8}" y="${bodyY + 8}" width="${cardW - 16}" height="40" rx="3" fill="${PALETTE.fillStrong}"/>`,
      );
      const label = block.items[i] ?? '';
      if (label) {
        parts.push(
          `<text x="${cx + 8}" y="${bodyY + 66}" font-size="9.5" fill="${PALETTE.text}">${escapeXml(clip(label, Math.floor(cardW / 6)))}</text>`,
        );
      }
    }
  } else if (block.type === 'chart') {
    const bars = 5;
    const gap = 10;
    const barW = (inner - gap * (bars - 1)) / bars;
    const heights = [46, 72, 34, 82, 58];
    for (let i = 0; i < bars; i += 1) {
      const bx = x + pad + i * (barW + gap);
      parts.push(
        `<rect x="${bx}" y="${bodyY + (82 - heights[i])}" width="${barW}" height="${heights[i]}" rx="3" fill="${PALETTE.fillStrong}"/>`,
      );
    }
  } else if (
    block.type === 'hero' ||
    block.type === 'image' ||
    block.type === 'detail'
  ) {
    parts.push(
      `<rect x="${x + pad}" y="${bodyY}" width="${inner}" height="82" rx="4" fill="${PALETTE.fill}" stroke="${PALETTE.line}"/>`,
    );
    block.items.slice(0, 3).forEach((item, i) => {
      parts.push(
        `<text x="${x + pad + 12}" y="${bodyY + 26 + i * 18}" font-size="10.5" fill="${PALETTE.text}">${escapeXml(
          clip(item, Math.floor(inner / 6)),
        )}</text>`,
      );
    });
  } else if (block.type === 'header' || block.type === 'nav' || block.type === 'footer' || block.type === 'banner') {
    parts.push(
      `<rect x="${x + pad}" y="${bodyY}" width="${inner}" height="20" rx="4" fill="${PALETTE.fill}"/>`,
    );
    parts.push(
      `<text x="${x + pad + 8}" y="${bodyY + 14}" font-size="10" fill="${PALETTE.textSoft}">${escapeXml(
        clip(block.items.join('  ·  '), Math.floor(inner / 5.6)),
      )}</text>`,
    );
  } else {
    block.items.slice(0, 6).forEach((item, i) => {
      const ry = bodyY + i * rowH;
      parts.push(
        `<rect x="${x + pad}" y="${ry}" width="${inner}" height="${rowH - 4}" rx="3" fill="${PALETTE.fill}"/>`,
      );
      parts.push(
        `<text x="${x + pad + 8}" y="${ry + 10}" font-size="10" fill="${PALETTE.text}">${escapeXml(
          clip(item, Math.floor(inner / 5.6)),
        )}</text>`,
      );
    });
  }

  return { markup: parts.join('\n'), height };
}

export function wireframeToSvg(wireframe: Wireframe, page?: IaPage): string {
  const mobile = wireframe.device === 'mobile';
  const frameW = mobile ? 375 : 900;
  const contentW = frameW - 32;
  const headerH = 56;

  const body: string[] = [];
  let cursor = headerH + 16;
  for (const block of wireframe.blocks) {
    const { markup, height } = drawBlock(block, 16, cursor, contentW);
    body.push(markup);
    cursor += height + 10;
  }
  const totalH = cursor + 16;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frameW}" height="${totalH}" viewBox="0 0 ${frameW} ${totalH}" font-family="-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif">`,
    `<rect width="${frameW}" height="${totalH}" fill="${PALETTE.paper}"/>`,
    `<rect x="0.5" y="0.5" width="${frameW - 1}" height="${totalH - 1}" rx="${mobile ? 18 : 8}" fill="none" stroke="${PALETTE.frame}" stroke-width="1.5"/>`,
    `<text x="16" y="26" font-size="13" font-weight="800" fill="${PALETTE.text}">${escapeXml(wireframe.name)}</text>`,
    `<text x="16" y="42" font-size="10.5" fill="${PALETTE.textSoft}">${escapeXml(
      `${wireframe.id}${page ? ` · ${page.path}` : ''} · ${mobile ? '모바일 375px' : '데스크톱'}`,
    )}</text>`,
    `<line x1="0" y1="${headerH}" x2="${frameW}" y2="${headerH}" stroke="${PALETTE.line}"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}
