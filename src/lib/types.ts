/**
 * UniBoard — 기획 산출물 도메인 모델
 *
 * 하나의 "플랜(Plan)"은 하나의 제품 기획 워크스페이스이며,
 * 아래 5종 산출물을 상호 연결된 형태로 보유한다.
 *
 *   PRD(프로덕트 요구사항) → FS(기능명세서) → IA(정보구조도) → 유저플로우 → 와이어프레임
 *
 * ID 규칙
 *   요구사항  REQ-001
 *   기능      FN-001
 *   상세명세  SP-001
 *   페이지    PG-001
 *   플로우    FL-001
 *   와이어프레임 WF-001
 */

export type Platform = 'web' | 'app' | 'both' | 'admin';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type WorkStatus = '작성전' | '작성중' | '검토중' | '확정';

export const PRIORITY_LABEL: Record<Priority, string> = {
  P0: '필수',
  P1: '높음',
  P2: '보통',
  P3: '낮음',
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  web: '웹',
  app: '모바일 앱',
  both: '웹 + 앱',
  admin: '어드민',
};

export const WORK_STATUS_ORDER: WorkStatus[] = ['작성전', '작성중', '검토중', '확정'];

/* ------------------------------------------------------------------ */
/* PRD — 프로덕트 요구사항                                              */
/* ------------------------------------------------------------------ */

export interface PrdGoal {
  id: string;
  /** 핵심 목표 */
  text: string;
  /** 목표를 판단할 지표 */
  metric?: string;
}

export interface PrdPersona {
  id: string;
  /** 페르소나 이름 */
  name: string;
  /** 한 줄 소개 */
  summary: string;
  /** 니즈 */
  needs: string[];
  /** 페인포인트 */
  painPoints: string[];
}

export interface PrdRole {
  id: string;
  /** 역할명 (예: 일반 사용자, 관리자) */
  name: string;
  description: string;
  /** 권한 목록 */
  permissions: string[];
}

export interface PrdEnvironment {
  /** 지원 플랫폼 */
  platforms: string[];
  /** 지원 기기 */
  devices: string[];
  /** 지원 브라우저/OS */
  browsers: string[];
}

export interface PrdMetric {
  id: string;
  name: string;
  /** 목표 수치 */
  target: string;
}

export interface Prd {
  /** 제품 개요 */
  overview: string;
  /** 배경 및 문제 정의 */
  background: string;
  /** 핵심 목표 */
  goals: PrdGoal[];
  /** 타겟 유저 / 페르소나 */
  personas: PrdPersona[];
  /** 사용자 역할 */
  roles: PrdRole[];
  /** 사용 환경 */
  environment: PrdEnvironment;
  /** 핵심 가치 */
  coreValues: string[];
  /** 성공 지표 */
  successMetrics: PrdMetric[];
  /** 범위에 포함 */
  inScope: string[];
  /** 범위에서 제외 */
  outOfScope: string[];
  /** 제약사항 */
  constraints: string[];
}

/* ------------------------------------------------------------------ */
/* FS — 기능명세서 (요구사항 → 기능 → 상세명세)                          */
/* ------------------------------------------------------------------ */

/**
 * AI 가 만들어 아직 검토하지 않은 항목의 표시.
 *
 * `'pending'` 이면 화면에 `신규` 배지가 붙고 승인/거절 대상이 된다.
 * **승인하면 필드를 지운다.** 값이 없으면 승인된 것으로 보므로,
 * 이 필드가 없던 시절에 저장된 플랜도 마이그레이션 없이 그대로 열린다.
 * 사용자가 직접 추가한 항목에는 붙이지 않는다 — 자기가 만든 것을 다시 승인할 이유가 없다.
 */
export type ReviewState = 'pending';

export interface Reviewable {
  review?: ReviewState;
}

export interface Requirement extends Reviewable {
  /** REQ-001 */
  id: string;
  /** 요구사항명 */
  title: string;
  description: string;
  /** 분류 (예: 회원, 콘텐츠, 결제) */
  category: string;
  priority: Priority;
  order: number;
}

export interface Feature extends Reviewable {
  /** FN-001 */
  id: string;
  /** 상위 요구사항 ID */
  requirementId: string;
  /** 기능명 */
  name: string;
  description: string;
  priority: Priority;
  status: WorkStatus;
  order: number;
}

export interface Specification extends Reviewable {
  /** SP-001 */
  id: string;
  /** 상위 기능 ID */
  featureId: string;
  /** 상세 기능명 */
  title: string;
  /** 수행 주체 */
  actor: string;
  /** 사전 조건 */
  precondition: string;
  /** 기본 흐름 */
  mainFlow: string[];
  /** 예외 처리 */
  exceptions: string[];
  /** 인수 조건 */
  acceptanceCriteria: string[];
  /** 연결된 IA 페이지 ID 목록 */
  pageIds: string[];
  priority: Priority;
  status: WorkStatus;
  order: number;
}

