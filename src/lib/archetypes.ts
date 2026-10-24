/**
 * 서비스 구조(아키타입) — **업종이 아니라 누가 무엇을 주고받는가**로 나눈다.
 *
 * ## 왜 업종이 아니라 구조인가
 *
 * 내장 생성기의 `pickKit` 은 업종 단어로 고른다. 그래서 "중고 장비를 빌려주는 취미
 * **공유** 플랫폼" 이 커뮤니티로, "산책 메이트 매칭 앱" 은 일반으로 떨어졌다.
 * 역할·상태 변화·화면 묶음·필수 플로우를 갈라놓는 것은 업종이 아니라 구조다.
 * 업종이 문서를 실제로 바꾸는 것은 대부분 동의·규제라, 그것은 `CAUTIONS` 로 따로 뺀다.
 *
 * ## 여기 적은 것이 곧 약속이다
 *
 * `brief-questions.ts` 의 effect 와 같다. 유형마다 문서별로 **무엇을 넣는지**를 적어 두고,
 * 그 문장이 그대로 생성 프롬프트에 들어간다. 화면의 "문서에 반영" 줄(`preview`)도 같은
 * 내용을 줄인 것이어야 한다 — 보여 준 것과 넣는 것이 다르면 안 된다.
 *
 * 돈 버는 방식(구독·수수료)은 유형에 넣지 않는다. 4단계 `돈은 어떻게 버나요` 가 묻는다.
 */

import type { ArchetypeKey, ArtifactKey, BriefStructure, CautionKey, PlanBrief } from './types';

type DocKey = Exclude<ArtifactKey, 'wireframe'>;

export interface Archetype {
  key: ArchetypeKey;
  label: string;
  emoji: string;
  /** 고를 때 읽는 판별 기준 한 줄. 분류 프롬프트에도 그대로 들어간다. */
  criterion: string;
  examples: string;
  /** 화면의 "문서에 반영" 줄. 아래 effects 를 사람 말로 줄인 것. */
  preview: string;
  /** 문서별로 프롬프트에 들어가는 지시. 그 문서 몫만 넣는다. */
  effects: Record<DocKey, string[]>;
  /** 5단계 되묻기가 이 구조에서 먼저 따져 볼 것 */
  followupHints: string[];
}

