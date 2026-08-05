'use client';

import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Coins,
  Copy,
  Download,
  FileJson,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  BookOpen,
  Wand2,
} from 'lucide-react';

import { createEmptyPlan, usePlannerStore, DAILY_CREDIT_LIMIT } from '@/lib/store';
import { hasArtifact } from '@/lib/artifact-status';
import { useAiMode } from '@/lib/useGenerate';
import {
  ARTIFACT_LABEL,
  PLATFORM_LABEL,
  type ArtifactKey,
  type Plan,
  type PlanBrief,
  type Platform,
} from '@/lib/types';
import { download, slugify, toJson } from '@/lib/export';
import { ClientOnly, EmptyState, Field, Modal, Spinner, useConfirm, useToast } from '@/components/ui';
import { GuestImportBanner, RequireAuth, SyncBadge, UserMenu } from '@/components/Account';
import { Logo } from '@/components/Logo';
import { BRAND_NAME, BRAND_SHORT, BRAND_TAGLINE } from '@/lib/brand';

/* ------------------------------------------------------------------ */
/* 상수                                                                 */
/* ------------------------------------------------------------------ */

const ARTIFACT_KEYS: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];
const PLATFORM_KEYS: Platform[] = ['web', 'app', 'both', 'admin'];

const IDEA_SAMPLES = [
  '동네 반려견 산책 메이트 매칭 앱',
  '1인 창업자를 위한 간편 세금 정산 웹',
  '사내 스터디 모임 관리 도구',
  '중고 장비를 빌려주는 취미 공유 플랫폼',
];

const WIZARD_STEPS = ['무엇을 만드나요', '누구를 위한 건가요', '참고 정보(선택)'];

const EMPTY_BRIEF: PlanBrief = {
  title: '',
  oneLiner: '',
  idea: '',
  targetUser: '',
  purpose: '',
  platform: 'web',
  reference: '',
  mustHave: '',
};

