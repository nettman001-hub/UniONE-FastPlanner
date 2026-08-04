'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CornerDownLeft, Eraser, RotateCw, Sparkles, Square, Target, X } from 'lucide-react';
import { usePlannerStore } from '@/lib/store';
import { askAgent, cancelAgent, unansweredQuestion } from '@/lib/agent/runner';
import { selectableItems, useSelectionStore } from '@/lib/selection';
import { CHAT_CREDIT_COST, type Plan } from '@/lib/types';
import { Spinner, useToast } from './ui';

const SUGGESTIONS = [
  '지금 문서에서 빠진 기능이 있는지 검토해줘',
  '결제 관련 요구사항을 추가해줘',
  '비회원도 쓸 수 있는 화면을 정보구조도에 넣어줘',
  '성공 지표를 더 측정 가능하게 고쳐줘',
];

export function AgentPanel({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [input, setInput] = useState('');
  const clearChat = usePlannerStore((s) => s.clearChat);
  const credits = usePlannerStore((s) => s.credits);
  /**
   * 진행 상태를 이 컴포넌트가 아니라 스토어에서 읽는다.
   * 요청은 컴포넌트 밖에서 도므로, 패널이 사라졌다 다시 그려져도 이어서 보인다.
   */
  const busy = usePlannerStore((s) => s.agentBusy === plan.id);
  const selected = useSelectionStore((s) => s.selected);
  const setSelected = useSelectionStore((s) => s.setSelected);
  const toast = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => selectableItems(plan), [plan]);
  const outOfCredits = credits < CHAT_CREDIT_COST;

  /** 답을 받지 못한 채 남은 질문 — 새로고침이나 연결 끊김으로 요청이 사라진 경우. */
  const stranded = busy ? null : unansweredQuestion(plan.chat);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [plan.chat.length, busy]);

  const handle = (result: string) => {
    if (result === 'no-credits') toast('크레딧이 부족합니다. 내일 다시 충전됩니다.', 'warn');
    if (result === 'busy') toast('앞선 요청이 끝난 뒤에 보낼 수 있습니다.', 'warn');
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    // 선택한 항목이 있으면 무엇을 가리키는 요청인지 앞에 붙여 준다.
    const scoped = selected
      ? `[대상: ${selected.kind} ${selected.id} "${selected.label}"]\n${text.trim()}`
      : text.trim();
    setInput('');
    handle(await askAgent(plan.id, scoped));
  };

  const resend = async () => {
    if (!stranded) return;
    handle(await askAgent(plan.id, stranded, { resend: true }));
  };

  return (
    <aside className="no-print flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-[var(--primary-soft)] text-[var(--primary)]">
            <Bot size={14} />
          </span>
          <div>
            <h2 className="text-[13px] font-extrabold">AI 에이전트</h2>
            <p className="text-[11px] text-[var(--fg-muted)]">문서를 직접 고쳐 줍니다</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {plan.chat.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => clearChat(plan.id)}
              title="대화 지우기"
            >
              <Eraser size={13} />
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="닫기">
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {plan.chat.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
              현재 플랜의 모든 산출물을 읽고 답합니다. 문서를 고쳐달라고 하면 해당 산출물을 다시
              만들어 반영합니다.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left text-[12.5px] leading-snug transition hover:border-[var(--primary-border)] hover:bg-[var(--primary-soft)]"
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {plan.chat.map((message) => (
              <div
                key={message.id}
                className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[88%] rounded-xl rounded-br-sm bg-[var(--primary)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--primary-fg)]'
                      : `max-w-[92%] rounded-xl rounded-bl-sm border px-3 py-2 text-[12.5px] leading-relaxed ${
                          // 스스로 멈춘 자리는 사고가 아니다. 실패색을 쓰지 않는다.
                          message.cancelled
                            ? 'border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--fg-muted)]'
                            : message.failed
                              ? 'border-transparent bg-[var(--danger-soft)] text-[var(--danger)]'
                              : 'border-[var(--border)] bg-[var(--surface-2)]'
                        }`
                  }
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.changes && message.changes.length > 0 && (
                    <div className="mt-2 rounded-md border border-[var(--primary-border)] bg-[var(--surface)] p-2">
                      <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-[var(--primary)]">
                        <Sparkles size={11} />
                        문서 반영됨
                      </p>
                      <ul className="list-disc pl-4 text-[11.5px] text-[var(--fg-muted)]">
                        {message.changes.map((change, i) => (
                          <li key={i}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/*
              멈출 방법이 없으면, 잘못 시켰다는 걸 알아채도 끝날 때까지 기다리는 수밖에 없다.
              진행 표시 바로 옆에 둔다 — 멈추고 싶은 순간에 눈이 가 있는 자리다.
            */}
            {busy && (
              <div className="flex items-center gap-2 text-[12px] text-[var(--fg-muted)]">
                <Spinner /> 생각하는 중…
                <button
                  className="btn btn-ghost btn-sm ml-auto"
                  onClick={() => cancelAgent(plan.id)}
                  title="답변을 기다리지 않고 멈춥니다. 크레딧은 차감되지 않습니다."
                >
                  <Square size={11} />
                  멈추기
                </button>
              </div>
            )}
            {/*
              질문만 남고 답이 없다 — 창을 새로 고쳤거나 연결이 끊겨 요청이 사라진 경우다.
              그대로 두면 막다른 길이 되므로 한 번에 다시 보낼 수 있게 한다.
            */}
            {stranded && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2">
                <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
                  이 질문은 아직 답을 받지 못했습니다. 크레딧은 차감되지 않았습니다.
                </p>
                <button className="btn btn-sm" onClick={() => void resend()} disabled={outOfCredits}>
                  <RotateCw size={12} />
                  다시 보내기
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        {/* 요청 범위를 좁힐 대상 — 선택하면 입력창 위에 표시된다 */}
        {selected ? (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-2.5 py-1.5">
            <Target size={12} className="shrink-0 text-[var(--primary)]" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[var(--primary)]">
              {selected.kind} {selected.id} · {selected.label}
            </span>
            <button
              className="btn btn-ghost btn-sm shrink-0 !h-5 !px-1"
              onClick={() => setSelected(null)}
              aria-label="대상 해제"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          items.length > 0 && (
            <select
              className="select mb-2 text-[11.5px]"
              value=""
              onChange={(e) => {
                const item = items.find((i) => i.id === e.target.value);
                if (item) setSelected(item);
              }}
            >
              <option value="">대상 항목 선택 (선택 사항)</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  [{item.kind}] {item.id} {item.label}
                </option>
              ))}
            </select>
          )
        )}

        <div className="relative">
          <textarea
            className="textarea pr-11 text-[12.5px]"
            rows={3}
            placeholder={
              outOfCredits
                ? '크레딧을 모두 사용했습니다. 내일 다시 충전됩니다.'
                : '문서에 대해 묻거나, 고쳐달라고 요청하세요'
            }
            value={input}
            disabled={outOfCredits}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button
            className="btn btn-primary btn-sm absolute right-2 bottom-2"
            onClick={() => void send(input)}
            disabled={busy || outOfCredits || !input.trim()}
            aria-label="보내기"
          >
            {busy ? <Spinner size={13} /> : <CornerDownLeft size={13} />}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--fg-subtle)]">
          ⌘/Ctrl + Enter 로 전송 · 메시지당 {CHAT_CREDIT_COST} 크레딧
        </p>
      </div>
    </aside>
  );
}
