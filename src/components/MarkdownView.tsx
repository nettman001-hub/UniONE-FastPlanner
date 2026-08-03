'use client';

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/**
 * 마크다운을 읽기 좋게 렌더링한다.
 * 라이브러리 없이 이 앱이 다루는 형태(제목·표·목록·인용·코드블록·링크)만 처리한다.
 */

/**
 * 파일명 → 앱 경로 대응표.
 *
 * 설명서를 앱 안에서 볼 때 `./06-troubleshooting.md` 같은 파일 간 링크를
 * `/docs/troubleshooting` 으로 옮기는 데 쓴다. 서버에서 함수를 넘길 수 없으므로
 * (이 파일은 클라이언트 컴포넌트다) 함수가 아니라 표를 받는다.
 */
export type LinkMap = Record<string, string>;

/**
 * `null` 이면 링크로 만들지 않는다.
 *
 * 대응표가 주어졌는데 거기 없는 상대 경로는 저장소 안의 파일을 가리키는 것이라
 * 웹에서 열 수 없다. 링크로 두면 눌러서 404 가 나고, Next 가 미리 받아 오려다
 * 콘솔 오류까지 남긴다. 그래서 글자로만 보여 준다.
 */
function resolveHref(href: string, map?: LinkMap): string | null {
  if (/^https?:|^#|^mailto:/.test(href)) return href;
  if (!map) return href;
  const name = href.split('#')[0].split('/').pop();
  return (name && map[name]) ?? null;
}

function inline(text: string, keyPrefix: string, map?: LinkMap): ReactNode[] {
  // **굵게**, `코드`, [글자](주소) 만 처리한다.
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
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
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const raw = token.slice(split + 2, -1);
      const href = resolveHref(raw, map);
      const external = href !== null && /^https?:/.test(href);
      parts.push(
        href === null ? (
          <span key={`${keyPrefix}-a${index}`} className="font-semibold">
            {label}
          </span>
        ) : external ? (
          <a
            key={`${keyPrefix}-a${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--primary)] underline underline-offset-2"
          >
            {label}
          </a>
        ) : (
          <Link
            key={`${keyPrefix}-a${index}`}
            href={href}
            className="text-[var(--primary)] underline underline-offset-2"
          >
            {label}
          </Link>
        ),
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

export function MarkdownView({ markdown, linkMap }: { markdown: string; linkMap?: LinkMap }) {
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

    // 구분선
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      push(<hr className="my-6 border-[var(--border)]" />);
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
                  <th key={ci}>{inline(cell, `h${ci}`, linkMap)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{inline(cell, `r${ri}c${ci}`, linkMap)}</td>
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
          {inline(text, `hd${key}`, linkMap)}
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
          {inline(body.join(' '), `q${key}`, linkMap)}
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
              {inline(item, `li${key}-${ii}`, linkMap)}
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
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      body.push(lines[i]);
      i += 1;
    }
    push(
      <p className="my-2 text-[13px] leading-[1.75] text-[var(--fg)]">
        {inline(body.join(' '), `p${key}`, linkMap)}
      </p>,
    );
  }

  return <div className="max-w-none">{blocks}</div>;
}