/* ------------------------------------------------------------------ */
/* IA — 정보구조도                                                      */
/* ------------------------------------------------------------------ */

export type IaPageType = 'page' | 'modal' | 'tab' | 'section';

export const IA_PAGE_TYPE_LABEL: Record<IaPageType, string> = {
  page: '페이지',
  modal: '모달',
  tab: '탭',
  section: '섹션',
};

export interface IaPage {
  /** PG-001 */
  id: string;
  /** 상위 페이지 ID (1 depth 는 null) */
  parentId: string | null;
  /** 페이지명 */
  name: string;
  /** 경로 */
  path: string;
  description: string;
  type: IaPageType;
  /** 접근 가능한 역할명 */
  roles: string[];
  /** 연결된 기능 ID 목록 */
  featureIds: string[];
  order: number;
}

/* ------------------------------------------------------------------ */
/* 유저 플로우                                                          */
/* ------------------------------------------------------------------ */

export type FlowNodeType = 'start' | 'screen' | 'action' | 'decision' | 'system' | 'end';

export const FLOW_NODE_TYPE_LABEL: Record<FlowNodeType, string> = {
  start: '시작',
  screen: '화면',
  action: '사용자 행동',
  decision: '분기',
  system: '시스템 처리',
  end: '종료',
};

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  label: string;
  description?: string;
  /** 연결된 IA 페이지 ID */
  pageId?: string | null;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** 분기 조건 라벨 */
  label?: string;
}

export interface UserFlow {
  /** FL-001 */
  id: string;
  name: string;
  description: string;
  /** 수행 역할 */
  actor: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  order: number;
}

/* ------------------------------------------------------------------ */
/* 와이어프레임                                                         */
/* ------------------------------------------------------------------ */

export type WireframeBlockType =
  | 'header'
  | 'nav'
  | 'hero'
  | 'search'
  | 'filter'
  | 'list'
  | 'card-grid'
  | 'table'
  | 'form'
  | 'detail'
  | 'tabs'
  | 'text'
  | 'image'
  | 'chart'
  | 'banner'
  | 'cta'
  | 'footer';

export const WIREFRAME_BLOCK_LABEL: Record<WireframeBlockType, string> = {
  header: '헤더',
  nav: '내비게이션',
  hero: '히어로',
  search: '검색',
  filter: '필터',
  list: '리스트',
  'card-grid': '카드 그리드',
  table: '테이블',
  form: '폼',
  detail: '상세 정보',
  tabs: '탭',
  text: '텍스트',
  image: '이미지',
  chart: '차트',
  banner: '배너',
  cta: 'CTA',
  footer: '푸터',
};

export interface WireframeBlock {
  id: string;
  type: WireframeBlockType;
  /** 블록 제목 */
  title: string;
  /** 블록 안에 들어갈 항목 */
  items: string[];
  /** 기획 메모 */
  note?: string;
}

export type WireframeDevice = 'mobile' | 'desktop';

export interface Wireframe {
  /** WF-001 */
  id: string;
  /** 대상 IA 페이지 ID */
  pageId: string;
  name: string;
  device: WireframeDevice;
  blocks: WireframeBlock[];
  order: number;
  /**
   * 이 화면을 만들 때 대상 페이지에 걸려 있던 기능 ID.
   *
   * 나중에 그 페이지에 기능이 더 붙으면, 와이어프레임은 그 기능을 모르는 상태로 남는다.
   * 지금 값과 비교하면 "내용이 뒤처진 화면" 을 찾아낼 수 있다.
   *
   * **없을 수 있다.** 이 필드가 생기기 전에 만든 와이어프레임에는 값이 없다.
   * 그때는 뒤처졌는지 알 수 없으므로 뒤처졌다고 단정하지 않는다 —
   * 멀쩡한 화면을 다시 만들라고 재촉하면 오히려 손해다.
   */
  featureIds?: string[];
}

/* ------------------------------------------------------------------ */
/* 협업 — 코멘트 / 버전                                                 */
/* ------------------------------------------------------------------ */

export type CommentTarget =
  | 'prd'
  | 'requirement'
  | 'feature'
  | 'specification'
  | 'iaPage'
  | 'flow'
  | 'wireframe';