export const ARCHETYPES: Record<ArchetypeKey, Archetype> = {
  matching: {
    key: 'matching',
    label: '중개·매칭',
    emoji: '🤝',
    criterion:
      '서비스가 직접 팔지 않고 제공하는 쪽과 찾는 쪽(또는 같은 처지의 사람끼리)을 이어 준다. "공유"라는 말이 있어도 물건을 빌려주고 빌리면 여기다.',
    examples: '당근, 숨고, 산책 메이트, 장비 대여',
    preview: '양쪽 프로필 · 요청→수락 · 후기 · 신고·차단',
    effects: {
      prd: [
        '사용자 시나리오에 요청하는 쪽(탐색→요청→성사→후기)과 응하는 쪽(등록→요청 받음→수락→완료)을 각각 하나 이상 쓴다.',
        '리스크에 "초기 공급 부족(콜드 스타트)"과 "거래 상대 신뢰·분쟁"을 넣고 대응을 적는다.',
        '성공 지표에 매칭 성사율(요청 대비 수락), 첫 성사까지 걸린 시간, 재이용률을 넣는다.',
      ],
      fs: [
        '요구사항에 [등록·프로필], [탐색·요청], [수락·거절·취소], [진행 상태], [상호 후기], [신고·차단·분쟁]을 둔다.',
        '매칭 건의 상태를 "요청됨 → 수락됨/거절됨 → 진행 중 → 완료/취소"로 정의하고, 각 전환을 누가 일으키는지 상세명세에 적는다.',
        '예외로 무응답 요청 자동 만료, 일방 취소, 노쇼를 넣는다. 연락처를 공개하는 시점을 정의한다.',
      ],
      ia: [
        '탐색, 보낸 요청, 받은 요청, 이용 내역을 메뉴로 둔다.',
        '매칭 건 상세(상태·상대 정보), 후기 작성, 신고 화면을 포함한다.',
      ],
      flow: [
        '처음 요청해서 성사되기까지, 거절·무응답 시 다른 상대를 추천하는 분기, 완료 후 상호 후기 플로우를 만든다.',
      ],
    },
    followupHints: ['대금을 직접 주고받는지 서비스가 맡아 두는지', '제공하는 쪽을 심사하는지', '처음 만나는 사이의 안전'],
  },
  commerce: {
    key: 'commerce',
    label: '판매·주문',
    emoji: '🛒',
    criterion: '운영자가 직접 상품을 팔고 주문을 처리한다.',
    examples: '자사몰, 구독 박스, 반찬 가게 주문',
    preview: '상품 · 장바구니 · 주문 상태 · 취소·반품',
    effects: {
      prd: [
        '역할은 구매자와 운영자(상품·주문 관리)로 둔다.',
        '리스크에 결제 실패, 환불 분쟁, 재고 불일치를 넣는다. 성공 지표에 구매 전환율, 장바구니 이탈률, 재구매율을 넣는다.',
        '교환·환불 정책과 사업자 정보 고지를 제약사항에 적는다.',
      ],
      fs: [
        '상품 목록·상세·옵션, 장바구니, 주문서, 재고·품절 처리를 넣는다.',
        '주문 상태를 "주문 접수 → 준비 → 전달 중 → 전달 완료 → 구매 확정 / 취소·반품·교환"으로 정의한다.',
        '예외로 품절, 부분 취소, 결제를 쓴다면 결제 실패를 넣는다.',
      ],
      ia: [
        '카테고리·검색, 상품 상세, 장바구니, 주문서, 주문 완료, 주문 내역·취소/반품 신청을 둔다.',
        '운영 쪽에 상품 등록, 재고, 주문 처리를 둔다.',
      ],
      flow: ['탐색에서 주문 완료까지, 품절·결제 실패 분기, 취소·반품 플로우를 만든다.'],
    },
    followupHints: ['상품을 어떻게 전달하는지', '취소·환불 기준', '재고를 관리하는지'],
  },
  booking: {
    key: 'booking',
    label: '예약·일정',
    emoji: '📅',
    criterion: '정해진 시간·자리·정원을 미리 잡는 것이 핵심이다.',
    examples: '미용실·진료·클래스·구장 예약',
    preview: '시간 슬롯 · 예약 상태 · 취소 마감 · 노쇼 · 리마인드',
    effects: {
      prd: [
        '역할은 예약하는 사람과 예약 받는 쪽(매장·강사·담당자)으로 둔다.',
        '리스크에 노쇼, 중복 예약, 취소 규정 분쟁을 넣는다. 성공 지표에 예약 완료율, 노쇼율, 재예약률을 넣는다.',
      ],
      fs: [
        '예약 가능 시간(슬롯)·정원 설정, 달력 조회, 예약 생성을 넣는다. 동시에 신청하면 먼저 확정된 것만 남는다.',
        '예약 상태를 "신청 → 확정 → 이용 완료 / 취소 / 노쇼"로 정의하고, 변경·취소 마감 시각과 위약 규정을 상세명세에 적는다.',
        '리마인드 알림(전날·직전)과 자리가 찼을 때의 예외를 넣는다.',
      ],
      ia: [
        '예약하는 쪽은 대상 상세 → 날짜·시간 선택 → 예약 확인 → 내 예약 순서로 둔다.',
        '예약 받는 쪽은 일정·슬롯 설정, 예약 현황 달력, 예약 상세를 둔다.',
      ],
      flow: ['첫 예약(시간 선택→확정), 자리가 찼을 때 다른 시간 제안, 마감 전/후 변경·취소 플로우를 만든다.'],
    },
    followupHints: ['결제 시점(예약할 때/현장)', '취소 마감과 위약', '예약이 바로 확정되는지'],
  },
  community: {
    key: 'community',
    label: '커뮤니티',
    emoji: '💬',
    criterion: '사용자가 올린 글·사진이 서비스의 핵심 가치다.',
    examples: '동호회, Q&A, 후기 SNS',
    preview: '작성·피드·댓글 · 신고·제재 · 알림',
    effects: {
      prd: [
        '역할은 작성자·열람자와 운영자(모더레이터)로 둔다.',
        '리스크에 초기 콘텐츠 부족, 악성 게시물·명예훼손, 스팸을 넣는다. 성공 지표에 글 쓴 사용자 비율, 게시물당 반응 수, 7일 재방문율을 넣는다.',
      ],
      fs: [
        '작성·수정·삭제(이미지 첨부), 피드 정렬(최신/인기), 좋아요·댓글, 검색·태그를 넣는다.',
        '신고·숨김·차단과 운영자 제재 단계(경고 → 일시 정지 → 영구 정지)를 넣는다.',
      ],
      ia: ['피드·게시판, 게시물 상세, 작성, 프로필(내가 쓴 글), 알림함, 검색을 둔다. 운영 쪽에 신고 처리 대기열을 둔다.'],
      flow: ['첫 방문에서 첫 글 작성까지(빈 피드 상태 포함), 댓글→알림→재방문, 신고→처리 결과 통보 플로우를 만든다.'],
    },
    followupHints: ['누가 글을 쓸 수 있는지', '올라온 글을 어떻게 검수하는지', '익명을 허용하는지'],
  },
  workspace: {
    key: 'workspace',
    label: '팀 업무 도구',
    emoji: '🗂️',
    criterion: '조직·팀 단위로 같은 데이터를 역할에 따라 다르게 다룬다.',
    examples: '학원 관리, 사내 스터디 관리, CRM',
    preview: '워크스페이스 · 초대 · 역할별 권한 · 활동 기록',
    effects: {
      prd: [
        '역할은 소유자·관리자·구성원(필요하면 게스트)으로 둔다.',
        '시나리오는 워크스페이스 생성 → 팀원 초대 → 핵심 업무 처리 → 현황 확인을 포함한다.',
        '리스크에 기존 도구(엑셀·메신저)에서 옮겨 오는 저항과 권한 실수로 인한 데이터 노출을 넣는다.',
      ],
      fs: [
        '워크스페이스 생성, 구성원 초대·역할 변경·내보내기, 역할별 권한표(보기/편집/삭제/관리)를 넣는다.',
        '핵심 레코드의 등록·상태 변경, 목록 필터·일괄 처리, 활동 기록(누가 언제 무엇을), 내보내기를 넣는다.',
      ],
      ia: ['워크스페이스 전환, 현황 대시보드, 핵심 레코드 목록·상세, 구성원·권한 설정, 워크스페이스 설정을 둔다.'],
      flow: ['생성 → 첫 초대 → 첫 레코드, 초대받은 사람의 가입, 권한 없는 작업 시도 분기 플로우를 만든다.'],
    },
    followupHints: ['한 사람이 여러 조직에 속하는지', '결재·승인 단계', '외부 사람이 들어오는지'],
  },
  personal: {
    key: 'personal',
    label: '개인 기록·관리',
    emoji: '📒',
    criterion: '한 사람이 자기 데이터를 기록·정리한다. 다른 사용자와 주고받는 것이 핵심이 아니다.',
    examples: '가계부, 습관 기록, 세금 정산',
    preview: '빠른 입력 · 자동 집계·리포트 · 백업 · 소셜 화면 없음',
    effects: {
      prd: [
        '역할은 사용자 1종(필요하면 운영자)으로 둔다.',
        '리스크에 기록이 귀찮아 생기는 이탈과 데이터 유실을 넣는다. 성공 지표에 주간 기록 일수, 30일 잔존율을 넣는다.',
      ],
      fs: ['세 번 누르면 끝나는 빠른 입력, 기록 수정, 기간별 자동 집계·통계, 목표·리마인드, 백업·내보내기, 첫 사용 빈 상태 안내를 넣는다.'],
      ia: [
        '홈은 오늘 요약 대시보드로 하고 어디서든 한 번에 입력하게 한다. 기록 목록·달력, 통계·리포트, 설정을 둔다.',
        '피드·팔로우 같은 소셜 화면은 만들지 않는다.',
      ],
      flow: ['첫 실행에서 첫 기록까지, 매일 기록 루프(알림→입력→요약), 주간 리포트 확인 플로우를 만든다.'],
    },
    followupHints: ['기록을 어떻게 넣는지', '기기 사이에 이어지는지', '다른 사람과 나누는지'],
  },
  learning: {
    key: 'learning',
    label: '콘텐츠·학습',
    emoji: '🎬',
    criterion: '운영자·강사가 만든 콘텐츠를 보고 진도를 쌓는다.',
    examples: '온라인 강의, 어학 앱, 뉴스레터 아카이브',
    preview: '코스→레슨 · 진도 저장 · 퀴즈·수료',
    effects: {
      prd: [
        '역할은 학습자와 강사·콘텐츠 제공자로 둔다.',
        '리스크에 낮은 완주율과 콘텐츠 제작 비용·저작권을 넣는다. 성공 지표에 완주율과 주간 학습 시간을 넣는다.',
      ],
      fs: ['코스 → 단원 → 레슨 구조, 이용 권한, 진도 저장·이어 보기, 퀴즈·과제 제출과 피드백, 수료를 넣는다.'],
      ia: ['코스 목록·상세(커리큘럼), 학습 화면(진도 표시), 내 학습(진행 중/완료), 퀴즈·과제, 강사 메뉴를 둔다.'],
      flow: ['코스를 찾아 첫 레슨을 마치기까지, 이어 학습, 퀴즈 실패 → 재도전 분기, 수료 플로우를 만든다.'],
    },
    followupHints: ['콘텐츠를 누가 만드는지', '배운 것을 어떻게 확인하는지'],
  },
  directory: {
    key: 'directory',
    label: '정보 찾기',
    emoji: '🔎',
    criterion: '모아 둔 정보를 검색·비교·저장하는 것이 핵심이고, 거래는 서비스 밖에서 일어난다.',
    examples: '맛집 지도, 병원 찾기, 정책 모음',
    preview: '검색·필터 · 상세 · 저장 · 정보 오류 제보',
    effects: {
      prd: [
        '리스크에 데이터 확보·최신성(누가 채우고 갱신하는가)과 잘못된 정보를 넣는다. 데이터 출처를 제약사항에 적는다.',
        '성공 지표에 검색 후 상세 진입률과 저장 수를 넣는다.',
      ],
      fs: ['데이터 등록 경로(운영자 등록/외부 연동/사용자 제보), 검색·필터·정렬, 상세, 저장, 정보 오류 제보를 넣는다. 위치 기반이면 목록/지도 전환을 넣는다.'],
      ia: ['홈(추천·카테고리), 검색 결과, 상세, 저장 목록, 제보를 둔다. 운영 쪽에 데이터 등록·검수를 둔다.'],
      flow: ['검색 → 상세 → 저장, 결과 없음 분기(조건 완화 제안), 제보 → 반영 플로우를 만든다.'],
    },
    followupHints: ['정보를 누가 채우는지', '지도로 보여 주는지'],
  },
};

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES) as ArchetypeKey[];

