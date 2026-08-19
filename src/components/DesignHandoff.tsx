'use client';

/**
 * 만들어 둔 기획을 AI 디자인 도구로 넘긴다.
 *
 * **손으로 옮겨 적는 일을 없앤다.** 화면마다 무엇을 그려야 하는지는 이미
 * 와이어프레임·기능·역할·플로우에 다 있다.
 *
 * ## 자동과 수동을 갈라 둔다
 *
 * 두 길은 준비물도 결과도 다르다. 한 카드에 섞어 두면 무엇을 하면 되는지가
 * 안 보인다 — 연결한 사람은 필요 없는 요청문을 지나쳐야 하고, 연결 안 한
 * 사람은 눌러도 안 되는 단추를 먼저 만난다.
 *
 * | | 준비물 | 결과 |
 * | --- | --- | --- |
 * | **자동** | 스티치 연결 한 번 | 여기서 눌러 저쪽에 화면이 생긴다 |
 * | **수동** | 없음 | 요청문을 복사해 도구에 붙여 넣는다 |
 *
 * 자동은 스티치만 된다. 나머지 도구는 붙여 넣는 길뿐이라 수동 쪽에만 나온다.
 *
 * 여기서 만든 요청문은 두 길이 그대로 나눠 쓴다. 스티치 API 에 넘길 때도 결국
 * 필요한 것이 이 문장이라 `screenPrompt()` 는 한 벌이면 된다.
 */

import { useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Image as ImageIcon, Info } from 'lucide-react';

import { SectionCard } from './ui';
import { StitchRun } from './StitchRun';
import { download, slugify } from '@/lib/export';
import { downloadSvg, wireframeToSvg } from '@/lib/image-export';
import {
  DESIGN_TOOLS,
  handoffDocument,
  screenPrompts,
  systemPrompt,
  type DesignToolKey,
} from '@/lib/design-handoff';
import type { Plan } from '@/lib/types';

export function DesignHandoff({ plan }: { plan: Plan }) {
  const [tool, setTool] = useState<DesignToolKey>('stitch');
  const [copied, setCopied] = useState<string | null>(null);

  const meta = DESIGN_TOOLS.find((t) => t.key === tool)!;
  const screens = useMemo(() => screenPrompts(plan, tool), [plan, tool]);
  const intro = useMemo(() => systemPrompt(plan, tool), [plan, tool]);

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
    /* 화면이 없으면 자동도 수동도 할 것이 없다. 카드 하나로 이유만 밝힌다. */
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
        자동 — 스티치. **먼저 둔다.** 연결만 하면 이쪽이 훨씬 빠르고, 아래
        수동 카드는 연결이 없거나 다른 도구를 쓸 때의 길이다.
      */}
      <SectionCard
        title="자동 — 스티치로 연결하여 바로 만들기"
        description="스티치를 한 번 연결해 두면, 고른 화면을 여기서 눌러 저쪽에 바로 만듭니다. 붙여 넣을 것이 없습니다."
      >
        <StitchRun plan={plan} />
      </SectionCard>

      {/* 수동 — 요청문을 복사해 도구에 붙여 넣는다. 준비물이 없다. */}
      <SectionCard
        title="수동 — 요청문 복사해 붙여 넣기"
        description="화면마다 무엇을 그려야 하는지 적어 둔 요청문을 만듭니다. 연결 없이 어느 도구에나 쓸 수 있습니다."
        action={
          <button
            className="btn btn-sm"
            onClick={() =>
              download(
                `${slugify(plan.brief.title)}-design-${tool}.md`,
                handoffDocument(plan, tool),
                'text/markdown;charset=utf-8',
              )
            }
          >
            <Download size={13} />
            전체 받기
          </button>
        }
      >
        <div className="flex flex-col gap-3.5">
          {/* 도구 고르기 */}
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

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5">
            <p className="text-[12.5px] font-semibold">{meta.name}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">{meta.what}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">{meta.how}</p>
            {/* 눌러 본 뒤에 "못 쓴다"를 알게 되면 헛걸음이다. 고르는 자리에서 밝힌다. */}
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

          {/*
            스티치를 고른 사람에게는 위 카드가 있다는 것을 알려 준다. 여기까지
            내려와 요청문을 복사하고 나서야 "그냥 눌러도 됐네" 를 알면 헛걸음이다.
          */}
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
                ① 먼저 전체 방향부터 잡으세요
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
            <ul className="flex flex-col gap-1.5">
              {screens.map((screen) => (
                <li
                  key={screen.pageId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="id-tag shrink-0">{screen.pageId}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                      {screen.name}
                    </span>
                    {/*
                      그림이 없는 화면도 요청문은 만든다 — 기능만으로도 쓸 만하다.
                      다만 결과가 얕아지므로 그 사실을 밝힌다.
                    */}
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
                    {copyButton(screen.pageId, screen.text)}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/*
            안내문을 flex 항목으로 두면 <b> 가 별도 칸이 되어 문장이 쪼개진다.
            아이콘과 글 덩어리 둘만 flex 항목이어야 한다.
          */}
          <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
            <Info size={13} className="mt-0.5 shrink-0" />
            <p className="min-w-0">
              이 카드는 <b>요청문을 복사해 붙여 넣는</b> 방식입니다. 눌러서 저쪽에 바로 만들어
              주지는 않습니다. 와이어프레임의 <b>구성 항목</b>을 채워 두실수록 결과가 정확해집니다.
            </p>
          </div>
        </div>
      </SectionCard>
    </>
  );
}
