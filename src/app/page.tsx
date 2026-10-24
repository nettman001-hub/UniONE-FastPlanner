'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
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

import { usePlannerStore } from '@/lib/store';
import { useCredits } from '@/lib/useCredits';
import { hasArtifact } from '@/lib/artifact-status';
import { useAiMode } from '@/lib/useGenerate';
import {
  ARTIFACT_LABEL,
  PLATFORM_LABEL,
  type ArchetypeKey,
  type ArtifactKey,
  type BriefStructure,
  type BriefSummary,
  type Plan,
  type PlanBrief,
  type Platform,
} from '@/lib/types';
import { download, slugify, toJson } from '@/lib/export';
import { asPlatform, parsePlan } from '@/lib/plan-file';
import { ClientOnly, EmptyState, Field, Modal, Spinner, useConfirm, useToast } from '@/components/ui';
import { GuestImportBanner, RequireAuth, SyncBadge, UserMenu } from '@/components/Account';
import { HeaderAiStatus } from '@/components/HeaderAiStatus';
import { Logo } from '@/components/Logo';
import { BRAND_NAME, BRAND_SHORT, BRAND_TAGLINE } from '@/lib/brand';
import {
  UNSURE,
  UNSURE_LABEL,
  questionsForStep,
  recommendedChoices,
  visibleQuestions,
  type BriefQuestion,
} from '@/lib/brief-questions';
import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  CAUTIONS,
  IDEA_LINES,
  guessStructure,
  ideaHasContent,
  ideaLineFilled,
  insertIdeaLine,
  normalizeStructure,
  stripEmptyIdeaLines,
} from '@/lib/archetypes';
import { ENGINE_LABEL, ENGINE_TIERS, ENGINE_WHAT, type EngineTier } from '@/lib/ai/engines';
import { setEnginesLocally, useEngines, type EngineMap } from '@/lib/useEngine';

/* ------------------------------------------------------------------ */
/* 상수                                                                 */
/* ------------------------------------------------------------------ */

const ARTIFACT_KEYS: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];
const PLATFORM_KEYS: Platform[] = ['web', 'app', 'both', 'admin', 'windows'];

/**
 * 예시는 **서비스명과 아이디어를 함께** 채운다. 아이디어만 채우면 서비스명이 비어
 * `다음` 이 막혀, 눌러 본 사람이 거기서 멈췄다. 아이디어는 줄 형식으로 보여 주어
 * 무엇을 적으면 되는지를 예시가 대신 알려 준다.
 */
const IDEA_SAMPLES = [
  {
    label: '반려견 산책 매칭',
    title: '멍메이트',
    idea: '해결할 문제: 혼자 사는 반려인은 함께 산책할 이웃을 찾기 어렵다\n해결 방법: 동네와 산책 시간이 맞는 견주를 이어 준다\n핵심 행동: 근처 메이트 찾기 → 산책 요청 → 함께 산책 → 후기 남기기',
  },
  {
    label: '1인 창업 세금 정산',
    title: '셀프택스',
    idea: '해결할 문제: 1인 창업자는 매출·경비를 정리해 세금 신고를 준비하기 번거롭다\n해결 방법: 매출과 경비를 기록하면 신고에 필요한 금액을 자동으로 정리해 준다\n핵심 행동: 영수증 기록 → 월별 집계 확인 → 신고 자료 내려받기',
  },
  {
    label: '사내 스터디 관리',
    title: '스터디룸',
    idea: '해결할 문제: 사내 스터디 모임의 일정·출석·자료가 메신저에 흩어져 있다\n해결 방법: 모임별로 일정, 출석, 자료를 한곳에서 관리한다\n핵심 행동: 스터디 만들기 → 팀원 초대 → 일정 등록 → 출석 체크',
  },
  {
    label: '취미 장비 대여',
    title: '빌려써',
    idea: '해결할 문제: 가끔 쓰는 캠핑·촬영 장비는 사기엔 비싸고 빌릴 곳이 없다\n해결 방법: 장비를 가진 이웃과 필요한 사람을 이어 주고 대여 기간을 관리한다\n핵심 행동: 장비 검색 → 대여 요청 → 수락 → 반납 확인',
  },
];

/**
 * 다섯 단계지만 **필수는 1단계뿐이다.**
 *
 * 질문을 늘리면 이탈이 는다. 그래서 4·5단계는 고르기만 하면 되게 만들고,
 * 어느 단계에서든 `이대로 만들기` 로 빠져나올 수 있게 둔다. 질문이 늘어난 게
 * 아니라 **원하면 더 답할 수 있게** 된 것이어야 한다.
 */
const WIZARD_STEPS = [
  '무엇을 만드나요',
  '누구를 위해',
  '참고 정보',
  '몇 가지만 더',
  '확인할 것',
  '이해한 내용',
];
const LAST_STEP = WIZARD_STEPS.length;

/** AI 가 되물은 질문 하나와 사용자의 답. */
interface Followup {
  question: string;
  why: string;
  choices: string[];
  answer: string;
  /** 질문이 다루는 영역(정책·규칙, 예외 상황 …) */
  area?: string;
  /** 보기 중 AI 가 추천하는 것과 그 이유 */
  recommended?: string;
  recommendReason?: string;
  /** 2 면 답한 것에서 이어 물은 꼬리 질문 */
  round?: 1 | 2;
}

type SummaryState = 'idle' | 'loading' | 'done' | 'failed';

/** 문서 깊이 표시의 이름. 답할수록 오른쪽으로 간다. */
const DEPTH_LABEL = ['기본', '충분', '상세'] as const;

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

/** 구조 추정 API 가 주는 '비어 있는 줄' 후보. */
interface StructureSuggestion {
  line: string;
  text: string;
}

type StructureState = 'idle' | 'loading' | 'done' | 'failed';

const SOURCE_LABEL: Record<BriefStructure['source'], string> = {
  user: '확인함',
  ai: 'AI 추정',
  rule: '키워드로 추정 — 확인해 주세요',
};

function archetypeChip(key: ArchetypeKey) {
  return `${ARCHETYPES[key].emoji} ${ARCHETYPES[key].label}`;
}

/**
 * 1단계의 서비스 구조 칸.
 *
 * **숨기지 않는다.** 구조는 문서 전체의 뼈대를 바꾸는데, 생성 뒤에는 브리프를 고칠 수
 * 없다. 틀린 추정을 바로잡을 기회는 여기뿐이다. 그래서 무엇으로 읽었는지와 함께
 * "문서에 무엇이 들어가는지" 를 보여 준다 — 사용자가 맞는지 판단할 근거다.
 */
