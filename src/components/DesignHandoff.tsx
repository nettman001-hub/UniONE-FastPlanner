'use client';

/**
 * 만들어 둔 기획을 AI 디자인 도구로 넘긴다.
 *
 * **손으로 옮겨 적는 일을 없앤다.** 화면마다 무엇을 그려야 하는지는 이미
 * 와이어프레임·기능·역할·플로우에 다 있다.
 *
 * ## 자동과 수동을 갈라 둔다
 *
 * | | 준비물 | 결과 |
 * | --- | --- | --- |
 * | **자동 · 스티치** | 스티치 연결 한 번 | 여기서 눌러 스티치에 화면이 생긴다 |
 * | **자동 · UniAI** | 없음 | 여기서 만들고 UniBoard 안에서 연다 |
 * | **수동** | 없음 | 요청문을 복사해 도구에 붙여 넣는다 |
 *
 * 자동과 수동 모두 모바일 / 데스크톱 / 둘 다 옵션을 제공합니다.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Image as ImageIcon, Info, Monitor, Smartphone, SmartphoneNfc } from 'lucide-react';

import { SectionCard } from './ui';
import { StitchRun } from './StitchRun';
import { UinAiRun } from './UinAiRun';
import { download, slugify } from '@/lib/export';
import { downloadSvg, wireframeToSvg } from '@/lib/image-export';
import {
  DESIGN_TOOLS,
  handoffDocument,
  screenPrompts,
  systemPrompt,
  TARGET_DEVICE_LABEL,
  type DesignToolKey,
  type TargetDevice,
} from '@/lib/design-handoff';
import type { Plan } from '@/lib/types';

export function DesignHandoff({ plan }: { plan: Plan }) {
  const [automatic, setAutomatic] = useState<'stitch' | 'uinai'>('stitch');
  const [tool, setTool] = useState<DesignToolKey>('stitch');
  const [deviceTarget, setDeviceTarget] = useState<TargetDevice>('both');
  const [copied, setCopied] = useState<string | null>(null);

  const meta = DESIGN_TOOLS.find((t) => t.key === tool)!;
  const screens = useMemo(() => screenPrompts(plan, tool, deviceTarget), [plan, tool, deviceTarget]);
  const intro = useMemo(() => systemPrompt(plan, tool, deviceTarget), [plan, tool, deviceTarget]);

  useEffect(() => {
    const syncFromAddress = () => {
      const selected = new URLSearchParams(window.location.search).get('design');
      if (selected === 'uinai' || selected === 'stitch') setAutomatic(selected);
    };
    syncFromAddress();
    window.addEventListener('popstate', syncFromAddress);
    return () => window.removeEventListener('popstate', syncFromAddress);
  }, []);

  const chooseAutomatic = (next: 'stitch' | 'uinai') => {
    setAutomatic(next);
    const url = new URL(window.location.href);
    if (next === 'uinai') url.searchParams.set('design', 'uinai');
    else url.searchParams.delete('design');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      /* 클립보드를 막아 둔 브라우저도 있다. 조용히 넘긴다. */
    }
  };

  const copyButton = (key: string, text: string, label = '복사') => (
    <button className="btn btn-sm shrink-0" onClick={() => void copy(key, text)}>
      {copied === key ? <Check size={12} /> : <Copy size={12} />}
      {copied === key ? '복사됨' : label}
    </button>
  );

  /** 화면 하나의 SVG. Figma 는 이것을 그대로 읽는다. */
  const downloadOneSvg = (pageId: string, name: string) => {
    const wireframe = plan.wireframes.find((w) => w.pageId === pageId);
    if (!wireframe) return;
    const page = plan.iaPages.find((p) => p.id === pageId);
    downloadSvg(`${slugify(name)}.svg`, wireframeToSvg(wireframe, page));
  };

  if (plan.iaPages.filter((p) => p.type === 'page').length === 0) {
    return (
      <SectionCard
        title="디자인 도구로 넘기기"
        description="정보구조도를 먼저 만들면 화면별 디자인 요청문을 만들어 드립니다."
      >
        <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
          아직 화면이 없습니다. 정보구조도와 와이어프레임을 만든 뒤 다시 열어 주세요.
        </p>
      </SectionCard>
    );
  }

  return (
    <>
      {/*
        자동 — 스티치와 UniAI. 모바일 / 데스크톱 / 둘 다 선택 지원.
      */}
      <SectionCard
        title="자동(UI 먼저 만들기) - 바로 만들기"
        description="스티치에 직접 만들거나 UniAI가 HTML·CSS·JavaScript 코드로 생성한 화면을 UniBoard 안에서 열 수 있습니다. 모바일과 데스크톱 버전을 각각 선택하거나 둘 다 한 번에 만들 수 있습니다."
      >
        <div className="mb-2.5 flex flex-wrap gap-1.5" role="group" aria-label="자동 UI 만들기 도구">
          <button
            type="button"
            aria-pressed={automatic === 'stitch'}
            className={automatic === 'stitch' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => chooseAutomatic('stitch')}
          >
            스티치에 바로 만들기
          </button>
          <button
            type="button"
            aria-pressed={automatic === 'uinai'}
            className={automatic === 'uinai' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => chooseAutomatic('uinai')}
          >
            UniAI로 바로 만들기
          </button>
        </div>
        {/* 둘 다 마운트해 두어 탭을 오가도 선택·엔진·진행 상태가 사라지지 않게 한다. */}
        <div hidden={automatic !== 'stitch'}>
          <StitchRun plan={plan} />
        </div>
        <div hidden={automatic !== 'uinai'}>
          <UinAiRun plan={plan} />
        </div>
      </SectionCard>

      {/* 수동 — 요청문을 복사해 도구에 붙여 넣는다. 모바일/데스크톱/둘 다 다운로드 지원 */}
      <SectionCard
        title="수동(UI 먼저 만들기) - 요청문 복사해 붙여 넣기"
        description="화면마다 무엇을 그려야 하는지 적어 둔 요청문을 만듭니다. 모바일과 데스크톱 버전을 선택하거나 둘 다 한 번에 다운받을 수 있습니다."
        action={
          <button
            className="btn btn-sm"
            onClick={() =>
              download(
                `${slugify(plan.brief.title)}-design-${tool}-${deviceTarget}.md`,
                handoffDocument(plan, tool, deviceTarget),
                'text/markdown;charset=utf-8',
              )
            }
            title={`전체 화면 요청문을 ${TARGET_DEVICE_LABEL[deviceTarget]} 버전으로 다운로드합니다.`}
          >
            <Download size={13} />
            전체 받기 ({TARGET_DEVICE_LABEL[deviceTarget]})
          </button>
        }
      >
        <div className="flex flex-col gap-3.5">
          {/* 도구 고르기 */}
          <div>
            <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-subtle)]">대상 디자인 도구</p>
            <div className="flex flex-wrap gap-1.5">
              {DESIGN_TOOLS.map((t) => (
                <button
                  key={t.key}
                  className={tool === t.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  onClick={() => setTool(t.key)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* 디바이스 선택: 모바일 / 데스크톱 / 둘 다 */}
          <div>
            <p className="mb-1.5 text-[11.5px] font-bold text-[var(--fg-subtle)]">대상 디바이스 버전</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={deviceTarget === 'mobile' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setDeviceTarget('mobile')}
              >
                <Smartphone size={13} />
                모바일
              </button>
              <button
                type="button"
                className={deviceTarget === 'desktop' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setDeviceTarget('desktop')}
              >
                <Monitor size={13} />
                데스크톱
              </button>
              <button
                type="button"
                className={deviceTarget === 'both' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setDeviceTarget('both')}
              >
                <SmartphoneNfc size={13} />
                모바일 + 데스크톱 둘 다
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-semibold">{meta.name}</p>
              <span className="chip chip-primary text-[11px]">{TARGET_DEVICE_LABEL[deviceTarget]}</span>
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">{meta.what}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">{meta.how}</p>
            {meta.note && (
              <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                {meta.note}
              </p>
            )}
            {meta.url && (
              <a
                className="btn btn-sm mt-2"
                href={meta.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink size={12} />
                {meta.name} 열기
              </a>
            )}
          </div>

          {tool === 'stitch' && (
            <p className="flex items-start gap-2 rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-3 py-2 text-[11.5px] leading-relaxed">
              <Info size={13} className="mt-0.5 shrink-0 text-[var(--primary)]" />
              <span className="min-w-0">
                스티치는 <b>위쪽 자동 카드에서 바로 만들 수 있습니다.</b> 연결이 번거로우시면
                아래 요청문을 복사해 쓰셔도 결과는 같습니다.
              </span>
            </p>
          )}

          {/* 0단계 — 톤 잡기 */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-[12.5px] font-bold">
                ① 먼저 전체 방향부터 잡으세요 ({TARGET_DEVICE_LABEL[deviceTarget]})
              </p>
              {copyButton('intro', intro)}
            </div>
            <p className="mb-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
              화면을 하나씩 만들면 색·글꼴·간격이 화면마다 달라집니다. 이 문장을 먼저 넣어 톤을 정한
              뒤 아래 화면들을 이어서 요청하세요.
            </p>
            <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {intro}
            </pre>
          </div>

          {/* 화면별 */}
          <div>
            <p className="mb-1.5 text-[12.5px] font-bold">② 화면마다 하나씩 ({screens.length}개)</p>
            <ul className="flex flex-col gap-2">
              {screens.map((screen) => (
                <li
                  key={screen.pageId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="id-tag shrink-0">{screen.pageId}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                      {screen.name}
                    </span>
                    {!screen.hasWireframe && (
                      <span className="chip" title="와이어프레임이 있으면 훨씬 정확해집니다.">
                        와이어프레임 없음
                      </span>
                    )}
                    {meta.fileBased && screen.hasWireframe && (
                      <button
                        className="btn btn-sm shrink-0"
                        onClick={() => downloadOneSvg(screen.pageId, screen.name)}
                        title="Figma 캔버스에 끌어다 놓으면 편집 가능한 레이어로 들어갑니다."
                      >
                        <ImageIcon size={12} />
                        SVG
                      </button>
                    )}

                    {/* 복사 버튼: 둘 다일 경우 각각 복사 버튼 제공 */}
                    {deviceTarget === 'both' ? (
                      <div className="flex items-center gap-1.5">
                        {copyButton(`${screen.pageId}-mobile`, screen.mobileText, '모바일 복사')}
                        {copyButton(`${screen.pageId}-desktop`, screen.desktopText, '데스크톱 복사')}
                      </div>
                    ) : (
                      copyButton(screen.pageId, screen.text, `${TARGET_DEVICE_LABEL[deviceTarget]} 복사`)
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
            <Info size={13} className="mt-0.5 shrink-0" />
            <p className="min-w-0">
              이 카드는 <b>요청문을 복사해 붙여 넣거나 파일로 다운로드</b>하는 방식입니다.
              디바이스(모바일/데스크톱/둘 다)를 선택하여 원하는 타겟의 요청문을 손쉽게 활용하세요.
            </p>
          </div>
        </div>
      </SectionCard>
    </>
  );
}
