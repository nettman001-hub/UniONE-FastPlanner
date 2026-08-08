'use client';

/**
 * 지침 한 칸 — 글 상자와 그 아래 줄.
 *
 * 설정 화면(계정 기본)과 플랜 화면(이 플랜만)이 **같은 칸을 쓴다.** 따로
 * 만들면 한쪽에만 `예시 넣기` 가 생기거나 글자 수 상한이 어긋난다.
 * 저장 버튼은 자리마다 다르므로 밖에서 넣는다.
 */

import { useRef, type ReactNode } from 'react';
import { FileUp, Lightbulb } from 'lucide-react';

import { useToast } from '@/components/ui';
import { SKILL_EXAMPLE, SKILL_MAX_CHARS, skillTitle } from '@/lib/skills';
import type { ArtifactKey } from '@/lib/types';

interface Props {
  artifact: ArtifactKey;
  value: string;
  onChange: (body: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** 줄 왼쪽에 놓을 것 — 보통 저장 버튼. */
  children?: ReactNode;
  /** 글자 수 옆에 붙일 것 — 보통 `저장 안 함` 표시. */
  note?: ReactNode;
}

export function SkillBody({
  artifact,
  value,
  onChange,
  disabled = false,
  placeholder,
  children,
  note,
}: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const text = await file.text();
    if (text.length > SKILL_MAX_CHARS) {
      toast(`${SKILL_MAX_CHARS.toLocaleString()}자를 넘습니다. 줄여서 올려 주세요.`, 'warn');
      return;
    }
    onChange(text);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <textarea
        className="input mt-2 min-h-[132px] font-mono text-[11.5px] leading-relaxed"
        value={value}
        maxLength={SKILL_MAX_CHARS}
        disabled={disabled}
        placeholder={placeholder ?? `${skillTitle(artifact)}을(를) 만들 때 지킬 것을 적어 주세요.`}
        onChange={(e) => onChange(e.target.value)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {children}
        {/* 빈 칸을 주면 아무도 안 쓴다. 고쳐 쓸 것을 준다. */}
        <button
          className="btn btn-sm"
          disabled={disabled}
          onClick={() => onChange(SKILL_EXAMPLE[artifact])}
        >
          <Lightbulb size={13} />
          예시 넣기
        </button>
        <button className="btn btn-sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
          <FileUp size={13} />
          파일에서
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
        <span className="ml-auto text-[11px] text-[var(--fg-subtle)]">
          {value.length.toLocaleString()} / {SKILL_MAX_CHARS.toLocaleString()}자{note}
        </span>
      </div>
    </>
  );
}
