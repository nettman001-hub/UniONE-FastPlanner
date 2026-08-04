'use client';

/**
 * 산출물 화면 위쪽에 그 산출물의 정합성 지적만 모아 보여 준다.
 *
 * 개요에만 지적이 있으면, 고치러 화면에 온 순간 **무엇이 지적됐는지가 안 보인다.**
 * 개요로 돌아가 다시 읽고 오는 왕복이 생기고, 대부분 그 왕복에서 그냥 넘어간다.
 * 고치는 자리에 문제와 대상을 함께 둔다.
 *
 * `AI로 수정하기` 를 함께 두는 이유도 같다 — 지적을 읽고 나서도 "그래서 어디를
 * 어떻게" 가 남는다. 지적에는 대상 ID 가 이미 다 있으므로 그대로 넘기면 된다.
 */

import { AlertTriangle, Info } from 'lucide-react';

import { FixWithAi } from './FixWithAi';
import { RegenerateTag } from './ui';
import { issueFixPrompt, issuesFixPrompt } from '@/lib/ai/fix-prompt';
import { LEVEL_LABEL, type Issue } from '@/lib/validate';
import type { ArtifactKey } from '@/lib/types';

const LEVEL_CHIP: Record<Issue['level'], string> = {
  error: 'chip chip-danger',
  warn: 'chip chip-warn',
  info: 'chip chip-primary',
};

export function IssueBar({
  planId,
  artifact,
  issues,
  title = '점검',
}: {
  planId: string;
  artifact: ArtifactKey;
  issues: Issue[];
  title?: string;
}) {
  if (issues.length === 0) return null;

  const worst = issues.some((i) => i.level === 'error')
    ? 'error'
    : issues.some((i) => i.level === 'warn')
      ? 'warn'
      : 'info';

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3.5 py-2">
        {worst === 'info' ? (
          <Info size={13} className="shrink-0 text-[var(--fg-subtle)]" />
        ) : (
          <AlertTriangle
            size={13}
            className="shrink-0"
            style={{ color: worst === 'error' ? 'var(--danger)' : 'var(--warn)' }}
          />
        )}
        <p className="min-w-0 flex-1 text-[12.5px] font-bold">
          {title} {issues.length}건
        </p>
        {/*
          지적이 여러 개일 때 하나씩 시키면 크레딧도 시간도 여러 배로 든다.
          앞의 것을 고치다 뒤의 것이 함께 풀리는 경우도 많다.
        */}
        {issues.length > 1 && (
          <FixWithAi
            planId={planId}
            prompt={issuesFixPrompt(artifact, issues)}
            label="전부 AI로 수정하기"
          />
        )}
      </div>

      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {issues.map((issue) => (
          <li key={issue.id} className="flex flex-wrap items-start gap-2 px-3.5 py-2.5">
            <span className={`${LEVEL_CHIP[issue.level]} shrink-0`}>{LEVEL_LABEL[issue.level]}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-[var(--fg)]">
                {issue.title}
                {issue.regenerate && <RegenerateTag />}
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                {issue.detail}
              </p>
              {issue.targets.length > 0 && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
                  {issue.targets.slice(0, 4).join(' · ')}
                  {issue.targets.length > 4 && ` 외 ${issue.targets.length - 4}건`}
                </p>
              )}
            </div>
            <FixWithAi planId={planId} prompt={issueFixPrompt(issue)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