/* ------------------------------------------------------------------ */
/* 헬퍼                                                                 */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '-';
  const diff = Date.now() - time;
  const minute = Math.floor(diff / 60000);
  if (minute < 1) return '방금 전';
  if (minute < 60) return `${minute}분 전`;
  const hour = Math.floor(minute / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asPlatform(value: unknown): Platform {
  return PLATFORM_KEYS.includes(value as Platform) ? (value as Platform) : 'web';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** 내보낸 JSON 을 안전하게 Plan 으로 되돌린다. 형식이 아니면 null. */
function parsePlan(text: string): Plan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Partial<Plan>;
  const brief = value.brief;
  if (!brief || typeof brief !== 'object' || typeof brief.title !== 'string') return null;

  const base = createEmptyPlan({
    title: brief.title,
    oneLiner: asString(brief.oneLiner),
    idea: asString(brief.idea),
    targetUser: asString(brief.targetUser),
    purpose: asString(brief.purpose),
    platform: asPlatform(brief.platform),
    reference: asString(brief.reference),
    mustHave: asString(brief.mustHave),
  });

  const generated = { ...base.generated };
  if (value.generated && typeof value.generated === 'object') {
    for (const key of ARTIFACT_KEYS) generated[key] = Boolean(value.generated[key]);
  }

  return {
    ...base,
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
    generated,
    prd: value.prd && typeof value.prd === 'object' ? { ...base.prd, ...value.prd } : base.prd,
    requirements: asArray(value.requirements),
    features: asArray(value.features),
    specifications: asArray(value.specifications),
    iaPages: asArray(value.iaPages),
    flows: asArray(value.flows),
    wireframes: asArray(value.wireframes),
    chat: asArray(value.chat),
    comments: asArray(value.comments),
    versions: asArray(value.versions),
  };
}

/* ------------------------------------------------------------------ */
/* 케밥 메뉴                                                            */
/* ------------------------------------------------------------------ */

interface MenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

function KebabMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm bg-[var(--surface)]"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="card fade-in absolute right-0 top-8 z-50 w-40 p-1">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-semibold hover:bg-[var(--surface-2)]"
                style={item.danger ? { color: 'var(--danger)' } : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="shrink-0 text-[var(--fg-subtle)]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 플랜 카드                                                            */
/* ------------------------------------------------------------------ */

function PlanCard({
  plan,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
}: {
  plan: Plan;
  onRename: (plan: Plan) => void;
  onDuplicate: (plan: Plan) => void;
  onExport: (plan: Plan) => void;
  onDelete: (plan: Plan) => void;
}) {
  const doneCount = ARTIFACT_KEYS.filter((key) => hasArtifact(plan, key)).length;

  return (
    <div className="relative">
      <Link
        href={`/plans/${plan.id}`}
        className="card block h-full p-4 transition-colors hover:border-[var(--border-strong)]"
      >
        <div className="flex items-start gap-2 pr-9">
          <h3 className="min-w-0 flex-1 truncate text-[14.5px] font-extrabold tracking-tight">
            {plan.brief.title || '이름 없는 플랜'}
          </h3>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[34px] text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
          {plan.brief.oneLiner || plan.brief.idea || '한 줄 소개가 아직 없습니다.'}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="chip chip-primary">{PLATFORM_LABEL[plan.brief.platform]}</span>
          <span className="chip">
            산출물 {doneCount}/{ARTIFACT_KEYS.length}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ARTIFACT_KEYS.map((key) => (
            <span
              key={key}
              className={hasArtifact(plan, key) ? 'chip chip-ok' : 'chip opacity-45'}
              title={ARTIFACT_LABEL[key]}
            >
              {hasArtifact(plan, key) && <Check size={11} />}
              {ARTIFACT_LABEL[key]}
            </span>
          ))}
        </div>

        {/*
          예전 버전에서 저장된 플랜에는 필드가 통째로 없을 수 있다. 여기서 터지면
          플랜 하나 때문에 **목록 전체가 안 그려진다.** 없는 것은 0 으로 센다.
        */}
        <p className="mt-3 text-[11.5px] text-[var(--fg-muted)]">
          요구사항 {plan.requirements?.length ?? 0} · 기능 {plan.features?.length ?? 0} · 화면{' '}
          {plan.iaPages?.length ?? 0}
        </p>
        <p className="mt-1 text-[11.5px] text-[var(--fg-subtle)]">
          최종 수정 {relativeTime(plan.updatedAt)}
        </p>
      </Link>

      <div className="absolute right-2 top-2">
        <KebabMenu
          label={`${plan.brief.title || '플랜'} 메뉴`}
          items={[
            { label: '이름 변경', icon: <Pencil size={13} />, onSelect: () => onRename(plan) },
            { label: '복제', icon: <Copy size={13} />, onSelect: () => onDuplicate(plan) },
            { label: 'JSON 내보내기', icon: <Download size={13} />, onSelect: () => onExport(plan) },
            {
              label: '삭제',
              icon: <Trash2 size={13} />,
              danger: true,
              onSelect: () => onDelete(plan),
            },
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 기획하기 위저드                                                       */
/* ------------------------------------------------------------------ */

function PlanWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const createPlan = usePlannerStore((s) => s.createPlan);
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState<PlanBrief>(EMPTY_BRIEF);

  const patch = (next: Partial<PlanBrief>) => setBrief((prev) => ({ ...prev, ...next }));

  const missing: string[] = [];
  if (!brief.title.trim()) missing.push('서비스명');
  if (!brief.idea.trim()) missing.push('서비스 아이디어');
  const step1Blocked = step === 1 && missing.length > 0;

  const close = () => {
    onClose();
    // 다음에 열 때 처음부터 시작하도록 되돌린다.
    setTimeout(() => {
      setStep(1);
      setBrief(EMPTY_BRIEF);
    }, 200);
  };

  const submit = () => {
    if (missing.length > 0) {
      setStep(1);
      return;
    }
    const id = createPlan({
      ...brief,
      title: brief.title.trim(),
      idea: brief.idea.trim(),
    });
    close();
    /*
     * `start` 는 **시작하지 않는다.** 개요 화면에서 어느 버튼을 눌러야 하는지
     * 표시만 한다. 세 단계를 채운 것과 크레딧을 쓰겠다는 것은 다른 결정이다.
     */
    router.push(`/plans/${id}?start=prd`);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      width={620}
      title="기획하기"
      description="세 단계만 채우면 AI가 나머지 문서를 이어서 만듭니다."
      footer={
        <>
          {step > 1 && (
            <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={14} />
              이전
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={step1Blocked}
              onClick={() => setStep((s) => s + 1)}
            >
              다음
              <ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={submit}>
              <Wand2 size={14} />
              플랜 만들기
            </button>
          )}
        </>
      }
    >
      <ol className="mb-5 flex items-center gap-1.5">
        {WIZARD_STEPS.map((label, index) => {
          const n = index + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  active || done
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'bg-[var(--surface-3)] text-[var(--fg-subtle)]'
                }`}
              >
                {done ? <Check size={12} /> : n}
              </span>
              <span
                className={`truncate text-[11.5px] font-bold ${
                  active ? 'text-[var(--fg)]' : 'text-[var(--fg-subtle)]'
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="flex flex-col gap-3.5">
          <Field label="서비스명" required>
            <input
              className="input"
              autoFocus
              value={brief.title}
              placeholder="예: 멍메이트"
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field label="한 줄 소개">
            <input
              className="input"
              value={brief.oneLiner}
              placeholder="예: 우리 동네 산책 친구를 찾아주는 반려견 매칭 서비스"
              onChange={(e) => patch({ oneLiner: e.target.value })}
            />
          </Field>
          <Field label="서비스 아이디어" required hint="자세할수록 더 정확한 산출물이 나옵니다.">
            <textarea
              className="textarea"
              rows={5}
              value={brief.idea}
              placeholder="어떤 문제를 어떻게 풀어주는 서비스인지 적어 주세요."
              onChange={(e) => patch({ idea: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {IDEA_SAMPLES.map((sample) => (
              <button
                key={sample}
                type="button"
                className="chip hover:border-[var(--primary-border)] hover:text-[var(--primary)]"
                onClick={() => patch({ idea: sample })}
              >
                <Sparkles size={11} />
                {sample}
              </button>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="text-[11.5px] text-[var(--fg-subtle)]">
              {missing.join(' · ')}을(를) 입력하면 다음 단계로 넘어갈 수 있습니다.
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3.5">
          <Field label="타겟 사용자" hint="비워 두면 AI가 아이디어를 보고 추정합니다.">
            <input
              className="input"
              autoFocus
              value={brief.targetUser}
              placeholder="예: 서울에 사는 20~30대 1인 가구 반려인"
              onChange={(e) => patch({ targetUser: e.target.value })}
            />
          </Field>
          <Field label="기획 목적">
            <input
              className="input"
              value={brief.purpose}
              placeholder="예: MVP 범위를 정하고 개발 견적을 받기 위해"
              onChange={(e) => patch({ purpose: e.target.value })}
            />
          </Field>
          <Field label="플랫폼">
            <select
              className="select"
              value={brief.platform}
              onChange={(e) => patch({ platform: asPlatform(e.target.value) })}
            >
              {PLATFORM_KEYS.map((key) => (
                <option key={key} value={key}>
                  {PLATFORM_LABEL[key]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3.5">
          <Field label="참고 서비스" hint="비슷하게 만들고 싶은 서비스가 있다면 적어 주세요.">
            <input
              className="input"
              autoFocus
              value={brief.reference ?? ''}
              placeholder="예: 당근마켓, 스트라바"
              onChange={(e) => patch({ reference: e.target.value })}
            />
          </Field>
          <Field label="반드시 포함할 기능">
            <textarea
              className="textarea"
              rows={4}
              value={brief.mustHave ?? ''}
              placeholder="예: 위치 기반 매칭, 산책 일지, 신고하기"
              onChange={(e) => patch({ mustHave: e.target.value })}
            />
          </Field>
          {/*
            예전에는 여기 "PRD도 바로 생성하기" 체크박스가 있었고 기본이 켜짐이었다.
            그래서 `플랜 만들기` 를 누른 순간 생성이 시작되고 크레딧이 나갔다.
            시작은 다음 화면에서 사용자가 직접 누른다.
          */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
            <p className="text-[12.5px] font-bold">다음 화면에서 시작하실 수 있습니다</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
              플랜을 만들면 개요로 넘어갑니다. 프로덕트 요구사항의{' '}
              <span className="font-semibold text-[var(--fg)]">AI로 생성</span> 버튼을 표시해 드리니,
              준비되셨을 때 누르세요. 크레딧은 그때부터 듭니다.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 홈                                                                   */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  return (
    <RequireAuth>
      <Home />
    </RequireAuth>
  );
}

function Home() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { mode } = useAiMode();

  const plans = usePlannerStore((s) => s.plans);
  const credits = usePlannerStore((s) => s.credits);
  const importPlan = usePlannerStore((s) => s.importPlan);
  const deletePlan = usePlannerStore((s) => s.deletePlan);
  const renamePlan = usePlannerStore((s) => s.renamePlan);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.json'));
    if (list.length === 0) {
      toast('JSON 파일만 가져올 수 있습니다.', 'warn');
      return;
    }
    let ok = 0;
    for (const file of list) {
      const parsed = parsePlan(await file.text());
      if (!parsed) {
        toast(`${file.name} 은(는) ${BRAND_SHORT} 플랜 형식이 아닙니다.`, 'danger');
        continue;
      }
      importPlan(parsed);
      ok += 1;
    }
    if (ok > 0) toast(`플랜 ${ok}개를 가져왔습니다.`, 'ok');
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void importFiles(e.dataTransfer.files);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void importFiles(e.target.files);
    e.target.value = '';
  };

  const handleDuplicate = (plan: Plan) => {
    importPlan({ ...plan, brief: { ...plan.brief, title: `${plan.brief.title} 복사본` } });
    toast('플랜을 복제했습니다.', 'ok');
  };

  const handleExport = (plan: Plan) => {
    download(
      `${slugify(plan.brief.title)}.uniboard.json`,
      toJson(plan),
      'application/json;charset=utf-8',
    );
    toast('JSON 파일을 내려받았습니다.', 'ok');
  };

  const handleDelete = async (plan: Plan) => {
    const ok = await confirm({
      title: '플랜을 삭제할까요?',
      message: `"${plan.brief.title}" 의 모든 산출물이 함께 삭제됩니다. 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    deletePlan(plan.id);
    toast('플랜을 삭제했습니다.', 'ok');
  };

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) {
      toast('서비스명을 입력해 주세요.', 'warn');
      return;
    }
    renamePlan(renaming.id, title);
    setRenaming(null);
    toast('이름을 변경했습니다.', 'ok');
  };

  return (
    <div
      className="mx-auto w-full max-w-5xl p-4 sm:p-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* 히어로 */}
      <header className="flex flex-col gap-4 py-6 sm:py-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-primary">
            <Logo size={12} />
            {BRAND_SHORT}
          </span>
          <SyncBadge />
          {mode === 'ai' && (
            <span className="chip chip-primary" title="AI 가 산출물을 생성합니다.">
              <Sparkles size={11} />
              AI 생성
            </span>
          )}
          {mode === 'local' && <span className="chip">기본 생성기</span>}
          <ClientOnly>
            <span
              className="chip"
              title={`하루 ${DAILY_CREDIT_LIMIT} 크레딧이 충전됩니다. 임시로 열어 둔 한도입니다.`}
            >
              <Coins size={11} />
              크레딧 {credits}/{DAILY_CREDIT_LIMIT}
              <span className="font-normal text-[var(--fg-subtle)]">(임시)</span>
            </span>
          </ClientOnly>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>

        <div>
          <h1 className="flex items-center gap-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[34px]">
            <Logo size={40} className="sm:!size-12" />
            {BRAND_NAME}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--fg-muted)] sm:text-[15px]">
            {BRAND_TAGLINE}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setWizardOpen(true)}>
            <Plus size={15} />
            기획하기
          </button>
          <button type="button" className="btn btn-lg" onClick={() => fileRef.current?.click()}>
            <Upload size={15} />
            플랜 가져오기
          </button>
          <Link href="/docs" className="btn btn-lg">
            <BookOpen size={15} />
            설명서
          </Link>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        {mode === 'local' && (
          <div
            className="card px-4 py-3 text-[12.5px] leading-relaxed"
            style={{
              background: 'var(--warn-soft)',
              borderColor: 'transparent',
              color: 'var(--warn)',
            }}
          >
            지금은 AI 생성을 쓸 수 없어 기본 생성기로 문서를 만듭니다. 구조는 같지만 내용이
            일반적입니다. 편집·검증·내보내기는 모두 그대로 쓰실 수 있습니다.
          </div>
        )}
      </header>

      {/* 플랜 목록 */}
      <section className="mt-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title flex items-center gap-1.5">
            <LayoutGrid size={14} />내 플랜
          </h2>
          <ClientOnly>
            <span className="text-[11.5px] text-[var(--fg-subtle)]">총 {plans.length}개</span>
          </ClientOnly>
        </div>

        <GuestImportBanner />

        {dragging && (
          <div className="card mb-3 flex items-center justify-center gap-2 border-dashed px-4 py-6 text-[12.5px] font-semibold text-[var(--primary)]">
            <FileJson size={15} />
            여기에 JSON 파일을 놓으면 플랜을 가져옵니다.
          </div>
        )}

        <ClientOnly
          fallback={
            <div className="empty">
              <Spinner size={16} />
            </div>
          }
        >
          {plans.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<ClipboardList size={26} />}
                title="첫 플랜을 만들어 보세요"
                description="서비스 아이디어 한 줄이면 충분합니다. 내보낸 JSON 파일을 이 화면에 끌어다 놓아 복원할 수도 있습니다."
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setWizardOpen(true)}
                  >
                    <Plus size={14} />새 플랜 만들기
                  </button>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onRename={(p) => setRenaming({ id: p.id, title: p.brief.title })}
                  onDuplicate={handleDuplicate}
                  onExport={handleExport}
                  onDelete={(p) => void handleDelete(p)}
                />
              ))}
            </div>
          )}
        </ClientOnly>
      </section>

      {/* 사용 흐름 */}
      <section className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          {
            step: '①',
            title: '아이디어 입력',
            body: '서비스명과 아이디어, 타겟 사용자만 적으면 준비 끝입니다.',
          },
          {
            step: '②',
            title: 'AI가 5종 산출물 생성',
            body: 'PRD · 기능명세서 · 정보구조도 · 유저 플로우 · 와이어프레임을 이어서 만듭니다.',
          },
          {
            step: '③',
            title: '편집·검증 후 내보내기',
            body: '직접 다듬고 검증한 뒤 마크다운 · CSV · JSON 으로 가져갑니다.',
          },
        ].map((item) => (
          <div key={item.title} className="card p-4">
            <p className="text-[13px] font-extrabold text-[var(--primary)]">{item.step}</p>
            <p className="mt-1 text-[13.5px] font-bold">{item.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-muted)]">{item.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-8 border-t border-[var(--border)] py-6 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
        플랜은 브라우저에서 먼저 저장된 뒤 계정으로 올라갑니다. 인터넷이 끊겨도 작업은
        계속되고, 연결되면 이어서 저장됩니다.
      </footer>

      <PlanWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <Modal
        open={renaming !== null}
        title="이름 변경"
        onClose={() => setRenaming(null)}
        width={440}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRenaming(null)}>
              취소
            </button>
            <button type="button" className="btn btn-primary" onClick={commitRename}>
              저장
            </button>
          </>
        }
      >
        <Field label="서비스명" required>
          <input
            className="input"
            autoFocus
            value={renaming?.title ?? ''}
            placeholder="서비스명을 입력하세요"
            onChange={(e) =>
              setRenaming((prev) => (prev ? { ...prev, title: e.target.value } : prev))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
            }}
          />
        </Field>
      </Modal>

      {dialog}
    </div>
  );
}
