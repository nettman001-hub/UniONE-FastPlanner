import { ARTIFACT_KEYS, type ArtifactKey, type Plan, type PlanDocuments } from '../types';
import { draftToPatch } from './apply';
import { applyAgentEdit } from './agent-edit';
import { changedDocumentPatch } from './document-patch';
import { contentLossMessage, describeContentLoss } from './guard';
import { revalidateNotes, type NoteRecheckResult, type VerifyNotes } from './revalidate-notes';

export interface AgentResult {
  reply: string;
  changes: string[];
  patch: { artifact: string; payload: string };
}

/** API와 회귀 테스트가 같은 적용·재검증 경로를 사용한다. */
export async function finalizeAgentResponse(
  plan: Plan,
  result: AgentResult | undefined,
  options: { reviewNoteIds?: string[]; verify: VerifyNotes },
) {
  let patch: Partial<PlanDocuments> | undefined;
  let failure: string | undefined;
  let verification: Omit<NoteRecheckResult, 'reviewNotes'> | undefined;
  const artifact = result?.patch?.artifact;
  const attemptedEdit = !!artifact && artifact !== 'none';
  if (attemptedEdit) {
    try {
      if (!ARTIFACT_KEYS.includes(artifact as ArtifactKey) || !result?.patch.payload) throw new Error('invalid patch');
      const draft: unknown = JSON.parse(result.patch.payload);
      const candidate = applyAgentEdit(plan, artifact as ArtifactKey, draft)?.patch ??
        draftToPatch(artifact as ArtifactKey, draft, plan, { mergeWireframes: true });
      const loss = describeContentLoss(plan, candidate);
      if (loss) failure = contentLossMessage(loss);
      else patch = changedDocumentPatch(plan, candidate);
    } catch {
      failure = '수정안을 읽지 못해 문서에 반영하지 않았습니다.';
    }
  }

  // 검토 메타데이터 변경을 문서 본문 수정으로 표시하지 않는다.
  const changedContent = !!patch;
  const notes = (plan.reviewNotes ?? []).filter((note) =>
    options.reviewNoteIds !== undefined
      ? options.reviewNoteIds.includes(note.id)
      : artifact === 'fs' && changedContent,
  );
  let reply = failure ?? result?.reply ?? '현재 문서로 지적을 재검증했습니다.';
  if (!failure && attemptedEdit && !changedContent) {
    reply = '수정안이 현재 문서와 같아 본문을 다시 변경하지 않았습니다.';
  }
  if (notes.length > 0) {
    const checked = await revalidateNotes({ ...plan, ...patch }, notes, options.verify);
    verification = { resolved: checked.resolved, unresolved: checked.unresolved, pending: checked.pending };
    patch = changedDocumentPatch(plan, { ...patch, reviewNotes: checked.reviewNotes });
    const summary = [
      ...(checked.resolved ? [`해결 확인 ${checked.resolved}건: 해당 경고를 제거했습니다.`] : []),
      ...(checked.unresolved ? [`미해결 ${checked.unresolved}건: 최신 검토 내용으로 경고를 갱신했습니다.`] : []),
      ...(checked.pending ? [`재검증 필요 ${checked.pending}건: 경고를 유지했습니다. 'AI로 재검증'으로 문서를 다시 수정하지 않고 확인할 수 있습니다.`] : []),
    ].join('\n');
    reply += `\n\n정합성 재검증\n${summary}`;
  }
  return {
    reply,
    changes: changedContent ? (result?.changes?.length ? result.changes : ['문서 수정 사항 반영']) : [],
    patch,
    verification,
  };
}
