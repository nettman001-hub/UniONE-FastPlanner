'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Code2,
  Copy,
  Download,
  Monitor,
  Package,
  Smartphone,
} from 'lucide-react';

import { EmptyState, Spinner, useToast } from '@/components/ui';
import {
  UINAI_AGENT_PROMPT,
  uinAiPreviewDocument,
  uinAiScreenHref,
  uinAiSourceText,
  uinAiSourceSignature,
} from '@/lib/design/uinai';
import { download, slugify, toAgentBundle } from '@/lib/export';
import { usePlannerStore } from '@/lib/store';

export default function UinBoardPage() {
  const params = useParams<{ id: string; pageId: string }>();
  const toast = useToast();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hydrated = usePlannerStore((state) => state.hydrated);
  const plan = usePlannerStore((state) => state.plans.find((item) => item.id === params.id));
  const screen = plan?.uinAiScreens?.find((item) => item.pageId === params.pageId);
  const preview = useMemo(() => (screen ? uinAiPreviewDocument(screen) : ''), [screen]);
  const source = screen ? uinAiSourceText(screen) : '';
  const screenId = screen?.id;
  const screenDevice = screen?.device;

  useEffect(() => {
    if (screenDevice) setDevice(screenDevice);
  }, [screenDevice, screenId]);

  useEffect(() => {
    // 레이아웃의 main이 자체 스크롤을 쓰므로 내보내기 아래쪽에서 들어오면 브라우저의
    // 기본 scroll restoration만으로는 상단 도구막대가 보이지 않는다.
    rootRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [params.pageId]);

  if (!hydrated) {
    return (
      <div className="flex min-h-80 items-center justify-center text-[var(--fg-muted)]">
        <Spinner size={18} />
      </div>
    );
  }

  if (!plan || !screen) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={<Monitor size={22} />}
          title="UniAI 화면을 찾을 수 없습니다"
          description="내보내기에서 화면을 골라 UniAI로 먼저 만들어 주세요."
          action={
            <Link className="btn btn-primary btn-sm" href={`/plans/${params.id}/export?design=uinai`}>
              내보내기로 돌아가기
            </Link>
          }
        />
      </div>
    );
  }

  const stale = screen.sourceSignature !== uinAiSourceSignature(plan, screen.pageId);
  const resultPages = plan.iaPages.filter((page) =>
    plan.uinAiScreens?.some((item) => item.pageId === page.id),
  );

  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(UINAI_AGENT_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast('코딩 에이전트용 지시문을 복사했습니다.', 'ok');
    } catch {
      toast('지시문을 복사하지 못했습니다.', 'warn');
    }
  };

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 p-4 sm:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <Link className="btn btn-sm shrink-0" href={`/plans/${plan.id}/export?design=uinai`}>
          <ChevronLeft size={13} /> 내보내기
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="id-tag">{screen.pageId}</span>
            <h1 className="truncate text-[18px] font-extrabold">{screen.name}</h1>
            <span className="chip">UniAI · {screen.engine === 'advanced' ? '고급 엔진' : '기본 엔진'}</span>
            {stale && <span className="chip chip-warn">원본 변경됨 · 다시 만들기 권장</span>}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
            {screen.summary || `${screen.route} 화면 미리보기`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            className="btn btn-sm"
            disabled={!preview}
            onClick={() => {
              download(`${slugify(screen.name)}.html`, preview, 'text/html;charset=utf-8');
              toast('안전한 미리보기 HTML을 내려받았습니다.', 'ok');
            }}
          >
            <Download size={12} /> 미리보기 HTML
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              download('plan-bundle.json', toAgentBundle(plan), 'application/json;charset=utf-8');
              toast('UniAI 결과가 포함된 에이전트 번들을 받았습니다.', 'ok');
            }}
          >
            <Package size={12} /> 코딩 에이전트에 넘기기
          </button>
          <button className="btn btn-sm" onClick={() => void copyAgentPrompt()}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '복사됨' : '지시문 복사'}
          </button>
        </div>
      </header>

      {resultPages.length > 1 && (
        <nav className="flex flex-wrap gap-1.5" aria-label="UniAI로 만든 화면">
          {resultPages.map((page) => (
            <Link
              key={page.id}
              className={page.id === screen.pageId ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              href={uinAiScreenHref(plan.id, page.id)}
            >
              {page.name}
            </Link>
          ))}
        </nav>
      )}

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <button
              className={device === 'desktop' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              aria-pressed={device === 'desktop'}
              onClick={() => setDevice('desktop')}
            >
              <Monitor size={12} /> 데스크톱
            </button>
            <button
              className={device === 'mobile' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              aria-pressed={device === 'mobile'}
              onClick={() => setDevice('mobile')}
            >
              <Smartphone size={12} /> 모바일
            </button>
          </div>
          <button
            className={showCode ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            aria-pressed={showCode}
            onClick={() => setShowCode((open) => !open)}
          >
            <Code2 size={12} /> {showCode ? '미리보기만' : '코드 보기'}
          </button>
        </div>

        <div className={showCode ? 'grid min-h-[720px] lg:grid-cols-2' : 'min-h-[720px]'}>
          <div className="overflow-auto bg-[#e9edf3] p-4">
            <div
              className="mx-auto overflow-hidden rounded-lg bg-white shadow-lg transition-[width]"
              style={{ width: device === 'mobile' ? 390 : '100%', maxWidth: '100%' }}
            >
              <iframe
                title={`${screen.name} UniAI 미리보기`}
                className="block h-[680px] w-full border-0 bg-white"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview}
              />
            </div>
          </div>
          {showCode && (
            <pre className="max-h-[720px] overflow-auto border-t border-[var(--border)] bg-[var(--surface-2)] p-4 text-[11px] leading-relaxed whitespace-pre-wrap lg:border-t-0 lg:border-l">
              {source}
            </pre>
          )}
        </div>
      </section>

      {(screen.implementationNotes ?? []).length > 0 && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
          <h2 className="text-[12.5px] font-bold">구현 메모</h2>
          <ul className="mt-1.5 flex flex-col gap-1">
            {(screen.implementationNotes ?? []).map((note) => (
              <li key={note} className="text-[11.5px] leading-relaxed text-[var(--fg-muted)]">· {note}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