export function isArchetypeKey(value: unknown): value is ArchetypeKey {
  return typeof value === 'string' && value in ARCHETYPES;
}

/* ------------------------------------------------------------------ */
/* 함께 고려할 신호                                                       */
/* ------------------------------------------------------------------ */

export const CAUTIONS: Record<CautionKey, { label: string; effect: string }> = {
  location: {
    label: '위치 정보',
    effect: '위치정보 수집·이용 동의 화면을 넣고, 위치기반서비스 사업 신고 검토를 제약사항에 적는다.',
  },
  meeting: {
    label: '대면 만남',
    effect: '처음 만나는 사용자끼리의 안전장치(본인 확인, 신고·차단, 만남 전 안내)를 기능과 리스크에 넣는다.',
  },
  minor: {
    label: '미성년 이용',
    effect: '만 14세 미만 가입 시 법정대리인 동의 절차를 검토해 넣는다.',
  },
  health: {
    label: '건강 정보',
    effect: '건강 정보는 민감정보 별도 동의를 받고, 진단·처방으로 오해될 표현을 피한다는 점을 제약사항에 적는다.',
  },
  money: {
    label: '돈·금융',
    effect: '금액 계산 규칙(반올림·통화)과 암호화 저장, 세무·투자 조언으로 오해될 표현 금지를 제약사항에 적는다.',
  },
};

