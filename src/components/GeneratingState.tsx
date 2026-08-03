'use client';

/**
 * "생성 중" 안내.
 *
 * 아직 산출물이 없는 화면에서 그 산출물을 만드는 중일 때 보여 준다.
 * 생성 진행 상태가 스토어에 있으므로, 개요에서 생성을 걸고 사이드바로 이 화면에
 * 넘어와도 "아직 없습니다" 가 아니라 이 안내가 나온다.
 */

import { EmptyState, Spinner } from './ui';
import { ARTIFACT_LABEL, type ArtifactKey } from '@/lib/types';

export function GeneratingState({ artifact }: { artifact: ArtifactKey }) {
  return (
    <EmptyState
      icon={<Spinner size={26} />}
      title={`${ARTIFACT_LABEL[artifact]} 생성 중입니다`}
      description="다른 화면으로 옮겨 가도 계속 진행됩니다. 다 만들어지면 이 화면에 바로 나타납니다."
    />
  );
}
