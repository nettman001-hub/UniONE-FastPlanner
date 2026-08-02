'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Braces,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  GitBranch,
  HardDriveDownload,
  Image as ImageIcon,
  Info,
  Link2,
  ListTree,
  Package,
  Printer,
  Terminal,
  X,
} from 'lucide-react';
import { EmptyState, SectionCard, useToast } from '@/components/ui';
import { usePlannerStore } from '@/lib/store';
import {
  download,
  featuresToCsv,
  iaToCsv,
  slugify,
  toAgentBundle,
  toJson,
  toMarkdown,
  toMermaid,
} from '@/lib/export';
import { downloadPng, downloadSvg, wireframeToSvg } from '@/lib/image-export';
import { SHARE_LINK_LIMIT, buildShareLink } from '@/lib/share';
import { ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* 상수                                                                 */
/* ------------------------------------------------------------------ */

const ARTIFACT_KEYS: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

type FormatKey = 'md' | 'fsCsv' | 'iaCsv' | 'json' | 'bundle' | 'mermaid';

interface FormatSpec {
  key: FormatKey;
  label: string;
  ext: string;
  icon: ReactNode;
  description: string;
  filename: string;
  mime: string;
  /** CSV 한글 깨짐 방지용 BOM 부착 여부 */
  bom?: boolean;
  available: boolean;
  /** 비활성 사유 */
  reason?: string;
  content: string;
}

const AGENT_PROMPT =
  'plan-bundle.json 을 읽고 informationArchitecture 의 각 페이지를 라우트로, ' +
  'requirements[].features[].specifications 를 구현 단위로 삼아 작업 계획을 세워줘.';

const BUNDLE_KEYS: { key: string; description: string }[] = [
  { key: 'product', description: '서비스명·한 줄 소개·타겟·플랫폼' },
  { key: 'prd', description: '목표·페르소나·역할·범위·제약' },
  { key: 'requirements', description: '요구사항 → 기능 → 상세명세 트리' },
  { key: 'informationArchitecture', description: '페이지 계층·경로·연결 기능' },
  { key: 'userFlows', description: '플로우 노드·엣지 + mermaid 원문' },
  { key: 'wireframes', description: '화면별 블록 구성과 기획 메모' },
  { key: 'coverage', description: '산출물 5종의 생성 여부' },
];

/* ------------------------------------------------------------------ */
/* 마크다운 → 읽기 좋은 HTML (라이브러리 없이 최소 구현)                 */
/* ------------------------------------------------------------------ */

type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ul'; items: { text: string; depth: number }[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; text: string };

const CELLS = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function parseMarkdown(markdown: string): MdBlock[] {
  const lines = markdown.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  const isFence = (l: string) => l.trimStart().startsWith('```');
  const isTable = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isUl = (l: string) => /^\s*[-*]\s+/.test(l);
  const isOl = (l: string) => /^\s*\d+\.\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (isFence(line)) {
      i += 1;
      const buffer: string[] = [];
      while (i < lines.length && !isFence(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', text: buffer.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      blocks.push({ kind: 'quote', text: line.trim().replace(/^>\s?/, '') });
      i += 1;
      continue;
    }

    if (isTable(line)) {
      const raw: string[] = [];
      while (i < lines.length && isTable(lines[i])) {
        raw.push(lines[i]);
        i += 1;
      }
      const head = CELLS(raw[0]);
      const bodyStart = raw[1] && /^[\s|:-]+$/.test(raw[1]) ? 2 : 1;
      blocks.push({ kind: 'table', head, rows: raw.slice(bodyStart).map(CELLS) });
      continue;
    }

    if (isUl(line)) {
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length && isUl(lines[i])) {
        const indent = /^\s*/.exec(lines[i])?.[0].length ?? 0;
        items.push({
          text: lines[i].trim().replace(/^[-*]\s+/, ''),
          depth: Math.min(3, Math.floor(indent / 2)),
        });
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (isOl(line)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    const paragraph: string[] = [lines[i].trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isFence(lines[i]) &&
      !isTable(lines[i]) &&
      !isUl(lines[i]) &&
      !isOl(lines[i]) &&
      !lines[i].trimStart().startsWith('#') &&
      !lines[i].trimStart().startsWith('>')
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/** **굵게** 와 `코드` 만 처리한다. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part !== '')
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={key} className="font-bold text-[var(--fg)]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={key}
            className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[11.5px] text-[var(--fg-muted)]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={key}>{part}</span>;
    });
}

function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  return (
    <div className="flex flex-col">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.kind) {
          case 'heading': {
            const size =
              block.level === 1
                ? 'text-[21px] font-extrabold mt-0 mb-3'
                : block.level === 2
                  ? 'text-[17px] font-extrabold mt-8 mb-2.5 border-b border-[var(--border)] pb-2'
                  : block.level === 3
                    ? 'text-[14.5px] font-bold mt-6 mb-2'
                    : 'text-[13px] font-bold mt-4 mb-1.5';
            return (
              <p key={key} className={`${size} tracking-tight text-[var(--fg)]`}>
                {renderInline(block.text, key)}
              </p>
            );
          }
          case 'quote':
            return (
              <p
                key={key}
                className="my-3 border-l-2 border-[var(--primary-border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-relaxed text-[var(--fg-muted)]"
              >
                {renderInline(block.text, key)}
              </p>
            );
          case 'ul':
            return (
              <ul key={key} className="my-1.5 flex flex-col gap-1">
                {block.items.map((item, idx) => (
                  <li
                    key={`${key}-${idx}`}
                    className="flex gap-2 text-[13px] leading-relaxed text-[var(--fg-muted)]"
                    style={{ paddingLeft: item.depth * 14 }}
                  >
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--fg-subtle)]" />
                    <span className="min-w-0">{renderInline(item.text, `${key}-${idx}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="my-1.5 flex flex-col gap-1">
                {block.items.map((item, idx) => (
                  <li
                    key={`${key}-${idx}`}
                    className="flex gap-2 text-[13px] leading-relaxed text-[var(--fg-muted)]"
                  >
                    <span className="shrink-0 font-bold text-[var(--fg-subtle)]">{idx + 1}.</span>
                    <span className="min-w-0">{renderInline(item, `${key}-${idx}`)}</span>
                  </li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div key={key} className="table-wrap my-3">
                <table className="data">
                  <thead>
                    <tr>
                      {block.head.map((cell, idx) => (
                        <th key={`${key}-h-${idx}`}>{cell}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rIdx) => (
                      <tr key={`${key}-r-${rIdx}`}>
                        {block.head.map((_, cIdx) => (
                          <td key={`${key}-r-${rIdx}-${cIdx}`}>
                            {renderInline(row[cIdx] ?? '', `${key}-${rIdx}-${cIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return (
              <pre
                key={key}
                className="my-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11.5px] leading-relaxed text-[var(--fg-muted)]"
              >
                {block.text}
              </pre>
            );
          default:
            return (
              <p key={key} className="my-2 text-[13px] leading-[1.85] text-[var(--fg-muted)]">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 형식 카드                                                            */
/* ------------------------------------------------------------------ */

function FormatCard({
  format,
  copied,
  onDownload,
  onCopy,
  onPreview,
  active,
}: {
  format: FormatSpec;
  copied: boolean;
  onDownload: () => void;
  onCopy: () => void;
  onPreview: () => void;
  active: boolean;
}) {
  return (
    <div
      className={`card flex flex-col gap-2.5 p-3.5 ${
        active ? 'border-[var(--primary-border)]' : ''
      } ${format.available ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-[var(--primary)]">{format.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="section-title">{format.label}</h3>
            <span className="id-tag">{format.ext}</span>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
            {format.description}
          </p>
        </div>
      </div>

      {!format.available && format.reason && (
        <p className="text-[11.5px] font-semibold text-[var(--warn)]">{format.reason}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <button
          className="btn btn-primary btn-sm"
          disabled={!format.available}
          onClick={onDownload}
        >
          <Download size={13} />
          다운로드
        </button>
        <button className="btn btn-sm" disabled={!format.available} onClick={onCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '복사됨' : '복사'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!format.available} onClick={onPreview}>
          미리보기
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 페이지                                                               */
/* ------------------------------------------------------------------ */

export default function ExportPage() {
  const { id: planId } = useParams<{ id: string }>();
  const plan = usePlannerStore((s) => s.plans.find((p) => p.id === planId));
  const toast = useToast();

  const [checked, setChecked] = useState<Record<ArtifactKey, boolean>>(() => ({
    prd: plan?.generated.prd ?? false,
    fs: plan?.generated.fs ?? false,
    ia: plan?.generated.ia ?? false,
    flow: plan?.generated.flow ?? false,
    wireframe: plan?.generated.wireframe ?? false,
  }));
  const [tab, setTab] = useState<FormatKey>('md');
  const [copied, setCopied] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [shareLink, setShareLink] = useState('');

  /** 선택 + 실제 생성된 산출물만 남긴다. */
  const selectedKey = ARTIFACT_KEYS.filter((key) => checked[key] && plan?.generated[key]).join(',');

  const formats = useMemo<FormatSpec[]>(() => {
    if (!plan) return [];
    const artifacts = selectedKey ? (selectedKey.split(',') as ArtifactKey[]) : [];
    const slug = slugify(plan.brief.title);

    const flowMarkdown = [
      `# ${plan.brief.title} 유저 플로우`,
      '',
      ...[...plan.flows]
        .sort((a, b) => a.order - b.order)
        .flatMap((flow) => [
          `## ${flow.id} ${flow.name}`,
          '',
          `- 수행 역할: ${flow.actor}`,
          ...(flow.description ? [`- ${flow.description}`] : []),
          '',
          '```mermaid',
          toMermaid(flow.id, plan),
          '```',
          '',
        ]),
    ].join('\n');

    return [
      {
        key: 'md',
        label: '마크다운',
        ext: '.md',
        icon: <FileText size={17} />,
        description: 'Notion·GitHub·Confluence 에 그대로 붙여넣을 수 있습니다.',
        filename: `${slug}-기획서.md`,
        mime: 'text/markdown;charset=utf-8',
        available: true,
        content: toMarkdown(plan, artifacts),
      },
      {
        key: 'fsCsv',
        label: '기능명세서 CSV',
        ext: '.csv',
        icon: <FileSpreadsheet size={17} />,
        description: '엑셀·구글 시트에서 열립니다. 요구사항–기능을 행으로 펼칩니다.',
        filename: `${slug}-기능명세서.csv`,
        mime: 'text/csv;charset=utf-8',
        bom: true,
        available: plan.requirements.length > 0,
        reason: '기능명세서를 먼저 생성해 주세요.',
        content: featuresToCsv(plan),
      },
      {
        key: 'iaCsv',
        label: '정보구조도 CSV',
        ext: '.csv',
        icon: <ListTree size={17} />,
        description: 'Depth 별 페이지 목록을 표로 정리합니다. 엑셀에서 그대로 씁니다.',
        filename: `${slug}-정보구조도.csv`,
        mime: 'text/csv;charset=utf-8',
        bom: true,
        available: plan.iaPages.length > 0,
        reason: '정보구조도를 먼저 생성해 주세요.',
        content: iaToCsv(plan),
      },
      {
        key: 'mermaid',
        label: 'Mermaid 플로우',
        ext: '.md',
        icon: <GitBranch size={17} />,
        description: '모든 유저 플로우를 mermaid 코드 블록 하나의 문서로 묶습니다.',
        filename: `${slug}-플로우.md`,
        mime: 'text/markdown;charset=utf-8',
        available: plan.flows.length > 0,
        reason: '유저 플로우를 먼저 생성해 주세요.',
        content: flowMarkdown,
      },
      {
        key: 'json',
        label: '플랜 JSON',
        ext: '.json',
        icon: <Braces size={17} />,
        description: '다른 브라우저나 팀원에게 옮길 때 씁니다. 홈 화면에서 가져오기 가능.',
        filename: `${slug}-플랜.json`,
        mime: 'application/json;charset=utf-8',
        available: true,
        content: toJson(plan),
      },
      {
        key: 'bundle',
        label: '에이전트 번들',
        ext: '.json',
        icon: <Package size={17} />,
        description:
          'Cursor·Claude Code 같은 코딩 에이전트에 물리는 형식입니다. plan-bundle.json 으로 저장됩니다.',
        filename: 'plan-bundle.json',
        mime: 'application/json;charset=utf-8',
        available: true,
        content: toAgentBundle(plan),
      },
    ];
  }, [plan, selectedKey]);

  const activeFormat = formats.find((f) => f.key === tab) ?? formats[0];

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1800);
      toast('클립보드에 복사했습니다.', 'ok');
    } catch {
      toast('복사에 실패했습니다. 미리보기에서 직접 선택해 주세요.', 'warn');
    }
  };

  const downloadFormat = (format: FormatSpec) => {
    if (!format.available) return;
    // CSV 는 엑셀 한글 깨짐을 막기 위해 BOM 을 앞에 붙인다.
    const body = format.bom ? '\uFEFF' + format.content : format.content;
    download(format.filename, body, format.mime);
    toast(`${format.filename} 을 내려받았습니다.`, 'ok');
  };

  const printDocument = () => {
    setDocOpen(true);
    window.setTimeout(() => window.print(), 150);
  };

  if (!plan) return <div className="p-8 text-[13px] text-[var(--fg-muted)]">플랜을 찾을 수 없습니다.</div>;

  const generatedCount = ARTIFACT_KEYS.filter((key) => plan.generated[key]).length;
  const selectedCount = selectedKey ? selectedKey.split(',').length : 0;
  const docMarkdown = formats.find((f) => f.key === 'md')?.content ?? '';
  const jsonFormat = formats.find((f) => f.key === 'json');
  const slug = slugify(plan.brief.title);

  const downloadOnePng = async (wireframeId: string) => {
    const wireframe = plan.wireframes.find((w) => w.id === wireframeId);
    if (!wireframe) return;
    const page = plan.iaPages.find((p) => p.id === wireframe.pageId);
    try {
      await downloadPng(`${slug}-${wireframe.id}.png`, wireframeToSvg(wireframe, page), 2);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'PNG 변환에 실패했습니다.', 'danger');
    }
  };

  const downloadAllImages = async () => {
    setImageBusy(true);
    try {
      for (const wireframe of [...plan.wireframes].sort((a, b) => a.order - b.order)) {
        const page = plan.iaPages.find((p) => p.id === wireframe.pageId);
        await downloadPng(`${slug}-${wireframe.id}.png`, wireframeToSvg(wireframe, page), 2);
        // 브라우저가 연속 다운로드를 막지 않도록 간격을 둔다.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      toast(`와이어프레임 ${plan.wireframes.length}개를 PNG 로 내려받았습니다.`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'PNG 변환에 실패했습니다.', 'danger');
    } finally {
      setImageBusy(false);
    }
  };

  const makeShareLink = () => {
    try {
      setShareLink(buildShareLink(plan));
    } catch {
      toast('링크를 만들지 못했습니다.', 'danger');
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="no-print flex flex-col gap-5">
        {/* 헤더 */}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[19px] font-extrabold tracking-tight">내보내기 · 연동</h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
              완성된 기획 문서를 문서 도구·스프레드시트·코딩 에이전트로 가져갑니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button className="btn btn-sm" onClick={() => setDocOpen((v) => !v)}>
              <BookOpen size={13} />
              {docOpen ? '문서 닫기' : '문서 보기'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={printDocument}>
              <Printer size={13} />
              전체 문서 인쇄
            </button>
          </div>
        </header>

        {generatedCount === 0 && (
          <EmptyState
            icon={<Download size={22} />}
            title="아직 생성된 산출물이 없습니다"
            description="개요 화면에서 PRD 부터 순서대로 생성하면 이곳에서 내보낼 수 있습니다. 지금은 플랜 JSON 백업만 가능합니다."
            action={
              <Link href={`/plans/${planId}`} className="btn btn-primary btn-sm">
                개요로 이동
              </Link>
            }
          />
        )}

        {/* 1) 산출물 선택 */}
        <SectionCard
          title="내보낼 산출물"
          description="마크다운·인쇄 문서에 포함할 산출물을 고르세요."
          action={
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setChecked({
                    prd: plan.generated.prd,
                    fs: plan.generated.fs,
                    ia: plan.generated.ia,
                    flow: plan.generated.flow,
                    wireframe: plan.generated.wireframe,
                  })
                }
              >
                전체 선택
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setChecked({ prd: false, fs: false, ia: false, flow: false, wireframe: false })
                }
              >
                선택 해제
              </button>
            </>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ARTIFACT_KEYS.map((key) => {
              const ready = plan.generated[key];
              return (
                <label
                  key={key}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition ${
                    ready
                      ? 'cursor-pointer border-[var(--border-strong)] hover:bg-[var(--surface-2)]'
                      : 'cursor-not-allowed border-[var(--border)] opacity-60'
                  } ${ready && checked[key] ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-[var(--primary)]"
                    checked={ready && checked[key]}
                    disabled={!ready}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1 truncate">{ARTIFACT_LABEL[key]}</span>
                  {ready ? (
                    <span className="chip chip-ok shrink-0">생성됨</span>
                  ) : (
                    <span className="chip shrink-0">미생성</span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-[var(--fg-subtle)]">
            {selectedCount > 0
              ? `${selectedCount}개 산출물이 마크다운·인쇄 문서에 포함됩니다. CSV·JSON·번들은 선택과 무관하게 전체 내용을 담습니다.`
              : '선택된 산출물이 없습니다. 마크다운에는 표지 정보만 들어갑니다.'}
          </p>
        </SectionCard>

        {/* 2) 형식 카드 */}
        <section className="flex flex-col gap-3">
          <h2 className="section-title">내보내기 형식</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {formats.map((format) => (
              <FormatCard
                key={format.key}
                format={format}
                active={tab === format.key}
                copied={copied === format.key}
                onDownload={() => downloadFormat(format)}
                onCopy={() => void copyText(format.key, format.content)}
                onPreview={() => setTab(format.key)}
              />
            ))}
          </div>
        </section>

        {/* 3) 미리보기 */}
        {activeFormat && (
          <SectionCard
            title="미리보기"
            description="선택한 형식의 실제 결과입니다."
            action={
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!activeFormat.available}
                  onClick={() => void copyText(`preview-${activeFormat.key}`, activeFormat.content)}
                >
                  {copied === `preview-${activeFormat.key}` ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  복사
                </button>
                <button
                  className="btn btn-sm"
                  disabled={!activeFormat.available}
                  onClick={() => downloadFormat(activeFormat)}
                >
                  <Download size={13} />
                  다운로드
                </button>
              </>
            }
          >
            <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
              {formats.map((format) => (
                <button
                  key={format.key}
                  className={tab === format.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  disabled={!format.available}
                  onClick={() => setTab(format.key)}
                >
                  {format.label}
                </button>
              ))}
            </div>

            {activeFormat.available ? (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="chip chip-primary">{activeFormat.filename}</span>
                  <span className="chip">{activeFormat.content.length.toLocaleString()}자</span>
                </div>
                <pre className="max-h-[420px] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                  {activeFormat.content}
                </pre>
              </>
            ) : (
              <p className="text-[12.5px] text-[var(--fg-muted)]">
                {activeFormat.reason ?? '아직 미리볼 내용이 없습니다.'}
              </p>
            )}
          </SectionCard>
        )}

        {/* 4) 코딩 에이전트 연동 */}
        <SectionCard
          title="코딩 에이전트 연동"
          description="기획서를 그대로 개발 작업으로 넘깁니다."
          action={
            <button
              className="btn btn-sm"
              onClick={() => {
                const bundle = formats.find((f) => f.key === 'bundle');
                if (bundle) downloadFormat(bundle);
              }}
            >
              <Package size={13} />
              번들 받기
            </button>
          }
        >
          <div className="flex flex-col gap-3.5">
            <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
              에이전트 번들을 저장소에 넣고 아래 프롬프트로 지시하면, 코딩 에이전트가 기획서를 그대로
              읽고 구현합니다.
            </p>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="label mb-0 flex items-center gap-1.5">
                  <Terminal size={12} />
                  프롬프트 예시
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => void copyText('prompt', AGENT_PROMPT)}>
                  {copied === 'prompt' ? <Check size={13} /> : <Copy size={13} />}
                  복사
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--fg)]">
                {AGENT_PROMPT}
              </pre>
            </div>

            <div>
              <span className="label">번들 스키마 키</span>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="w-56">키</th>
                      <th>담기는 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BUNDLE_KEYS.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <span className="id-tag">{item.key}</span>
                        </td>
                        <td className="text-[var(--fg-muted)]">{item.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
              <Info size={13} className="mt-0.5 shrink-0" />
              번들에는 ID 참조가 이름까지 펼쳐져 담기므로, 에이전트가 다른 문서를 열지 않아도 화면과
              기능의 관계를 해석할 수 있습니다.
            </p>
          </div>
        </SectionCard>

        {/* 5-1) 이미지 — 디자인 전달용 */}
        <SectionCard
          title="이미지 (디자인 전달용)"
          description="와이어프레임을 SVG 또는 PNG 파일로 뽑습니다. Figma·슬라이드에 그대로 붙여 넣을 수 있습니다."
          action={
            plan.wireframes.length > 0 ? (
              <button
                className="btn btn-sm"
                disabled={imageBusy}
                onClick={() => void downloadAllImages()}
              >
                <ImageIcon size={13} />
                {imageBusy ? '내려받는 중…' : '전체 PNG 내려받기'}
              </button>
            ) : undefined
          }
        >
          {plan.wireframes.length === 0 ? (
            <p className="text-[12.5px] text-[var(--fg-muted)]">
              와이어프레임을 먼저 생성하면 이미지로 내보낼 수 있습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...plan.wireframes]
                .sort((a, b) => a.order - b.order)
                .map((wireframe) => {
                  const page = plan.iaPages.find((p) => p.id === wireframe.pageId);
                  return (
                    <li
                      key={wireframe.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <span className="id-tag shrink-0">{wireframe.id}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {wireframe.name}
                      </span>
                      <span className="chip shrink-0">
                        {wireframe.device === 'mobile' ? '모바일' : '데스크톱'} · 블록{' '}
                        {wireframe.blocks.length}
                      </span>
                      <button
                        className="btn btn-sm shrink-0"
                        onClick={() =>
                          downloadSvg(
                            `${slugify(plan.brief.title)}-${wireframe.id}.svg`,
                            wireframeToSvg(wireframe, page),
                          )
                        }
                      >
                        SVG
                      </button>
                      <button
                        className="btn btn-sm shrink-0"
                        onClick={() => void downloadOnePng(wireframe.id)}
                      >
                        PNG
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
            <Info size={13} className="mt-0.5 shrink-0" />
            유저 플로우 이미지는 플로우 화면에서 캔버스를 그대로 SVG·PNG 로 내려받을 수 있습니다.
          </p>
        </SectionCard>

        {/* 5-2) 보기 전용 공유 링크 */}
        <SectionCard
          title="보기 전용 링크"
          description="문서를 링크에 담아 전달합니다. 받는 사람은 읽기만 할 수 있고, 서버에는 아무것도 저장되지 않습니다."
          action={
            <button className="btn btn-primary btn-sm" onClick={makeShareLink}>
              <Link2 size={13} />
              링크 만들기
            </button>
          }
        >
          {shareLink ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input className="input min-w-0 flex-1 text-[11.5px]" readOnly value={shareLink} />
                <button
                  className="btn btn-sm shrink-0"
                  onClick={() => {
                    void navigator.clipboard.writeText(shareLink);
                    toast('링크를 복사했습니다.', 'ok');
                  }}
                >
                  <Copy size={13} />
                  복사
                </button>
                <a
                  className="btn btn-sm shrink-0"
                  href={shareLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  열어보기
                </a>
              </div>
              {shareLink.length > SHARE_LINK_LIMIT && (
                <p className="chip chip-warn self-start">
                  링크가 {shareLink.length.toLocaleString()}자로 깁니다. 일부 메신저에서 잘릴 수
                  있으니 플랜 JSON 전달을 권합니다.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
              대화 기록과 버전 스냅샷은 빼고 문서만 담습니다. 링크의 <code>#</code> 뒷부분은 서버로
              전송되지 않습니다.
            </p>
          )}
        </SectionCard>

        {/* 6) 하단 안내 */}
        <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            <Info size={14} className="mt-0.5 shrink-0" />
            문서는 이 브라우저에만 저장됩니다. 기기를 옮기거나 백업하려면 플랜 JSON 을 내려받아 홈
            화면에서 가져오기 하세요.
          </p>
          <button
            className="btn btn-sm shrink-0"
            onClick={() => {
              if (jsonFormat) downloadFormat(jsonFormat);
            }}
          >
            <HardDriveDownload size={13} />
            플랜 JSON 백업
          </button>
        </div>
      </div>

      {/* 5) 인쇄용 문서 보기 */}
      {docOpen && (
        <section className="card mt-5 overflow-hidden">
          <header className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
            <div className="min-w-0">
              <h2 className="section-title">문서 보기</h2>
              <p className="mt-0.5 text-[11.5px] text-[var(--fg-muted)]">
                선택한 산출물만 읽기 좋은 형태로 렌더링합니다. 이 상태에서 인쇄하면 이 영역만 출력됩니다.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
                <Printer size={13} />
                인쇄
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDocOpen(false)} aria-label="문서 닫기">
                <X size={14} />
              </button>
            </div>
          </header>
          <article className="px-4 py-5 sm:px-8 sm:py-7">
            <MarkdownView markdown={docMarkdown} />
          </article>
        </section>
      )}
    </div>
  );
}