export const CAUTION_KEYS = Object.keys(CAUTIONS) as CautionKey[];

export function isCautionKey(value: unknown): value is CautionKey {
  return typeof value === 'string' && value in CAUTIONS;
}

/**
 * 어디서 왔든(AI 응답·가져온 파일) 구조 값을 믿지 않고 다시 세운다.
 * 형식이 아니면 undefined.
 */
export function normalizeStructure(value: unknown): BriefStructure | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const primary = raw.primary === 'none' ? 'none' : isArchetypeKey(raw.primary) ? raw.primary : null;
  if (!primary) return undefined;
  const secondary =
    primary !== 'none' && isArchetypeKey(raw.secondary) && raw.secondary !== primary ? raw.secondary : undefined;
  const source = raw.source === 'user' || raw.source === 'ai' || raw.source === 'rule' ? raw.source : 'ai';
  const cautions = Array.isArray(raw.cautions) ? [...new Set(raw.cautions.filter(isCautionKey))] : [];
  const reason = typeof raw.reason === 'string' ? raw.reason.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return {
    primary,
    ...(secondary ? { secondary } : {}),
    source,
    ...(typeof raw.twoSided === 'boolean' ? { twoSided: raw.twoSided } : {}),
    ...(cautions.length > 0 ? { cautions } : {}),
    ...(reason ? { reason } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 키워드 추정 — AI 가 꺼졌거나 실패했을 때                               */
/* ------------------------------------------------------------------ */

/**
 * 업종 단어가 아니라 **구조 신호**로 본다. "공유" 처럼 여러 구조에 다 나오는 말은 넣지 않는다.
 * 앞에 있는 것이 이긴다 — 동점이면 매칭·예약처럼 문서를 크게 바꾸는 쪽을 먼저 둔다.
 */
const SIGNALS: Record<ArchetypeKey, string[]> = {
  matching: ['매칭', '중개', '연결', '이어주', '이어 주', '빌려', '대여', '렌탈', '견적', '고수', '구인', '구직', '메이트', '중고', '거래', '판매자', '전문가 찾'],
  booking: ['예약', '부킹', '스케줄', '좌석', '진료', '슬롯', '시간 선택', '클래스 신청'],
  commerce: ['쇼핑', '쇼핑몰', '스토어', '상품', '장바구니', '주문', '배송', '구독 박스'],
  community: ['커뮤니티', '게시판', '피드', '댓글', '팔로우', 'sns', '후기 공유', '동호회'],
  workspace: ['사내', '팀', '협업', '워크스페이스', '업무', '관리 도구', '학원 관리', 'crm', '직원', '구성원'],
  personal: ['가계부', '기록', '습관', '일기', '다이어리', '나만의', '정산', '세금', '트래킹', '지출'],
  learning: ['강의', '학습', '수업', '코스', '퀴즈', '어학', '튜토리얼', '교육 콘텐츠'],
  directory: ['찾기', '지도', '검색', '비교', '모음', '추천 정보', '맛집', '정보 제공'],
};

const CAUTION_SIGNALS: Record<CautionKey, string[]> = {
  location: ['위치', '동네', '근처', '지도', '반경', 'gps'],
  meeting: ['만남', '산책', '메이트', '직거래', '방문'],
  minor: ['학생', '청소년', '아이', '어린이', '초등', '중학생', '고등학생', '자녀'],
  health: ['건강', '진료', '병원', '식단', '운동', '수면', '복약', '다이어트'],
  money: ['결제', '정산', '세금', '가계부', '금융', '송금', '투자', '대출', '지출'],
};

export function guessStructure(text: string): BriefStructure | undefined {
  const haystack = text.toLowerCase();
  const scored = ARCHETYPE_KEYS.map((key) => ({
    key,
    score: SIGNALS[key].reduce((acc, word) => acc + (haystack.includes(word) ? 1 : 0), 0),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return undefined;

  const cautions = CAUTION_KEYS.filter((key) => CAUTION_SIGNALS[key].some((w) => haystack.includes(w)));
  const primary = scored[0].key;
  return {
    primary,
    ...(scored[1] ? { secondary: scored[1].key } : {}),
    source: 'rule',
    ...(primary === 'matching'
      ? { twoSided: !['메이트', '모임', '친구'].some((w) => haystack.includes(w)) }
      : {}),
    ...(cautions.length > 0 ? { cautions } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 프롬프트                                                             */
/* ------------------------------------------------------------------ */

function matchingShape(structure: BriefStructure): string {
  return structure.twoSided === false
    ? '같은 처지의 사용자끼리 잇는다 — 모든 사용자가 요청도 하고 응할 수도 있는 하나의 역할로 두고, 시나리오에서 요청한 사람과 응한 사람을 구분한다.'
    : '제공하는 쪽과 찾는 쪽이 따로 있다 — 두 역할을 따로 정의하고 각각의 권한을 적는다. 한 사람이 양쪽을 겸할 수 있는지 명시한다.';
}

/** 모든 프롬프트의 서비스 정보에 들어가는 한 줄. */
export function structureLine(structure: BriefStructure | undefined): string {
  if (!structure || structure.primary === 'none') return '';
  const main = ARCHETYPES[structure.primary];
  const sub = structure.secondary ? ARCHETYPES[structure.secondary] : null;
  const label = `${main.label}(주)${sub ? ` + ${sub.label}(보조)` : ''}`;
  const tag = structure.source === 'user' ? '사용자 확인' : 'AI 추정';
  return `서비스 구조: ${label} — ${main.criterion} [${tag}]`;
}

/**
 * 산출물별 구조 지침. 그 문서 몫만 넣는다.
 *
 * 강도를 출처로 나눈다. 사용자가 확인한 것은 사실이고, AI·키워드 추정은 가설이다 —
 * 틀린 추정을 "반드시" 로 넣으면 문서 전체가 엉뚱한 구조로 나온다.
 */
export function structureBlock(brief: PlanBrief, artifact: ArtifactKey): string {
  const structure = brief.structure;
  if (!structure || structure.primary === 'none') return '';

  const lines: string[] = [];
  const confirmed = structure.source === 'user';
  lines.push(
    confirmed
      ? '## 서비스 구조에 맞춘 설계 지침 (사용자가 확인함 — 반드시 반영)'
      : '## 서비스 구조에 맞춘 설계 지침 (AI 추정 — 기본 구조로 삼되, 서비스 아이디어 설명과 명백히 어긋나면 아이디어를 따른다)',
  );

  const main = ARCHETYPES[structure.primary];
  lines.push(`주 유형: ${main.label}`);
  if (structure.primary === 'matching' && (artifact === 'prd' || artifact === 'fs')) {
    lines.push(`- ${matchingShape(structure)}`);
  }

  if (artifact === 'wireframe') {
    lines.push(`- 화면 문구와 블록은 이 구조의 핵심 요소(${main.preview})가 드러나게 짠다.`);
  } else {
    for (const line of main.effects[artifact]) lines.push(`- ${line}`);
    if (structure.secondary) {
      const sub = ARCHETYPES[structure.secondary];
      lines.push(`보조 유형: ${sub.label} — 주 유형의 흐름 안에 붙인다. 별도 최상위 메뉴로 떼지 않는다.`);
      lines.push(`- ${sub.effects[artifact][0]}`);
    }
  }

  if (artifact === 'prd' || artifact === 'fs') {
    for (const key of structure.cautions ?? []) {
      lines.push(`- 함께 검토(${CAUTIONS[key].label}): ${CAUTIONS[key].effect}`);
    }
  }

  lines.push("위 '확정된 요구사항'(사용자가 직접 고른 것)과 어긋나는 지침은 버리고 확정된 요구사항을 따른다.");
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 아이디어 줄                                                          */
/* ------------------------------------------------------------------ */

/**
 * 아이디어 칸에 넣는 줄. 결제·특징·차별점은 넣지 않는다 — 각각 4단계 수익 질문,
 * 3단계 '반드시 포함할 기능', 3단계 '참고 서비스와 다른 점' 이 묻는다.
 */
export const IDEA_LINES = [
  { label: '해결할 문제', example: '동네 풋살장 빈 시간을 전화로 일일이 확인해야 한다' },
  { label: '해결 방법', example: '구장별 빈 시간을 한 화면에서 보고 바로 예약한다' },
  { label: '핵심 행동', example: '구장 검색 → 시간 선택 → 팀원 초대' },
] as const;

export type IdeaLineLabel = (typeof IDEA_LINES)[number]['label'];

const LINE_RE = (label: string) => new RegExp(`^\\s*${label}\\s*[:：]\\s*(.*)$`, 'm');

/** 그 줄이 있고 내용이 들어 있는가 */
export function ideaLineFilled(idea: string, label: string): boolean {
  const match = LINE_RE(label).exec(idea);
  return Boolean(match && match[1].trim());
}

export function ideaHasLine(idea: string, label: string): boolean {
  return LINE_RE(label).test(idea);
}

/** 줄을 끝에 덧붙인다. 이미 있으면 그대로. 커서를 둘 위치도 함께 준다. */
export function insertIdeaLine(idea: string, label: string, text = ''): { idea: string; cursor: number } {
  const re = LINE_RE(label);
  const match = re.exec(idea);
  if (match) {
    if (text && !match[1].trim()) {
      const start = match.index + match[0].length - match[1].length;
      const next = idea.slice(0, start) + text + idea.slice(match.index + match[0].length);
      return { idea: next, cursor: start + text.length };
    }
    return { idea, cursor: match.index + match[0].length };
  }
  const head = idea.replace(/\s+$/, '');
  const next = `${head}${head ? '\n' : ''}${label}: ${text}`;
  return { idea: next, cursor: next.length };
}

/** 라벨만 있고 내용이 빈 줄을 지운다 — 저장할 때. */
export function stripEmptyIdeaLines(idea: string): string {
  let next = idea;
  for (const { label } of IDEA_LINES) {
    next = next.replace(new RegExp(`^\\s*${label}\\s*[:：]\\s*$\\n?`, 'gm'), '');
  }
  return next.trim();
}

/** 라벨을 뺀 실제 내용이 있는가 — 필수 검사용. 빈 틀만으로는 통과시키지 않는다. */
export function ideaHasContent(idea: string): boolean {
  return stripEmptyIdeaLines(idea).replace(/^\s*[^:\n]{1,10}[:：]/gm, '').trim().length > 0;
}
