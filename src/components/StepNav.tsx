'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';

/** 기획 파이프라인 순서. 마지막 단계 다음은 내보내기다. */
const PIPELINE: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];

const SLUG: Record<ArtifactKey, string> = {
  prd: 'prd',
  fs: 'fs',
  ia: 'ia',
  flow: 'flow',
  wireframe: 'wireframe',
};

interface NextStep {
  href: string;
  label: string;
}

export function nextStepOf(planId: string, current: ArtifactKey): NextStep {
  const index = PIPELINE.indexOf(current);
  const next = PIPELINE[index + 1];
  return next
    ? { href: `/plans/${planId}/${SLUG[next]}`, label: ARTIFACT_LABEL[next] }
    : { href: `/plans/${planId}/export`, label: '내보내기' };
}

/**
 * 각 산출물 화면 상단의 "다음 단계로" 버튼.
 * 현재 단계를 마쳤을 때 다음 산출물로 바로 넘어가게 한다.
 */
export function NextStepButton({
  planId,
  current,
  className = '',
}: {
  planId: string;
  current: ArtifactKey;
  className?: string;
}) {
  const next = nextStepOf(planId, current);
  return (
    <Link
      href={next.href}
      className={`btn btn-sm ${className}`}
      title={`다음 단계: ${next.label}`}
    >
      다음 단계로
      <ArrowRight size={13} />
    </Link>
  );
}