export interface Comment {
  id: string;
  targetType: CommentTarget;
  /** 대상 항목 ID (PRD 는 섹션 키) */
  targetId: string;
  author: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

export interface PlanVersion {
  id: string;
  label: string;
  createdAt: string;
  /** 스냅샷 (문서 부분만 저장) */
  snapshot: PlanDocuments;
}

/* ------------------------------------------------------------------ */
/* AI 에이전트                                                          */
/* ------------------------------------------------------------------ */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** AI 가 문서를 수정했을 때 남기는 변경 요약 */
  changes?: string[];
  /** 생성에 소모된 크레딧 */
  credits?: number;
  /**
   * 답을 받지 못하고 끝난 자리.
   *
   * 왜 답이 없는지는 알려 줘야 하고, 동시에 다시 보낼 수 있어야 한다. 실패를
   * 그냥 assistant 메시지로만 남기면 "답이 온 것" 과 구분되지 않아 다시 보내기를
   * 띄울 수 없다.
   */
  failed?: boolean;
  /**
   * 사용자가 스스로 멈춘 자리.
   *
   * 답을 못 받은 것은 실패와 같으므로 `failed` 도 함께 켠다 — 다시 보내기가 떠야 한다.
   * 다만 **빨간 실패로 보이면 안 된다.** 스스로 누른 결과를 사고처럼 보여 주면
   * 앱이 고장 난 줄 안다.
   */
  cancelled?: boolean;
}

/* ------------------------------------------------------------------ */
/* 플랜                                                                 */
/* ------------------------------------------------------------------ */

/** 플랜 생성 시 사용자가 입력하는 값 (기획하기 위저드) */
export interface PlanBrief {
  /** 서비스명 */
  title: string;
  /** 한 줄 소개 */
  oneLiner: string;
  /** 서비스 아이디어 상세 */
  idea: string;
  /** 타겟 사용자 */
  targetUser: string;
  /** 기획 목적 */
  purpose: string;
  platform: Platform;
  /** 참고할 서비스 */
  reference?: string;
  /** 꼭 포함해야 하는 기능 */
  mustHave?: string;
  /**
   * 고른 요구분석 답 — `{ actors: ['일반 사용자'], auth: ['필요'] }`.
   * 예전 플랜에는 없으므로 없을 수 있다.
   */
  answers?: Record<string, string[]>;
  /** AI 가 되물은 질문과 그 답. */
  followups?: Array<{ question: string; answer: string }>;
}

/** 문서 묶음 — 버전 스냅샷 대상 */
export interface PlanDocuments {
  prd: Prd;
  requirements: Requirement[];
  features: Feature[];
  specifications: Specification[];
  iaPages: IaPage[];
  flows: UserFlow[];
  wireframes: Wireframe[];
}

export interface Plan extends PlanDocuments {
  id: string;
  brief: PlanBrief;
  createdAt: string;
  updatedAt: string;
  /** 산출물별 생성 여부 */
  generated: Record<ArtifactKey, boolean>;
  chat: ChatMessage[];
  comments: Comment[];
  versions: PlanVersion[];
}

export type ArtifactKey = 'prd' | 'fs' | 'ia' | 'flow' | 'wireframe';

export const ARTIFACT_LABEL: Record<ArtifactKey, string> = {
  prd: '프로덕트 요구사항',
  fs: '기능명세서',
  ia: '정보구조도',
  flow: '유저 플로우',
  wireframe: '와이어프레임',
};

/** 산출물 1회 생성 시 차감되는 크레딧 */
export const ARTIFACT_CREDIT_COST: Record<ArtifactKey, number> = {
  prd: 3,
  fs: 5,
  ia: 4,
  flow: 3,
  wireframe: 5,
};

export const CHAT_CREDIT_COST = 1;

/**
 * 새 기능을 화면에 배치할 때 드는 크레딧.
 *
 * 정보구조도 전체 생성(4)보다 싸다 — 이미 있는 화면 목록을 주고 새 기능만
 * 어디에 둘지 고르게 하므로 만들어 낼 것이 훨씬 적다.
 */
export const PLACEMENT_CREDIT_COST = 2;

export function emptyPrd(): Prd {
  return {
    overview: '',
    background: '',
    goals: [],
    personas: [],
    roles: [],
    environment: { platforms: [], devices: [], browsers: [] },
    coreValues: [],
    successMetrics: [],
    inScope: [],
    outOfScope: [],
    constraints: [],
  };
}

export function emptyDocuments(): PlanDocuments {
  return {
    prd: emptyPrd(),
    requirements: [],
    features: [],
    specifications: [],
    iaPages: [],
    flows: [],
    wireframes: [],
  };
}

export function pickDocuments(plan: PlanDocuments): PlanDocuments {
  return {
    prd: plan.prd,
    requirements: plan.requirements,
    features: plan.features,
    specifications: plan.specifications,
    iaPages: plan.iaPages,
    flows: plan.flows,
    wireframes: plan.wireframes,
  };
}
