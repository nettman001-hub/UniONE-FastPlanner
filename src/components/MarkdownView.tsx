'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * 내보내기용 마크다운을 읽기 좋게 렌더링한다.
 * 라이브러리 없이 이 앱이 만들어 내는 형태(제목·표·목록·인용·코드블록)만 처리한다.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  // **굵게** 와 `코드` 만 처리한다.
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    index += 1;
    if (token.startsWith('**')) {
      parts.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-bold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={`${keyPrefix}-c${index}`}
          className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

const isSeparator = (line: string) => /^\|?[\s:-]*\|[\s|:-]*$/.test(line) && line.includes('-');

export function MarkdownView({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const push = (node: ReactNode) => {
    key += 1;
    blocks.push(<Fragment key={key}>{node}</Fragment>);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 코드 블록
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      push(
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11.5px] leading-relaxed">
          {lang && (
            <span className="mb-1 block text-[10px] font-bold text-[var(--fg-subtle)]">{lang}</span>
          )}
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 표
    if (line.trim().startsWith('|') && isSeparator(lines[i + 1] ?? '')) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      push(
        <div className="table-wrap my-3">
          <table className="data">
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th key={ci}>{inline(cell, `h${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{inline(cell, `r${ri}c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 제목
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const sizes = ['text-[22px]', 'text-[18px]', 'text-[15px]', 'text-[14px]', 'text-[13px]', 'text-[13px]'];
      push(
        <p
          className={`${sizes[level - 1]} mt-6 mb-2 font-extrabold tracking-tight first:mt-0 ${
            level <= 2 ? 'border-b border-[var(--border)] pb-1.5' : ''
          }`}
        >
          {inline(text, `hd${key}`)}
        </p>,
      );
      i += 1;
      continue;
    }

    // 인용
    if (line.startsWith('> ')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        body.push(lines[i].slice(2));
        i += 1;
      }
      push(
        <blockquote className="my-3 border-l-2 border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-2 text-[13px] leading-relaxed">
          {inline(body.join(' '), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // 목록 (순서 없음 / 있음)
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      push(
        <ListTag
          className={`my-2 pl-5 text-[13px] leading-relaxed ${
            ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {items.map((item, ii) => (
            <li key={ii} className="mb-1">
              {inline(item, `li${key}-${ii}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // 문단
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !lines[i].trim().startsWith('|') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      body.push(lines[i]);
      i += 1;
    }
    push(
      <p className="my-2 text-[13px] leading-[1.75] text-[var(--fg)]">
        {inline(body.join(' '), `p${key}`)}
      </p>,
    );
  }

  return <div className="max-w-none">{blocks}</div>;
}