function StructurePanel({
  structure,
  state,
  stale,
  ready,
  onChange,
  onGenerate,
}: {
  structure: BriefStructure | undefined;
  state: StructureState;
  /** 구조를 만든 뒤 아이디어가 바뀌었다 */
  stale: boolean;
  /** 아이디어가 읽을 만큼 적혔는가 */
  ready: boolean;
  onChange: (next: BriefStructure | undefined) => void;
  /** `서비스 구조 생성하기` — 이것을 눌렀을 때만 AI 가 읽는다 */
  onGenerate: () => void;
}) {
  const [picking, setPicking] = useState<null | 'primary' | 'secondary'>(null);

  const pick = (key: ArchetypeKey | 'none') => {
    if (picking === 'secondary' && structure && key !== 'none') {
      onChange({ ...structure, secondary: key === structure.primary ? undefined : key, source: 'user' });
    } else {
      onChange({
        primary: key,
        ...(key !== 'none' && structure?.secondary && structure.secondary !== key
          ? { secondary: structure.secondary }
          : {}),
        ...(key === 'matching' ? { twoSided: structure?.twoSided ?? true } : {}),
        ...(structure?.cautions ? { cautions: structure.cautions } : {}),
        source: 'user',
      });
    }
    setPicking(null);
  };

  const main = structure && structure.primary !== 'none' ? ARCHETYPES[structure.primary] : null;
  const sub = structure?.secondary ? ARCHETYPES[structure.secondary] : null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[12.5px] font-bold">서비스 구조</p>
        {structure && state !== 'loading' && (
          <span className="text-[11px] text-[var(--fg-subtle)]">{SOURCE_LABEL[structure.source]}</span>
        )}
        <span className="flex-1" />
        {state !== 'loading' && (
          <button
            type="button"
            className={structure ? 'btn btn-sm' : 'btn btn-primary btn-sm'}
            disabled={!ready}
            title={ready ? undefined : '아이디어를 15자 이상 적으면 누를 수 있습니다'}
            onClick={onGenerate}
          >
            <Sparkles size={12} />
            {structure ? '다시 생성' : '서비스 구조 생성하기'}
          </button>
        )}
        {structure && structure.source !== 'user' && state !== 'loading' && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onChange({ ...structure, source: 'user' })}
          >
            <Check size={12} />
            맞아요
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setPicking(picking ? null : 'primary')}
        >
          {picking ? '닫기' : structure ? '바꾸기' : '직접 고르기'}
        </button>
      </div>

      {state === 'loading' && (
        <p className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--fg-muted)]">
          <Spinner size={12} />
          서비스 구조를 만드는 중… 기다리지 않고 넘어가셔도 됩니다.
        </p>
      )}

      {state !== 'loading' && !structure && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--fg-subtle)]">
          {state === 'failed'
            ? '구조를 읽지 못했습니다. 직접 골라 주시면 문서의 뼈대가 정확해집니다.'
            : ready
              ? '아이디어를 다 적으셨으면 서비스 구조 생성하기를 눌러 주세요. 직접 고르셔도 됩니다.'
              : '아이디어를 다 적은 뒤 서비스 구조를 만들어 드립니다. 직접 고르셔도 됩니다.'}
        </p>
      )}

      {state !== 'loading' && structure && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {main ? (
              <span className="chip chip-primary">
                {archetypeChip(main.key)} <span className="opacity-70">주</span>
              </span>
            ) : (
              <span className="chip">해당 없음 — 구조 지침 없이 만듭니다</span>
            )}
            {sub && (
              <span className="chip">
                {archetypeChip(sub.key)} <span className="opacity-70">보조</span>
                <button
                  type="button"
                  aria-label="보조 유형 빼기"
                  className="ml-0.5 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
                  onClick={() => onChange({ ...structure, secondary: undefined, source: 'user' })}
                >
                  ×
                </button>
              </span>
            )}
            {main && !sub && (
              <button
                type="button"
                className="text-[11.5px] font-semibold text-[var(--primary)]"
                onClick={() => setPicking('secondary')}
              >
                + 보조 유형
              </button>
            )}
          </div>
          {structure.reason && (
            <p className="text-[11.5px] leading-relaxed text-[var(--fg-muted)]">{structure.reason}</p>
          )}
          {main && (
            <p className="text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
              <span className="font-semibold text-[var(--fg)]">문서에 반영:</span> {main.preview}
              {sub ? ` · ${sub.preview.split(' · ')[0]}` : ''}
            </p>
          )}
          {structure.primary === 'matching' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { value: true, label: '제공하는 쪽이 따로 있음' },
                { value: false, label: '같은 처지끼리' },
              ].map((option) => {
                const on = (structure.twoSided ?? true) === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={on ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                    onClick={() => onChange({ ...structure, twoSided: option.value, source: 'user' })}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
          {(structure.cautions ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
              함께 고려:
              {(structure.cautions ?? []).map((key) => (
                <span key={key} className="chip">
                  {CAUTIONS[key].label}
                  <button
                    type="button"
                    aria-label={`${CAUTIONS[key].label} 빼기`}
                    className="ml-0.5 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
                    onClick={() =>
                      onChange({ ...structure, cautions: (structure.cautions ?? []).filter((c) => c !== key) })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {stale && (
            <p className="text-[11.5px] text-[var(--fg-muted)]">
              아이디어가 바뀌었습니다.{' '}
              <button type="button" className="font-semibold text-[var(--primary)]" onClick={onGenerate}>
                다시 생성
              </button>
            </p>
          )}
        </div>
      )}

      {picking && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {ARCHETYPE_KEYS.filter((key) => picking === 'primary' || key !== structure?.primary).map((key) => (
            <button
              key={key}
              type="button"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-left hover:border-[var(--primary-border)]"
              onClick={() => pick(key)}
            >
              <span className="block text-[12.5px] font-bold">{archetypeChip(key)}</span>
              <span className="block text-[11px] leading-snug text-[var(--fg-subtle)]">
                {ARCHETYPES[key].examples}
              </span>
            </button>
          ))}
          {picking === 'primary' && (
            <button
              type="button"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-left hover:border-[var(--primary-border)]"
              onClick={() => pick('none')}
            >
              <span className="block text-[12.5px] font-bold">해당 없음</span>
              <span className="block text-[11px] leading-snug text-[var(--fg-subtle)]">게임, 기기 연동 등</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlanWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const createPlan = usePlannerStore((s) => s.createPlan);
  const toast = useToast();
  const engines = useEngines();
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState<PlanBrief>(EMPTY_BRIEF);
  const [planEngine, setPlanEngine] = useState<EngineTier>('basic');
  const [submitting, setSubmitting] = useState(false);
  /** AI 가 되물은 질문. 3단계를 지날 때 만들어 둔다. */
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [asking, setAsking] = useState(false);
  /** 질문이 없을 때 왜 없는지. 빈 화면만 보여 주면 고장인지 아닌지 알 수 없다. */
  const [askReason, setAskReason] = useState('');
  const askedFor = useRef('');
  const lastStepTimeRef = useRef(0);
  const wizardBodyRef = useRef<HTMLDivElement>(null);
  const ideaRef = useRef<HTMLTextAreaElement>(null);

  /* 서비스 구조 추정 */
  const [structureState, setStructureState] = useState<StructureState>('idle');
  const [suggestions, setSuggestions] = useState<StructureSuggestion[]>([]);

  /* 2~6단계 */
  const [followupRound, setFollowupRound] = useState<1 | 2>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [summaryState, setSummaryState] = useState<SummaryState>('idle');
  const [summaryReason, setSummaryReason] = useState('');
  const summaryFor = useRef('');
  const structureSeed = useRef('');
  const structureAbort = useRef<AbortController | null>(null);
  /** 응답이 왔을 때의 최신 브리프. 응답을 기다리는 사이 사용자가 구조를 직접 골랐을 수 있다. */
  const briefRef = useRef(brief);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);

  /**
   * 단계가 바뀔 때마다:
   * 1) 포커스를 해제하여 스페이스바나 엔터 키로 버튼이 예기치 않게 재클릭되는 것 방지
   * 2) 모달 스크롤 컨테이너를 맨 위로 올려 다음 단계 질문을 처음부터 보도록 처리
   */
  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const scrollContainer = wizardBodyRef.current?.closest('.overflow-y-auto');
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }, [step]);

  /**
   * 이전에 다섯 단계에 같은 엔진을 골라 두었다면 다음 기획의 기본 선택으로
   * 보여 준다. 단계별 설정이 섞여 있으면 예기치 않게 비싼 쪽을 고르지 않도록
   * 기본 엔진으로 시작한다.
   */
  useEffect(() => {
    if (!open) return;
    const values = ARTIFACT_KEYS.map((key) => engines[key]);
    setPlanEngine(values.every((value) => value === values[0]) ? values[0] : 'basic');
  }, [engines, open]);

  const patch = (next: Partial<PlanBrief>) => setBrief((prev) => ({ ...prev, ...next }));

  /**
   * 아이디어를 읽고 서비스 구조를 추정한다. **사용자가 `서비스 구조 생성하기` 를 눌렀을 때만** 부른다.
   *
   * 예전에는 입력이 멈출 때마다 저절로 불렀다. 쓰는 도중의 반쪽짜리 아이디어로 추정이 계속
   * 바뀌어 산만했고, 서비스명을 고칠 때도 다시 불렸다. 다 쓴 뒤에 한 번 부르는 것이 맞다.
   * 실패하거나 15초가 지나면 키워드로 추정한다.
   */
  const readStructure = async () => {
    const { title, idea } = briefRef.current;
    if (idea.trim().length < 15) return;
    structureSeed.current = idea.trim();

    structureAbort.current?.abort();
    const controller = new AbortController();
    structureAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    setStructureState('loading');

    let next: BriefStructure | undefined;
    let nextSuggestions: StructureSuggestion[] = [];
    try {
      const res = await fetch('/api/brief/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, idea }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { structure?: unknown; suggestions?: StructureSuggestion[] };
      next = normalizeStructure(data.structure);
      nextSuggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    } catch {
      // 뒤 요청에 밀려 끊긴 것이면 그쪽이 결과를 낸다.
      if (structureAbort.current !== controller) return;
      next = guessStructure(`${title} ${idea}`);
    } finally {
      clearTimeout(timer);
    }
    if (structureAbort.current !== controller) return;

    setSuggestions(nextSuggestions);
    setStructureState(next ? 'done' : 'failed');
    if (next) setBrief((prev) => ({ ...prev, structure: next }));
  };

  /** 아이디어 줄을 넣고 그 자리로 커서를 옮긴다. 쓰던 글은 덮지 않는다. */
  const addIdeaLine = (label: string, text = '') => {
    const { idea, cursor } = insertIdeaLine(brief.idea, label, text);
    patch({ idea });
    requestAnimationFrame(() => {
      const el = ideaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const answers = brief.answers ?? {};
  const pick = (key: string, value: string, multi: boolean) =>
    setBrief((prev) => {
      const current = (prev.answers?.[key] ?? []).filter((v) => v !== UNSURE);
      const next = multi
        ? current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value]
        : current.includes(value)
          ? []
          : [value];
      return { ...prev, answers: { ...prev.answers, [key]: next } };
    });

  /**
   * 아이디어를 읽고 되물을 것을 만들어 둔다.
   *
   * 4단계로 넘어갈 때 **미리** 부른다. 5단계에 도착해서 부르면 사용자가 빈 화면을
   * 보며 기다리게 된다. 아이디어·답·구조가 그대로면 다시 부르지 않는다.
   */
  const askFollowups = async (force = false) => {
    const seed = `${brief.idea}|${JSON.stringify(brief.answers ?? {})}|${JSON.stringify(brief.structure ?? null)}`;
    if (!force && askedFor.current === seed) return;
    askedFor.current = seed;
    setAsking(true);
    setAskReason('');
    try {
      const res = await fetch('/api/brief/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = (await res.json()) as { questions?: Followup[]; reason?: string };
      const next = (data.questions ?? []).map((q) => ({ ...q, answer: '', round: 1 as const }));
      setFollowups(next);
      setFollowupRound(1);
      if (next.length === 0) setAskReason(data.reason ?? '여쭤볼 것을 찾지 못했습니다.');
    } catch {
      setFollowups([]);
      setAskReason('여쭤볼 것을 만들지 못했습니다. 그냥 진행하셔도 됩니다.');
    } finally {
      setAsking(false);
    }
  };

  /**
   * 답한 것에서 이어지는 꼬리 질문을 한 번 더 받는다. 기존 질문은 그대로 두고 뒤에 붙인다.
   * "보증금으로 처리" 같은 결정을 실제로 구현하려면 무엇을 더 정해야 하는지를 묻는다.
   */
  const askMore = async () => {
    setAsking(true);
    try {
      const res = await fetch('/api/brief/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: { ...brief, followups: followups.map((f) => ({ question: f.question, answer: f.answer })) },
          round: 2,
        }),
      });
      const data = (await res.json()) as { questions?: Followup[]; reason?: string };
      const more = (data.questions ?? []).map((q) => ({ ...q, answer: '', round: 2 as const }));
      if (more.length === 0) toast(data.reason ?? '더 여쭤볼 것이 없습니다.');
      setFollowups((prev) => [...prev, ...more.filter((q) => !prev.some((p) => p.question === q.question))]);
    } catch {
      toast('더 여쭤볼 것을 만들지 못했습니다.', 'danger');
    } finally {
      setFollowupRound(2);
      setAsking(false);
    }
  };

  /**
   * 마지막 단계의 '이해한 내용' 을 만든다. 들어설 때 한 번, 앞 단계 내용이 바뀌었으면 다시.
   * 사용자가 고친 요약은 `다시 정리하기` 를 누르기 전에는 덮지 않는다.
   */
  const makeSummary = async (force = false) => {
    const seed = JSON.stringify({ ...brief, summary: undefined, followups });
    if (!force && summaryFor.current === seed) return;
    summaryFor.current = seed;
    setSummaryState('loading');
    setSummaryReason('');
    try {
      const res = await fetch('/api/brief/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: { ...brief, followups: followups.map((f) => ({ question: f.question, answer: f.answer })) },
        }),
      });
      const data = (await res.json()) as { summary?: BriefSummary | null; reason?: string };
      if (data.summary) {
        patch({ summary: data.summary });
        setSummaryState('done');
      } else {
        patch({ summary: undefined });
        setSummaryReason(data.reason ?? '');
        setSummaryState('failed');
      }
    } catch {
      setSummaryReason('요약을 만들지 못했습니다.');
      setSummaryState('failed');
    }
  };

  /** 사용자가 고친 줄은 더 이상 추정이 아니다. */
  const updateSummaryLine = (index: number, text: string) =>
    setBrief((prev) =>
      prev.summary
        ? {
            ...prev,
            summary: {
              ...prev.summary,
              lines: prev.summary.lines.map((l, i) => (i === index ? { ...l, text, assumed: false } : l)),
            },
          }
        : prev,
    );
  const updateAssumption = (index: number, text: string) =>
    setBrief((prev) => {
      if (!prev.summary) return prev;
      const assumptions = [...prev.summary.assumptions];
      assumptions[index] = text;
      return { ...prev, summary: { ...prev.summary, assumptions } };
    });
  const removeAssumption = (index: number) =>
    setBrief((prev) =>
      prev.summary
        ? { ...prev, summary: { ...prev.summary, assumptions: prev.summary.assumptions.filter((_, i) => i !== index) } }
        : prev,
    );

  /** 질문 하나. 2단계와 4단계가 같이 쓴다. */
  const renderQuestion = (q: BriefQuestion) => {
    const typeKey = q.types?.find((t) => t === structure?.primary || t === structure?.secondary);
    const picked = answers[q.key] ?? [];
    const unsure = picked.includes(UNSURE);
    return (
      <div key={q.key}>
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold">
          {q.ask}
          {typeKey && <span className="chip text-[10.5px] font-semibold">{archetypeChip(typeKey)}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">{q.why}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {q.choices.map((c) => {
            const on = picked.includes(c.value);
            const rec = !on && (recommended[q.key] ?? []).includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                className={on ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => pick(q.key, c.value, q.multi)}
                title={c.effect}
              >
                {on && <Check size={12} />}
                {c.label}
                {rec && <span className="text-[10.5px] font-semibold text-[var(--primary)]">추천</span>}
              </button>
            );
          })}
          <button
            type="button"
            className={unsure ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            title="AI가 서비스에 맞게 정하고 문서에 '가정'으로 표시합니다."
            onClick={() =>
              setBrief((prev) => ({ ...prev, answers: { ...prev.answers, [q.key]: unsure ? [] : [UNSURE] } }))
            }
          >
            {unsure && <Check size={12} />}
            {UNSURE_LABEL}
          </button>
        </div>
      </div>
    );
  };

  const missing: string[] = [];
  // 줄 라벨만 있는 빈 틀로는 통과시키지 않는다.
  if (!ideaHasContent(brief.idea)) missing.push('서비스 아이디어');
  if (!brief.title.trim()) missing.push('서비스명');
  const step1Blocked = step === 1 && missing.length > 0;
  const hasDraft = Boolean(brief.title.trim() || brief.idea.trim());

  const structure = brief.structure;
  const twoSided = structure?.primary === 'matching' && structure.twoSided !== false;
  const questions = visibleQuestions(structure);
  const recommended = recommendedChoices(structure);

  /**
   * 문서 깊이 — 답한 만큼 오른쪽으로 간다. 점수 자체는 의미가 없고, "더 답하면 문서가
   * 촘촘해진다" 를 눈으로 보이게 하려는 것이다.
   */
  const depthScore =
    IDEA_LINES.filter((l) => ideaLineFilled(brief.idea, l.label)).length +
    (brief.idea.trim().length > 80 ? 1 : 0) +
    (structure ? (structure.source === 'user' ? 2 : 1) : 0) +
    (brief.targetUser.trim() ? 1 : 0) +
    Object.values(brief.answers ?? {}).filter((v) => v.length > 0).length +
    [brief.referenceDiff, brief.mustHave, brief.niceToHave, brief.notInScope, brief.materials].filter((v) => v?.trim())
      .length +
    followups.filter((f) => f.answer.trim()).length +
    (brief.summary ? 2 : 0);
  const depthLevel = depthScore >= 20 ? 2 : depthScore >= 10 ? 1 : 0;

  /** 처음부터 다시. 제출했을 때와 `새로 쓰기` 를 눌렀을 때만 지운다. */
  const reset = () => {
    setStep(1);
    setBrief(EMPTY_BRIEF);
    setFollowups([]);
    setAskReason('');
    askedFor.current = '';
    structureAbort.current?.abort();
    structureAbort.current = null;
    structureSeed.current = '';
    setStructureState('idle');
    setSuggestions([]);
    setFollowupRound(1);
    setShowAdvanced(false);
    setShowMaterials(false);
    summaryFor.current = '';
    setSummaryState('idle');
    setSummaryReason('');
    setSubmitting(false);
  };

  /**
   * 닫아도 쓰던 것은 남긴다. 예전에는 닫으면 바로 지워져서, 바깥을 잘못 한 번 누르면
   * 처음부터 다시 써야 했다. 새로 시작하려면 1단계의 `새로 쓰기` 를 누른다.
   */
  const close = () => {
    onClose();
  };

  const submit = async () => {
    if (missing.length > 0) {
      setStep(1);
      return;
    }
    if (submitting) return;
    setSubmitting(true);

    /*
     * 이 위저드에서 고른 등급은 이제 만들 플랜의 다섯 산출물에 통일 적용한다.
     * 서버도 같은 계정 설정을 읽어 크레딧·실제 모델 선택을 결정하므로, 플랜을
     * 만들기 전에 저장이 끝나야 한다.
     */
    const previous = engines;
    const selected = Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, planEngine])) as EngineMap;
    setEnginesLocally(selected);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engines: selected }),
      });
      if (!res.ok) throw new Error('엔진 설정을 저장하지 못했습니다.');
    } catch {
      setEnginesLocally(previous);
      setSubmitting(false);
      toast('엔진 선택을 저장하지 못했습니다. 다시 시도해 주세요.', 'danger');
      return;
    }

    /*
     * 답하지 않은 질문도 남긴다. 버리면 AI 가 그 자리를 말없이 추측하는데, 남기면 문서에
     * '가정' 으로 드러나 개발 전에 누군가 확인한다.
     */
    const asked = followups.map((f) => ({
      question: f.question,
      answer: f.answer.trim(),
      ...(f.area ? { area: f.area } : {}),
    }));
    const summary = brief.summary
      ? {
          lines: brief.summary.lines.filter((l) => l.text.trim()),
          assumptions: brief.summary.assumptions.map((a) => a.trim()).filter(Boolean),
        }
      : undefined;
    // 지금 구조에서 보이지 않는 질문의 답은 남기지 않는다 — 보이지 않는 답이 문서를 바꾸면 안 된다.
    const shown = new Set(questions.map((q) => q.key));
    const keptAnswers = Object.fromEntries(
      Object.entries(brief.answers ?? {}).filter(([key, values]) => shown.has(key) && values.length > 0),
    );
    const { providerUser, referenceDiff, niceToHave, notInScope, materials, ...rest } = brief;
    const trimmed = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
    const id = createPlan({
      ...rest,
      title: brief.title.trim(),
      idea: stripEmptyIdeaLines(brief.idea),
      answers: keptAnswers,
      ...(twoSided && providerUser?.trim() ? { providerUser: providerUser.trim() } : {}),
      ...(trimmed(referenceDiff) ? { referenceDiff: trimmed(referenceDiff) } : {}),
      ...(trimmed(niceToHave) ? { niceToHave: trimmed(niceToHave) } : {}),
      ...(trimmed(notInScope) ? { notInScope: trimmed(notInScope) } : {}),
      ...(trimmed(materials) ? { materials: trimmed(materials) } : {}),
      summary: summary && (summary.lines.length > 0 || summary.assumptions.length > 0) ? summary : undefined,
      ...(asked.length > 0 ? { followups: asked } : {}),
    });
    onClose();
    setTimeout(reset, 200);
    /*
     * `start` 는 **시작하지 않는다.** 개요 화면에서 어느 버튼을 눌러야 하는지
     * 표시만 한다. 세 단계를 채운 것과 크레딧을 쓰겠다는 것은 다른 결정이다.
     */
    router.push(`/plans/${id}?start=prd`);
  };

  const goToNextStep = () => {
    const now = Date.now();
    // 더블클릭이나 빠른 연타로 인한 단계 스킵 방지 (400ms 쿨다운)
    if (now - lastStepTimeRef.current < 400) return;
    lastStepTimeRef.current = now;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    /*
     * 4단계로 갈 때 미리 물어 두고, 4단계를 떠날 때 한 번 더 본다.
     * 미리 부르는 것은 5단계에서 기다리지 않기 위해서고, 두 번째는
     * **4단계에서 고른 답을 반영**하기 위해서다. 답이 그대로면
     * 씨앗이 같아 다시 부르지 않는다.
     */
    if (step === 3 || step === 4) void askFollowups();
    // 마지막 단계에 들어서면 지금까지 받은 것을 정리한다.
    if (step === 5) void makeSummary();
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };

  const goToPrevStep = () => {
    const now = Date.now();
    if (now - lastStepTimeRef.current < 400) return;
    lastStepTimeRef.current = now;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setStep((s) => Math.max(s - 1, 1));
  };

  return (
    <Modal
      open={open}
      onClose={close}
      width={620}
      title="기획하기"
      description="처음 두 칸만 채우면 시작할 수 있습니다. 뒤 단계는 답하실수록 문서가 정확해집니다."
      footer={
        <>
          {step > 1 && (
            <button
              type="button"
              className="btn"
              onClick={goToPrevStep}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Spacebar') {
                  e.preventDefault();
                }
              }}
            >
              <ArrowLeft size={14} />
              이전
            </button>
          )}
          {/*
            3단계부터는 언제든 빠져나갈 수 있어야 한다. 질문이 늘어난 것이
            "더 오래 붙잡힌다" 로 느껴지면 안 된다.
          */}
          {step >= 3 && step < LAST_STEP && (
            <button type="button" className="btn" disabled={submitting} onClick={() => void submit()}>
              이대로 만들기
            </button>
          )}
          {step < LAST_STEP ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={step1Blocked || submitting}
              onClick={goToNextStep}
              onKeyDown={(e) => {
                // 버튼 포커스 상태에서 스페이스바로 스크롤 시 버튼이 눌려 넘어가는 것 방지
                if (e.key === ' ' || e.key === 'Spacebar') {
                  e.preventDefault();
                }
              }}
            >
              다음
              <ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>
              <Wand2 size={14} />
              {submitting ? '설정 저장 중…' : '플랜 만들기'}
            </button>
          )}
        </>
      }
    >
      <div ref={wizardBodyRef}>
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
      <div className="-mt-3 mb-4 flex items-center gap-2" title="답할수록 문서가 촘촘해집니다">
        <span className="text-[11px] font-semibold text-[var(--fg-subtle)]">문서 깊이</span>
        <div className="flex flex-1 gap-1">
          {DEPTH_LABEL.map((label, i) => (
            <span
              key={label}
              className={`h-1.5 flex-1 rounded-full ${i <= depthLevel ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)]'}`}
            />
          ))}
        </div>
        <span className="text-[11px] font-bold text-[var(--fg-muted)]">{DEPTH_LABEL[depthLevel]}</span>
      </div>

      {/*
        1단계 — 무엇을 만드나요.

        아이디어를 맨 위에 둔다. 이름 짓기는 비전문가가 가장 오래 멈추는 곳이라 뒤로 미루고
        "가칭이어도 된다" 고 알린다. 엔진과 한 줄 소개는 '무엇을 만드나' 와 상관없어 3단계로 옮겼다.
      */}
      {step === 1 && (
        <div className="flex flex-col gap-3.5">
          {hasDraft && (
            <div className="-mb-2 flex justify-end">
              <button
                type="button"
                className="text-[11.5px] font-semibold text-[var(--fg-subtle)] hover:text-[var(--fg)]"
                onClick={reset}
              >
                새로 쓰기
              </button>
            </div>
          )}
          <Field label="서비스 아이디어" required hint="형식 없이 자유롭게 쭉 적으셔도 됩니다. 아래 칩은 빠뜨리기 쉬운 것을 짚어 주는 도우미일 뿐 필수가 아닙니다. 문제·해결 방법·핵심 행동이 글에 들어 있을수록 문서가 정확해집니다.">
            <textarea
              ref={ideaRef}
              className="textarea"
              autoFocus
              rows={5}
              value={brief.idea}
              placeholder={IDEA_LINES.map((l) => `${l.label}: ${l.example}`).join('\n')}
              onChange={(e) => patch({ idea: e.target.value })}
            />
          </Field>
          {/*
            줄 넣기 칩 — 누르면 그 줄을 끝에 넣고, 채워지면 ✓ 가 된다. 어디가 비었는지가 보이고,
            버튼이 따로 늘지 않는다. 결제·특징·차별점은 넣지 않는다 — 4단계와 3단계가 묻는다.
          */}
          <div className="-mt-1.5 flex flex-wrap gap-1.5">
            {IDEA_LINES.map(({ label }) => {
              const filled = ideaLineFilled(brief.idea, label);
              return (
                <button
                  key={label}
                  type="button"
                  className={filled ? 'chip chip-primary' : 'chip hover:border-[var(--primary-border)] hover:text-[var(--primary)]'}
                  onClick={() => addIdeaLine(label)}
                >
                  {filled ? <Check size={11} /> : <Plus size={11} />}
                  {label}
                </button>
              );
            })}
          </div>
          {/* 예시는 칸이 비었을 때만 — 쓰던 글을 덮어쓰지 않도록. 서비스명도 함께 채워 바로 넘어갈 수 있게. */}
          {!brief.idea.trim() && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-[var(--fg-subtle)]">예시로 시작:</span>
              {IDEA_SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  className="chip hover:border-[var(--primary-border)] hover:text-[var(--primary)]"
                  onClick={() => patch({ idea: sample.idea, title: brief.title.trim() ? brief.title : sample.title })}
                >
                  <Sparkles size={11} />
                  {sample.label}
                </button>
              ))}
            </div>
          )}
          {/*
            비어 있는 줄의 후보. AI 가 글을 고쳐 쓰지 않는다 — 고른 것만 들어간다.
            지어낸 문장이 몰래 '사용자 아이디어' 가 되어 다섯 문서에 사실로 퍼지면 안 된다.
          */}
          {suggestions.filter((s) => !ideaLineFilled(brief.idea, s.line)).length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[11.5px] text-[var(--fg-subtle)]">비어 있는 줄 제안 — 고르면 넣습니다</p>
              {suggestions
                .filter((s) => !ideaLineFilled(brief.idea, s.line))
                .map((s) => (
                  <button
                    key={`${s.line}-${s.text}`}
                    type="button"
                    className="chip w-fit max-w-full text-left hover:border-[var(--primary-border)] hover:text-[var(--primary)]"
                    onClick={() => addIdeaLine(s.line, s.text)}
                  >
                    <Plus size={11} />
                    <span className="truncate">
                      {s.line}: {s.text}
                    </span>
                  </button>
                ))}
            </div>
          )}
          <StructurePanel
            structure={structure}
            state={structureState}
            stale={Boolean(structure) && structureState === 'done' && structureSeed.current !== brief.idea.trim()}
            ready={brief.idea.trim().length >= 15}
            onChange={(next) => patch({ structure: next })}
            onGenerate={() => void readStructure()}
          />
          <Field label="서비스명" required hint="가칭이어도 됩니다. 개요에서 바꿀 수 있습니다.">
            <input
              className="input"
              value={brief.title}
              placeholder="예: 멍메이트"
              onChange={(e) => patch({ title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !step1Blocked) goToNextStep();
              }}
            />
          </Field>
          {missing.length > 0 && (
            <p className="text-[11.5px] text-[var(--fg-subtle)]">
              {missing.join(' · ')}을(를) 입력하면 다음 단계로 넘어갈 수 있습니다.
            </p>
          )}
        </div>
      )}

      {/*
        2단계 — 누구를 위한, 무엇을 위한 기획인가.

        예전에는 '기획 목적' 이 빈칸이었고 대부분 비워 두었다. 이제는 보기다. 문서에서 무엇을
        꼼꼼히 쓸지(견적용이면 범위 제외·가정, 투자용이면 지표·마일스톤)가 여기서 갈린다.
      */}
      {step === 2 && (
        <div className="flex flex-col gap-3.5">
          {/* 1단계에서 늦게 온 추정도 여기서 보이게 한다. */}
          {(structureState === 'loading' || structure) && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[12px]">
              <span className="font-bold">서비스 구조</span>
              {structureState === 'loading' ? (
                <span className="flex items-center gap-1.5 text-[var(--fg-muted)]">
                  <Spinner size={12} />
                  만드는 중…
                </span>
              ) : structure && structure.primary !== 'none' ? (
                <span className="text-[var(--fg-muted)]">
                  {archetypeChip(structure.primary)}
                  {structure.secondary ? ` + ${archetypeChip(structure.secondary)}` : ''} · {SOURCE_LABEL[structure.source]}
                </span>
              ) : (
                <span className="text-[var(--fg-muted)]">해당 없음</span>
              )}
              <span className="flex-1" />
              <button type="button" className="font-semibold text-[var(--primary)]" onClick={() => setStep(1)}>
                바꾸기
              </button>
            </div>
          )}
          {twoSided ? (
            <>
              <Field label="찾는 쪽 사용자" hint="비워 두면 AI가 아이디어를 보고 추정합니다.">
                <input
                  className="input"
                  autoFocus
                  value={brief.targetUser}
                  placeholder="예: 영어 과외 선생님을 찾는 중·고등학생 학부모"
                  onChange={(e) => patch({ targetUser: e.target.value })}
                />
              </Field>
              <Field label="제공하는 쪽 사용자">
                <input
                  className="input"
                  value={brief.providerUser ?? ''}
                  placeholder="예: 경력 2년 이상의 영어 과외 선생님"
                  onChange={(e) => patch({ providerUser: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <Field label="타겟 사용자" hint="누가, 어떤 상황에서 쓰는지 적을수록 페르소나가 구체적이 됩니다.">
              <input
                className="input"
                autoFocus
                value={brief.targetUser}
                placeholder="예: 서울에 사는 20~30대 1인 가구 반려인"
                onChange={(e) => patch({ targetUser: e.target.value })}
              />
            </Field>
          )}
          {questionsForStep(structure, 2).map(renderQuestion)}
          <Field label="목적을 직접 적기 (선택)">
            <input
              className="input"
              value={brief.purpose}
              placeholder="예: 다음 달 외주 업체 세 곳에 견적을 받기 위해"
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

      {/*
        3단계 — 범위를 세 갈래로 나눈다: 꼭 / 있으면 좋음 / 이번엔 안 만듦.

        '안 만들 것' 은 견적 때 가장 많이 다투는 곳인데, 예전에는 AI 가 지어냈다.
        사용자가 직접 적은 것은 PRD 범위 제외에 그대로 들어간다.
      */}
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
          <Field label="참고 서비스와 다른 점" hint="핵심 가치와 범위를 정하는 데 씁니다.">
            <input
              className="input"
              value={brief.referenceDiff ?? ''}
              placeholder="예: 당근의 동네 인증은 따르고, 채팅 대신 예약으로 바로 잡는다"
              onChange={(e) => patch({ referenceDiff: e.target.value })}
            />
          </Field>
          <Field label="꼭 있어야 할 기능" hint="없으면 출시할 수 없는 것. 필수(P0)로 들어갑니다.">
            <textarea
              className="textarea"
              rows={2}
              value={brief.mustHave ?? ''}
              placeholder="예: 위치 기반 매칭, 신고하기"
              onChange={(e) => patch({ mustHave: e.target.value })}
            />
          </Field>
          <Field label="있으면 좋은 기능" hint="여유가 되면 넣을 것. 우선순위를 낮게 잡습니다.">
            <textarea
              className="textarea"
              rows={2}
              value={brief.niceToHave ?? ''}
              placeholder="예: 산책 일지, 배지"
              onChange={(e) => patch({ niceToHave: e.target.value })}
            />
          </Field>
          <Field label="이번에 만들지 않을 것" hint="견적·일정에서 가장 많이 다투는 부분입니다. 적으면 범위 제외에 그대로 들어갑니다.">
            <textarea
              className="textarea"
              rows={2}
              value={brief.notInScope ?? ''}
              placeholder="예: 결제, 펫시터 연결, 관리자 통계"
              onChange={(e) => patch({ notInScope: e.target.value })}
            />
          </Field>
          {showMaterials || brief.materials ? (
            <Field label="기존 자료 붙여넣기" hint="회의록·기존 기획서·고객 요청 메일 등. 앞부분 5,000자까지 참고합니다.">
              <textarea
                className="textarea"
                rows={4}
                value={brief.materials ?? ''}
                placeholder="자료의 내용을 그대로 붙여 넣으세요."
                onChange={(e) => patch({ materials: e.target.value })}
              />
            </Field>
          ) : (
            <button
              type="button"
              className="w-fit text-[12px] font-semibold text-[var(--primary)]"
              onClick={() => setShowMaterials(true)}
            >
              + 기존 자료 붙여넣기 (회의록·기획서)
            </button>
          )}
          <Field label="한 줄 소개" hint="홈 카드에 보입니다. 비워 두면 아이디어로 대신합니다.">
            <input
              className="input"
              value={brief.oneLiner}
              placeholder="예: 우리 동네 산책 친구를 찾아주는 반려견 매칭 서비스"
              onChange={(e) => patch({ oneLiner: e.target.value })}
            />
          </Field>
          {/*
            예전에는 여기 "PRD도 바로 생성하기" 체크박스가 있었고 기본이 켜짐이었다.
            그래서 `플랜 만들기` 를 누른 순간 생성이 시작되고 크레딧이 나갔다.
            시작은 다음 화면에서 사용자가 직접 누른다.

            엔진은 1단계에서 여기로 옮겼다. 비용 결정은 크레딧 이야기가 나오는 자리에 둔다.
            `이대로 만들기` 는 3단계부터, `플랜 만들기` 는 마지막 단계에 있으니 어느 경로든 여기를 지난다.
          */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
            <p className="text-[12.5px] font-bold">다음 화면에서 시작하실 수 있습니다</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--fg-muted)]">
              플랜을 만들면 개요로 넘어갑니다. 프로덕트 요구사항의{' '}
              <span className="font-semibold text-[var(--fg)]">AI로 생성</span> 버튼을 표시해 드리니,
              준비되셨을 때 누르세요. 크레딧은 그때부터 듭니다.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold">이번 기획의 AI 엔진</span>
              {ENGINE_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={planEngine === tier ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  aria-pressed={planEngine === tier}
                  onClick={() => setPlanEngine(tier)}
                >
                  {planEngine === tier && <Check size={12} />}
                  {ENGINE_LABEL[tier]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
              {ENGINE_WHAT[planEngine]} 다섯 문서 모두에 적용되며, 고급 엔진은 크레딧이 두 배입니다.
            </p>
          </div>
        </div>
      )}

      {/*
        4단계 — 고르기만 하면 되는 요구분석.

        공통 질문 뒤에 **서비스 구조에 따라 갈라지는 질문**이 붙는다(주 유형 2개 + 보조 1개).
        `잘 모르겠어요` 는 비워 두는 것과 다르다 — AI 가 정하되 문서에 '가정' 으로 남긴다.
        더 깊게 답하고 싶은 사람을 위한 질문은 `더 자세히` 안에 접어 둔다.
      */}
      {step === 4 && (
        <div className="flex flex-col gap-3.5">
          <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">
            고르기만 하시면 됩니다. 모르겠으면 <b>{UNSURE_LABEL}</b>를 누르세요 — AI가 정하고 문서에
            &lsquo;가정&rsquo;으로 표시합니다.
          </p>
          {questionsForStep(structure, 4)
            .filter((q) => !q.advanced)
            .map(renderQuestion)}
          <div className="rounded-lg border border-[var(--border)] px-3 py-2.5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-[12.5px] font-bold"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              더 자세히 답하기 (대화·업로드·외부 연동·규모)
              <span className="text-[var(--fg-subtle)]">{showAdvanced ? '접기' : '펼치기'}</span>
            </button>
            {showAdvanced && (
              <div className="mt-3 flex flex-col gap-3.5">
                {questionsForStep(structure, 4)
                  .filter((q) => q.advanced)
                  .map(renderQuestion)}
              </div>
            )}
          </div>
        </div>
      )}

      {/*
        5단계 — AI 가 이 아이디어에만 해당하는 것을 되묻는다.

        고정 폼으로는 "처음 만나는 사람끼리 안전은 어떻게 확보하나요" 같은 질문이
        나올 수 없다. 질문마다 영역 꼬리표와 추천 보기를 붙이고, 답한 것에서 이어지는
        꼬리 질문을 한 번 더 받을 수 있다. 답하지 않은 질문은 버리지 않고 '가정' 으로 넘긴다.
      */}
      {step === 5 && (
        <div className="flex flex-col gap-3.5">
          {asking && followups.length === 0 && (
            <div className="flex items-center gap-2 text-[12.5px] text-[var(--fg-muted)]">
              <Spinner size={14} />
              아이디어를 읽고 여쭤볼 것을 고르는 중입니다…
            </div>
          )}

          {!asking && followups.length === 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
              <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                {askReason || '더 여쭤볼 것이 없습니다.'} <b>다음</b>을 눌러 주세요.
              </p>
              {/* 한 번 실패했다고 포기시키지 않는다. */}
              <button type="button" className="btn btn-sm mt-2" onClick={() => void askFollowups(true)}>
                <Sparkles size={12} />
                다시 여쭤보기
              </button>
            </div>
          )}

          {followups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                <b>답하지 않으셔도 됩니다</b> — 답하지 않은 것은 문서에 &lsquo;가정&rsquo;으로 남겨 나중에 확인하게 합니다.
              </p>
              {followups.some((f) => !f.answer.trim() && f.recommended) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setFollowups((prev) =>
                      prev.map((p) => (!p.answer.trim() && p.recommended ? { ...p, answer: p.recommended } : p)),
                    )
                  }
                >
                  <Check size={12} />
                  빈 곳은 추천대로
                </button>
              )}
            </div>
          )}

          {followups.map((f, index) => (
            <div key={f.question}>
              <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold">
                {f.question}
                {f.area && <span className="chip text-[10.5px] font-semibold">{f.area}</span>}
                {f.round === 2 && <span className="chip text-[10.5px] font-semibold">꼬리 질문</span>}
              </p>
              {f.why && <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">{f.why}</p>}
              {f.choices.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {f.choices.map((c) => {
                    const on = f.answer === c;
                    const rec = !on && f.recommended === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={on ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                        title={f.recommended === c && f.recommendReason ? `추천 이유: ${f.recommendReason}` : undefined}
                        onClick={() =>
                          setFollowups((prev) =>
                            prev.map((p, i) => (i === index ? { ...p, answer: p.answer === c ? '' : c } : p)),
                          )
                        }
                      >
                        {on && <Check size={12} />}
                        {c}
                        {rec && <span className="text-[10.5px] font-semibold text-[var(--primary)]">추천</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {f.recommended && f.recommendReason && !f.answer && (
                <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">추천 이유: {f.recommendReason}</p>
              )}
              <input
                className="input mt-1.5"
                value={f.answer}
                placeholder="직접 적으셔도 됩니다"
                onChange={(e) =>
                  setFollowups((prev) =>
                    prev.map((p, i) => (i === index ? { ...p, answer: e.target.value } : p)),
                  )
                }
              />
            </div>
          ))}

          {asking && followups.length > 0 && (
            <div className="flex items-center gap-2 text-[12.5px] text-[var(--fg-muted)]">
              <Spinner size={14} />
              답하신 것에서 이어지는 질문을 고르는 중입니다…
            </div>
          )}

          {/*
            꼬리 질문은 한 번만. 답한 것이 있어야 이어 물을 것이 생긴다.
            "보증금으로 처리" → "보증금은 얼마, 언제 돌려주나요?" 처럼 정책을 숫자까지 내린다.
          */}
          {!asking && followupRound === 1 && followups.some((f) => f.answer.trim()) && (
            <button type="button" className="btn btn-sm w-fit" onClick={() => void askMore()}>
              <Sparkles size={12} />
              답한 것에서 더 여쭤보기
            </button>
          )}
        </div>
      )}

      {/*
        6단계 — 제가 이해한 게 맞나요?

        지금까지 받은 것을 7줄로 되짚는다. 잘못 이해한 부분은 PRD 를 만들고 크레딧을 쓴 뒤에야
        드러나기 쉬운데, 그 전에 줄마다 읽고 고치게 한다. 여기서 확인한 요약이 모든 문서 생성에서
        가장 앞선다. AI 가 추측한 줄에는 `추정` 을 붙여 어디를 봐야 하는지 알려 준다.
      */}
      {step === 6 && (
        <div className="flex flex-col gap-3">
          {summaryState === 'loading' && (
            <div className="flex items-center gap-2 text-[12.5px] text-[var(--fg-muted)]">
              <Spinner size={14} />
              지금까지 적어 주신 것을 정리하는 중입니다…
            </div>
          )}

          {summaryState !== 'loading' && !brief.summary && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
              <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
                {summaryReason || '요약을 만들지 못했습니다.'} <b>플랜 만들기</b>를 눌러도 됩니다.
              </p>
              <button type="button" className="btn btn-sm mt-2" onClick={() => void makeSummary(true)}>
                <Sparkles size={12} />
                다시 정리하기
              </button>
            </div>
          )}

          {summaryState !== 'loading' && brief.summary && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                  이렇게 이해했습니다. <b>틀린 줄은 바로 고쳐 주세요.</b> <span className="chip text-[10.5px]">추정</span>{' '}
                  표시는 직접 말씀하지 않아 AI가 채운 줄입니다.
                </p>
                <button type="button" className="btn btn-sm" onClick={() => void makeSummary(true)}>
                  다시 정리하기
                </button>
              </div>
              {brief.summary.lines.map((line, index) => (
                <div key={line.label} className="grid gap-1 sm:grid-cols-[132px_1fr] sm:items-center">
                  <span className="flex items-center gap-1.5 text-[12px] font-bold">
                    {line.label}
                    {line.assumed && <span className="chip text-[10.5px] font-semibold">추정</span>}
                  </span>
                  <input
                    className="input"
                    value={line.text}
                    placeholder="비어 있습니다 — 적어 주시면 반영합니다"
                    onChange={(e) => updateSummaryLine(index, e.target.value)}
                  />
                </div>
              ))}
              <div className="mt-1">
                <p className="text-[12px] font-bold">가정</p>
                <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
                  정하지 않은 것을 이렇게 두고 만듭니다. 문서의 제약사항에 &lsquo;가정&rsquo;으로 적혀 나중에 확인할 수 있습니다.
                </p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {brief.summary.assumptions.map((assumption, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <input
                        className="input"
                        value={assumption}
                        onChange={(e) => updateAssumption(index, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label="가정 빼기"
                        onClick={() => removeAssumption(index)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="w-fit text-[12px] font-semibold text-[var(--primary)]"
                    onClick={() => updateAssumption(brief.summary?.assumptions.length ?? 0, '')}
                  >
                    + 가정 추가
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      </div>
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
  const { remaining: credits, limit: creditLimit } = useCredits();
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
              title={`하루 ${creditLimit} 크레딧이 충전됩니다. 임시로 열어 둔 한도입니다.`}
            >
              <Coins size={11} />
              크레딧 {credits}/{creditLimit}
              <span className="font-normal text-[var(--fg-subtle)]">(임시)</span>
            </span>
          </ClientOnly>
          <div className="ml-auto flex items-center gap-2">
            <HeaderAiStatus />
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
