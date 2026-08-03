'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Loader2, Plus, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* 토스트                                                               */
/* ------------------------------------------------------------------ */

type ToastTone = 'info' | 'ok' | 'warn' | 'danger';
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    counter.current += 1;
    const id = counter.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-5 left-1/2 z-[100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="card fade-in pointer-events-auto flex items-start gap-2 px-3.5 py-2.5 text-[13px] leading-relaxed"
            style={{ boxShadow: 'var(--shadow-lg)' }}
            role="status"
          >
            <span className="mt-0.5 shrink-0">
              {toast.tone === 'ok' ? (
                <Check size={15} className="text-[var(--ok)]" />
              ) : toast.tone === 'danger' || toast.tone === 'warn' ? (
                <AlertTriangle
                  size={15}
                  className={toast.tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--warn)]'}
                />
              ) : (
                <span className="block size-[15px] rounded-full bg-[var(--primary)]" />
              )}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{toast.message}</span>
            <button
              className="btn-ghost -mr-1 -mt-0.5 rounded p-1 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              aria-label="닫기"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* 모달                                                                 */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="no-print fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card fade-in w-full"
        style={{ maxWidth: width, boxShadow: 'var(--shadow-lg)' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>
            {description && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                {description}
              </p>
            )}
          </div>
          <button className="btn btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="닫기">
            <X size={15} />
          </button>
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 폼 필드                                                              */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="label">
        {label}
        {required && <span className="ml-1 text-[var(--danger)]">*</span>}
      </span>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">{hint}</p>}
    </div>
  );
}

/** 저장 시점에 커밋되는 인라인 텍스트 편집기. */
export function InlineText({
  value,
  onChange,
  placeholder,
  multiline,
  className = '',
  rows,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  const commit = () => {
    dirty.current = false;
    if (draft !== value) onChange(draft);
  };

  if (multiline) {
    return (
      <textarea
        className={`textarea ${className}`}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          dirty.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <input
      className={`input ${className}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        dirty.current = true;
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** 문자열 배열을 한 줄씩 편집하는 위젯. */
export function ListEditor({
  items,
  onChange,
  placeholder = '항목 입력',
  addLabel = '항목 추가',
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, index) => (
        <div key={`${id}-${index}`} className="flex items-center gap-1.5">
          <span className="w-5 shrink-0 text-right text-[11px] font-semibold text-[var(--fg-subtle)]">
            {index + 1}
          </span>
          <InlineText
            value={item}
            placeholder={placeholder}
            onChange={(next) => {
              const copy = [...items];
              copy[index] = next;
              onChange(copy);
            }}
          />
          <button
            className="btn btn-ghost btn-sm shrink-0"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            aria-label={`${index + 1}번 항목 삭제`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm self-start" onClick={() => onChange([...items, ''])}>
        <Plus size={13} />
        {addLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 기타                                                                 */
/* ------------------------------------------------------------------ */

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />;
}

export function SectionCard({
  title,
  action,
  children,
  description,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="section-title">{title}</h3>
          {description && (
            <p className="mt-0.5 text-[11.5px] text-[var(--fg-muted)]">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="text-[var(--fg-subtle)]">{icon}</div>}
      <p className="text-[13.5px] font-bold text-[var(--fg)]">{title}</p>
      {description && (
        <p className="max-w-md text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** 클라이언트에서만 렌더링해 localStorage 하이드레이션 불일치를 막는다. */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    resolve?: (ok: boolean) => void;
  }>({ open: false, title: '', message: '', confirmLabel: '확인', danger: false });

  const confirm = useCallback(
    (options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        setState({
          open: true,
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? '확인',
          danger: options.danger ?? false,
          resolve,
        });
      }),
    [],
  );

  const close = (ok: boolean) => {
    state.resolve?.(ok);
    setState((prev) => ({ ...prev, open: false, resolve: undefined }));
  };

  const dialog = (
    <Modal
      open={state.open}
      title={state.title}
      onClose={() => close(false)}
      width={440}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            취소
          </button>
          <button
            className="btn btn-primary"
            style={
              state.danger
                ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }
                : undefined
            }
            onClick={() => close(true)}
          >
            {state.confirmLabel}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {state.message}
      </p>
    </Modal>
  );

  // confirm 은 useCallback 으로 고정되어 있고 dialog 는 매 렌더 새로 만들어지는 엘리먼트라
  // 메모이제이션할 대상이 아니다. 그대로 돌려준다.
  return { confirm, dialog };
}
