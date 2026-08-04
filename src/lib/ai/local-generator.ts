/**
 * 내장 생성기.
 *
 * API 키가 없어도 앱이 완전히 동작하도록, 브리프에서 도메인을 추정해
 * 규칙 기반으로 초안을 만든다. AI 생성과 동일한 스키마를 반환하므로 이후 파이프라인은
 * 어느 쪽이 만들었는지 구분하지 않는다.
 */

import { PLATFORM_LABEL, type ArtifactKey, type Plan, type PlanBrief } from '../types';
import type {
  ArtifactDraftMap,
  FlowDraft,
  FsDraft,
  IaDraft,
  PrdDraft,
  WireframeDraft,
} from './schemas';

interface DomainFeature {
  name: string;
  description: string;
}

interface DomainRequirement {
  title: string;
  description: string;
  category: string;
  priority: 'P0' | 'P1' | 'P2';
  features: DomainFeature[];
}

interface DomainKit {
  id: string;
  label: string;
  keywords: string[];
  /** 서비스가 다루는 핵심 객체 */
  noun: string;
  /** 핵심 행동 */
  verb: string;
  requirements: DomainRequirement[];
  /** 도메인 고유 화면 */
  pages: { name: string; path: string; description: string; children?: string[] }[];
  values: string[];
}

const COMMON_REQUIREMENTS: DomainRequirement[] = [
  {
    title: '회원 가입 및 인증',
    description: '이메일과 소셜 계정으로 가입하고 로그인 상태를 유지한다.',
    category: '회원',
    priority: 'P0',
    features: [
      { name: '이메일 회원가입', description: '이메일 인증을 거쳐 계정을 생성한다.' },
      { name: '소셜 로그인', description: '카카오·구글 계정으로 별도 가입 없이 로그인한다.' },
      { name: '비밀번호 재설정', description: '이메일로 받은 링크로 비밀번호를 다시 설정한다.' },
    ],
  },
  {
    title: '프로필 및 계정 관리',
    description: '사용자가 자신의 정보와 활동 내역을 확인하고 수정한다.',
    category: '회원',
    priority: 'P1',
    features: [
      { name: '프로필 조회·수정', description: '닉네임, 프로필 이미지, 연락처를 수정한다.' },
      { name: '활동 내역 조회', description: '내가 남긴 기록을 한 화면에서 확인한다.' },
      { name: '회원 탈퇴', description: '탈퇴 사유를 남기고 계정을 비활성화한다.' },
    ],
  },
  {
    title: '알림',
    description: '사용자에게 필요한 시점에 알림을 전달한다.',
    category: '공통',
    priority: 'P1',
    features: [
      { name: '인앱 알림함', description: '읽음/안읽음 상태와 함께 알림 목록을 제공한다.' },
      { name: '알림 수신 설정', description: '알림 종류별로 수신 여부를 켜고 끈다.' },
    ],
  },
  {
    title: '관리자 운영 도구',
    description: '운영자가 데이터와 사용자를 관리한다.',
    category: '관리자',
    priority: 'P1',
    features: [
      { name: '회원 관리', description: '회원을 검색하고 상태를 변경한다.' },
      { name: '콘텐츠 관리', description: '등록된 데이터를 검수하고 노출 여부를 바꾼다.' },
      { name: '운영 대시보드', description: '핵심 지표를 한 화면에서 확인한다.' },
    ],
  },
];

const KITS: DomainKit[] = [
  {
    id: 'commerce',
    label: '커머스',
    keywords: ['쇼핑', '커머스', '상품', '판매', '스토어', '마켓', '구매', '결제', '주문', '이커머스'],
    noun: '상품',
    verb: '구매',
    values: ['원하는 상품을 빠르게 찾는다', '결제까지 이탈 없이 끝난다', '주문 상태를 항상 알 수 있다'],
    requirements: [
      {
        title: '상품 탐색',
        description: '사용자가 원하는 상품을 검색과 필터로 찾는다.',
        category: '상품',
        priority: 'P0',
        features: [
          { name: '상품 목록', description: '카테고리별로 상품을 정렬해 보여준다.' },
          { name: '상품 검색', description: '키워드로 상품명과 브랜드를 검색한다.' },
          { name: '필터·정렬', description: '가격대, 브랜드, 평점으로 결과를 좁힌다.' },
          { name: '상품 상세', description: '이미지, 옵션, 배송 정보, 리뷰를 확인한다.' },
        ],
      },
      {
        title: '장바구니 및 주문',
        description: '선택한 상품을 담고 결제까지 완료한다.',
        category: '주문',
        priority: 'P0',
        features: [
          { name: '장바구니', description: '상품과 옵션, 수량을 담고 수정한다.' },
          { name: '주문서 작성', description: '배송지와 결제 수단을 입력한다.' },
          { name: '결제', description: 'PG 를 연동해 카드·간편결제로 결제한다.' },
          { name: '주문 내역·배송 조회', description: '주문 상태와 운송장을 확인한다.' },
        ],
      },
      {
        title: '리뷰와 찜',
        description: '구매 경험을 남기고 관심 상품을 저장한다.',
        category: '상품',
        priority: 'P1',
        features: [
          { name: '리뷰 작성', description: '별점과 사진을 포함한 후기를 남긴다.' },
          { name: '찜하기', description: '관심 상품을 저장하고 모아본다.' },
        ],
      },
    ],
    pages: [
      { name: '홈', path: '/', description: '기획전과 추천 상품을 노출하는 첫 화면.' },
      {
        name: '상품',
        path: '/products',
        description: '상품을 탐색하는 영역.',
        children: ['상품 목록', '상품 상세', '검색 결과'],
      },
      {
        name: '주문',
        path: '/orders',
        description: '장바구니부터 결제까지의 영역.',
        children: ['장바구니', '주문서', '주문 완료', '주문 내역'],
      },
    ],
  },
  {
    id: 'community',
    label: '커뮤니티',
    keywords: ['커뮤니티', '게시판', '소셜', '피드', '모임', '댓글', '공유', '팔로우', 'sns'],
    noun: '게시글',
    verb: '공유',
    values: ['말 걸기 쉬운 분위기', '좋은 글이 묻히지 않는 노출', '건강한 운영'],
    requirements: [
      {
        title: '피드와 게시글',
        description: '사용자가 글을 쓰고 읽는다.',
        category: '콘텐츠',
        priority: 'P0',
        features: [
          { name: '피드 조회', description: '최신순·인기순으로 게시글을 보여준다.' },
          { name: '게시글 작성', description: '텍스트와 이미지를 포함한 글을 등록한다.' },
          { name: '게시글 상세', description: '본문과 댓글을 한 화면에서 본다.' },
          { name: '주제별 채널', description: '관심 주제로 나뉜 채널을 구독한다.' },
        ],
      },
      {
        title: '반응과 관계',
        description: '다른 사용자와 상호작용한다.',
        category: '소셜',
        priority: 'P0',
        features: [
          { name: '댓글·대댓글', description: '게시글에 의견을 남기고 답글을 단다.' },
          { name: '좋아요·스크랩', description: '마음에 드는 글에 반응하고 저장한다.' },
          { name: '팔로우', description: '관심 있는 사용자를 팔로우한다.' },
        ],
      },
      {
        title: '신고 및 운영',
        description: '커뮤니티를 건강하게 유지한다.',
        category: '운영',
        priority: 'P1',
        features: [
          { name: '신고하기', description: '부적절한 글과 댓글을 신고한다.' },
          { name: '차단', description: '특정 사용자의 콘텐츠를 보이지 않게 한다.' },
        ],
      },
    ],
    pages: [
      { name: '홈 피드', path: '/', description: '구독 채널과 인기 글이 섞인 첫 화면.' },
      {
        name: '게시판',
        path: '/posts',
        description: '주제별 글을 모아 보는 영역.',
        children: ['채널 목록', '게시글 목록', '게시글 상세', '글쓰기'],
      },
      {
        name: '프로필',
        path: '/u/:userId',
        description: '사용자 활동을 모아 보는 영역.',
        children: ['작성 글', '스크랩', '팔로워 목록'],
      },
    ],
  },
  {
    id: 'booking',
    label: '예약',
    keywords: ['예약', '부킹', '스케줄', '일정', '방문', '좌석', '진료', '상담', '클래스'],
    noun: '예약',
    verb: '예약',
    values: ['빈 시간을 한눈에', '노쇼 없는 확정', '변경이 쉬운 예약'],
    requirements: [
      {
        title: '예약 대상 탐색',
        description: '예약할 곳과 시간을 찾는다.',
        category: '예약',
        priority: 'P0',
        features: [
          { name: '업체·클래스 목록', description: '지역과 카테고리로 예약 대상을 찾는다.' },
          { name: '상세 정보', description: '소개, 위치, 가격, 후기를 확인한다.' },
          { name: '가능 시간 조회', description: '달력에서 예약 가능한 슬롯을 확인한다.' },
        ],
      },
      {
        title: '예약 진행',
        description: '예약을 신청하고 확정한다.',
        category: '예약',
        priority: 'P0',
        features: [
          { name: '예약 신청', description: '인원과 요청사항을 입력해 신청한다.' },
          { name: '예약 확정·거절', description: '운영자가 신청을 승인하거나 거절한다.' },
          { name: '예약 변경·취소', description: '정책에 따라 일정을 변경하거나 취소한다.' },
          { name: '리마인더 알림', description: '예약 하루 전과 한 시간 전에 알린다.' },
        ],
      },
      {
        title: '이용 내역',
        description: '지난 예약과 후기를 관리한다.',
        category: '마이',
        priority: 'P1',
        features: [
          { name: '예약 내역', description: '예정·완료·취소 예약을 나눠 보여준다.' },
          { name: '후기 작성', description: '이용 후 별점과 후기를 남긴다.' },
        ],
      },
    ],
    pages: [
      { name: '홈', path: '/', description: '추천 업체와 다가오는 예약을 보여준다.' },
      {
        name: '탐색',
        path: '/search',
        description: '예약 대상을 찾는 영역.',
        children: ['목록', '지도 보기', '업체 상세'],
      },
      {
        name: '예약',
        path: '/reservations',
        description: '예약 신청과 관리를 담당하는 영역.',
        children: ['시간 선택', '예약 신청', '예약 완료', '예약 내역'],
      },
    ],
  },
  {
    id: 'learning',
    label: '교육/학습',
    keywords: ['학습', '교육', '강의', '수업', '공부', '퀴즈', '문제', '코스', '튜터', '학원'],
    noun: '강의',
    verb: '학습',
    values: ['끝까지 완주하게 만든다', '내 수준에 맞는 다음 단계', '기록으로 남는 성장'],
    requirements: [
      {
        title: '학습 콘텐츠',
        description: '강의와 학습 자료를 제공한다.',
        category: '콘텐츠',
        priority: 'P0',
        features: [
          { name: '코스 목록', description: '난이도와 분야로 코스를 탐색한다.' },
          { name: '코스 상세', description: '커리큘럼과 미리보기를 제공한다.' },
          { name: '강의 수강', description: '영상·텍스트 강의를 순서대로 학습한다.' },
        ],
      },
      {
        title: '학습 관리',
        description: '진도와 성취를 추적한다.',
        category: '학습',
        priority: 'P0',
        features: [
          { name: '진도 추적', description: '수강한 강의와 남은 강의를 표시한다.' },
          { name: '퀴즈·과제', description: '학습 후 이해도를 확인한다.' },
          { name: '학습 리포트', description: '학습 시간과 정답률을 시각화한다.' },
        ],
      },
      {
        title: '동기 부여',
        description: '학습을 지속하게 만든다.',
        category: '학습',
        priority: 'P2',
        features: [
          { name: '학습 스트릭', description: '연속 학습 일수를 기록한다.' },
          { name: '수료증 발급', description: '코스 완주 시 수료증을 발급한다.' },
        ],
      },
    ],
    pages: [
      { name: '홈', path: '/', description: '이어서 학습하기와 추천 코스를 노출한다.' },
      {
        name: '코스',
        path: '/courses',
        description: '학습 콘텐츠 영역.',
        children: ['코스 목록', '코스 상세', '강의 플레이어', '퀴즈'],
      },
      {
        name: '내 학습',
        path: '/me/learning',
        description: '학습 현황 영역.',
        children: ['수강 중', '완료', '학습 리포트'],
      },
    ],
  },
  {
    id: 'productivity',
    label: '협업/생산성',
    keywords: ['협업', '업무', '태스크', '프로젝트', '관리', '팀', '문서', '일정관리', '생산성', '워크스페이스'],
    noun: '업무',
    verb: '관리',
    values: ['상태를 묻지 않아도 아는 팀', '흩어지지 않는 기록', '빠른 손맛'],
    requirements: [
      {
        title: '워크스페이스와 팀',
        description: '팀 단위로 공간을 나눠 협업한다.',
        category: '팀',
        priority: 'P0',
        features: [
          { name: '워크스페이스 생성', description: '팀 공간을 만들고 이름과 로고를 설정한다.' },
          { name: '멤버 초대', description: '이메일이나 링크로 멤버를 초대한다.' },
          { name: '권한 관리', description: '멤버별 역할과 접근 권한을 설정한다.' },
        ],
      },
      {
        title: '업무 관리',
        description: '할 일을 만들고 진행 상태를 추적한다.',
        category: '업무',
        priority: 'P0',
        features: [
          { name: '업무 생성·수정', description: '제목, 담당자, 마감일, 우선순위를 지정한다.' },
          { name: '보드·리스트 보기', description: '상태별 보드와 목록을 전환해 본다.' },
          { name: '댓글·멘션', description: '업무에 의견을 남기고 멤버를 호출한다.' },
          { name: '파일 첨부', description: '업무에 관련 파일을 붙인다.' },
        ],
      },
      {
        title: '현황 파악',
        description: '팀의 진행 상황을 한눈에 본다.',
        category: '리포트',
        priority: 'P1',
        features: [
          { name: '대시보드', description: '지연 업무와 이번 주 마감을 모아 보여준다.' },
          { name: '활동 로그', description: '누가 무엇을 바꿨는지 기록한다.' },
        ],
      },
    ],
    pages: [
      { name: '대시보드', path: '/', description: '팀 현황과 내 업무를 요약한다.' },
      {
        name: '프로젝트',
        path: '/projects',
        description: '업무를 관리하는 영역.',
        children: ['프로젝트 목록', '보드 뷰', '리스트 뷰', '업무 상세'],
      },
      {
        name: '팀 설정',
        path: '/settings/team',
        description: '워크스페이스 설정 영역.',
        children: ['멤버 목록', '권한 설정', '초대'],
      },
    ],
  },
  {
    id: 'health',
    label: '헬스/건강',
    keywords: ['운동', '건강', '헬스', '식단', '다이어트', '기록', '습관', '수면', '칼로리', '트래킹'],
    noun: '기록',
    verb: '기록',
    values: ['기록하는 데 3초', '변화가 눈에 보인다', '혼자여도 계속하게 된다'],
    requirements: [
      {
        title: '기록',
        description: '사용자가 매일의 활동을 남긴다.',
        category: '기록',
        priority: 'P0',
        features: [
          { name: '빠른 기록 입력', description: '자주 쓰는 항목을 눌러 바로 기록한다.' },
          { name: '상세 기록', description: '시간, 강도, 메모를 함께 남긴다.' },
          { name: '기록 수정·삭제', description: '지난 기록을 되돌아보고 고친다.' },
        ],
      },
      {
        title: '분석과 목표',
        description: '기록을 의미 있는 정보로 바꾼다.',
        category: '분석',
        priority: 'P0',
        features: [
          { name: '목표 설정', description: '주간·월간 목표를 정한다.' },
          { name: '통계 그래프', description: '기간별 추이를 그래프로 본다.' },
          { name: '달성 리포트', description: '주간 리포트를 만들어 알림으로 보낸다.' },
        ],
      },
      {
        title: '지속 장치',
        description: '습관이 끊기지 않게 돕는다.',
        category: '동기',
        priority: 'P2',
        features: [
          { name: '리마인더', description: '설정한 시간에 기록을 유도한다.' },
          { name: '스트릭·배지', description: '연속 기록과 성취를 시각화한다.' },
        ],
      },
    ],
    pages: [
      { name: '오늘', path: '/', description: '오늘의 목표와 기록을 보여주는 첫 화면.' },
      {
        name: '기록',
        path: '/records',
        description: '기록 관리 영역.',
        children: ['기록 입력', '기록 상세', '달력 보기'],
      },
      {
        name: '리포트',
        path: '/reports',
        description: '통계 영역.',
        children: ['주간 리포트', '월간 통계', '목표 관리'],
      },
    ],
  },
  {
    id: 'finance',
    label: '금융/가계부',
    keywords: ['가계부', '금융', '지출', '자산', '투자', '송금', '정산', '세금', '회계', '수입'],
    noun: '거래',
    verb: '관리',
    values: ['어디에 썼는지 바로 안다', '입력이 귀찮지 않다', '숫자를 믿을 수 있다'],
    requirements: [
      {
        title: '거래 관리',
        description: '수입과 지출을 기록하고 분류한다.',
        category: '거래',
        priority: 'P0',
        features: [
          { name: '거래 입력', description: '금액, 분류, 결제수단, 메모를 입력한다.' },
          { name: '자동 분류', description: '가맹점명으로 카테고리를 추천한다.' },
          { name: '거래 내역 조회', description: '기간과 분류로 내역을 필터링한다.' },
        ],
      },
      {
        title: '예산과 분석',
        description: '돈의 흐름을 파악한다.',
        category: '분석',
        priority: 'P0',
        features: [
          { name: '예산 설정', description: '분류별 월 예산을 정하고 초과를 알린다.' },
          { name: '지출 리포트', description: '분류별 비중과 전월 대비 변화를 보여준다.' },
          { name: '고정지출 관리', description: '구독과 정기 결제를 모아 관리한다.' },
        ],
      },
      {
        title: '자산 현황',
        description: '보유 자산을 한 화면에서 본다.',
        category: '자산',
        priority: 'P1',
        features: [
          { name: '계좌 등록', description: '계좌와 카드를 등록해 잔액을 관리한다.' },
          { name: '자산 요약', description: '총자산과 순자산 추이를 보여준다.' },
        ],
      },
    ],
    pages: [
      { name: '홈', path: '/', description: '이번 달 지출과 예산 소진율을 요약한다.' },
      {
        name: '거래 내역',
        path: '/transactions',
        description: '거래 관리 영역.',
        children: ['내역 목록', '거래 입력', '거래 상세'],
      },
      {
        name: '리포트',
        path: '/reports',
        description: '분석 영역.',
        children: ['월간 리포트', '분류별 분석', '예산 설정'],
      },
    ],
  },
  {
    id: 'generic',
    label: '일반',
    keywords: [],
    noun: '콘텐츠',
    verb: '이용',
    values: ['핵심 가치를 빨리 경험한다', '쓸수록 편해진다', '믿고 맡길 수 있다'],
    requirements: [
      {
        title: '핵심 기능 이용',
        description: '서비스의 주요 가치를 사용자가 직접 경험한다.',
        category: '핵심',
        priority: 'P0',
        features: [
          { name: '콘텐츠 목록', description: '주요 데이터를 목록으로 탐색한다.' },
          { name: '콘텐츠 상세', description: '선택한 항목의 상세 정보를 확인한다.' },
          { name: '콘텐츠 등록', description: '사용자가 새 항목을 등록한다.' },
          { name: '검색', description: '키워드로 원하는 항목을 찾는다.' },
        ],
      },
      {
        title: '온보딩',
        description: '처음 온 사용자가 핵심 가치를 빠르게 경험한다.',
        category: '온보딩',
        priority: 'P1',
        features: [
          { name: '서비스 소개', description: '3단계 슬라이드로 핵심 가치를 전달한다.' },
          { name: '초기 설정', description: '관심사를 골라 첫 화면을 개인화한다.' },
        ],
      },
    ],
    pages: [
      { name: '홈', path: '/', description: '서비스의 첫 화면.' },
      {
        name: '콘텐츠',
        path: '/items',
        description: '핵심 데이터를 다루는 영역.',
        children: ['목록', '상세', '등록'],
      },
    ],
  },
];

function pickKit(brief: PlanBrief): DomainKit {
  const haystack = [brief.title, brief.oneLiner, brief.idea, brief.purpose, brief.mustHave]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let best = KITS[KITS.length - 1];
  let bestScore = 0;
  for (const kit of KITS) {
    const score = kit.keywords.reduce(
      (acc, keyword) => acc + (haystack.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      best = kit;
      bestScore = score;
    }
  }
  return best;
}

function allRequirements(kit: DomainKit): DomainRequirement[] {
  return [...kit.requirements, ...COMMON_REQUIREMENTS];
}

/* ------------------------------------------------------------------ */
/* PRD                                                                  */
/* ------------------------------------------------------------------ */

function buildPrd(brief: PlanBrief): PrdDraft {
  const kit = pickKit(brief);
  const target = brief.targetUser || '핵심 사용자';
  const platform = PLATFORM_LABEL[brief.platform];

  return {
    overview: `${brief.title}은(는) ${target}을(를) 위한 ${kit.label} 서비스입니다. ${
      brief.oneLiner || `${kit.noun}을(를) ${kit.verb}하는 과정을 하나의 흐름으로 묶습니다.`
    } ${brief.idea} 첫 버전은 ${platform} 환경을 기준으로 만들며, 사용자가 가입 직후 핵심 기능을 한 번 이상 사용하는 것을 목표로 합니다.`,
    background: `현재 ${target}은(는) ${kit.noun} 관련 작업을 여러 도구에 나누어 처리하고 있어 흐름이 끊깁니다. 그 결과 필요한 정보를 다시 찾는 데 시간이 들고, 중간에 이탈하는 경우가 많습니다. ${brief.purpose || `이 서비스는 그 과정을 한 곳으로 모아 ${kit.verb} 완료까지 걸리는 단계를 줄이는 것을 목표로 합니다.`}`,
    goals: [
      {
        text: `${target}이(가) 가입 후 첫 ${kit.verb}까지 3분 안에 도달한다`,
        metric: '가입 → 첫 핵심 행동 완료 전환율 40% 이상',
      },
      {
        text: `${kit.noun}을(를) 찾고 처리하는 단계를 기존 대비 절반으로 줄인다`,
        metric: '핵심 과업 완료까지 평균 클릭 수 8회 이하',
      },
      {
        text: '한 번 쓴 사용자가 다시 돌아오게 만든다',
        metric: '가입 후 7일 재방문율 30% 이상',
      },
      {
        text: '운영자가 개발자 도움 없이 데이터를 관리할 수 있다',
        metric: '운영 요청 티켓 월 5건 이하',
      },
    ],
    personas: [
      {
        name: `${target} 대표 사용자`,
        summary: `${kit.noun}을(를) 자주 다루지만 도구를 따로 배울 시간은 없는 실사용자.`,
        needs: [
          `${kit.noun}을(를) 한 화면에서 확인하고 싶다`,
          '반복 작업을 최소한의 입력으로 끝내고 싶다',
          '모바일에서도 같은 작업을 하고 싶다',
        ],
        painPoints: [
          '정보가 여러 곳에 흩어져 매번 다시 찾는다',
          '입력할 항목이 많아 도중에 포기한다',
          '지금 상태가 어떤지 확인하려면 누군가에게 물어야 한다',
        ],
      },
      {
        name: '처음 방문한 잠재 사용자',
        summary: '서비스를 우연히 알게 되어 가치가 있는지 확인하려는 사람.',
        needs: ['가입 전에 무엇을 할 수 있는지 보고 싶다', '가입 절차가 짧았으면 좋겠다'],
        painPoints: ['가입해야만 화면을 볼 수 있어 부담스럽다', '무엇부터 해야 할지 모르겠다'],
      },
      {
        name: '운영 담당자',
        summary: '서비스에 쌓이는 데이터를 관리하고 문제를 처리하는 내부 사용자.',
        needs: ['이상 데이터를 빨리 찾고 싶다', '지표를 정기적으로 확인하고 싶다'],
        painPoints: ['데이터를 보려면 개발자에게 요청해야 한다', '문제가 생겨도 늦게 안다'],
      },
    ],
    roles: [
      {
        name: '비회원',
        description: '가입하지 않고 서비스를 둘러보는 사용자.',
        permissions: ['공개 화면 조회', '검색', '회원가입'],
      },
      {
        name: '일반 회원',
        description: '가입 후 핵심 기능을 이용하는 사용자.',
        permissions: [`${kit.noun} 조회`, `${kit.noun} 등록·수정`, '프로필 관리', '알림 설정'],
      },
      {
        name: '관리자',
        description: '서비스 데이터와 회원을 관리하는 운영자.',
        permissions: ['회원 관리', '콘텐츠 검수', '통계 조회', '공지 등록'],
      },
    ],
    environment: {
      platforms:
        brief.platform === 'app'
          ? ['iOS 앱', 'Android 앱']
          : brief.platform === 'both'
            ? ['반응형 웹', 'iOS 앱', 'Android 앱']
            : brief.platform === 'admin'
              ? ['데스크톱 웹 (어드민)']
              : ['반응형 웹'],
      devices:
        brief.platform === 'admin'
          ? ['데스크톱 1440px 이상']
          : ['모바일 375px 이상', '태블릿', '데스크톱 1280px 이상'],
      browsers: ['Chrome 최신 2개 버전', 'Safari 최신 2개 버전', 'Edge 최신 버전'],
    },
    coreValues: kit.values,
    successMetrics: [
      { name: '가입 전환율', target: '방문자 대비 가입 15% 이상' },
      { name: '핵심 행동 완료율', target: `가입자 중 첫 ${kit.verb} 완료 40% 이상` },
      { name: '7일 리텐션', target: '30% 이상' },
      { name: '평균 과업 완료 시간', target: '3분 이내' },
    ],
    inScope: [
      '회원 가입과 로그인 (이메일, 소셜)',
      ...kit.requirements.map((r) => r.title),
      '인앱 알림',
      '기본 관리자 도구',
    ],
    outOfScope: [
      '다국어 지원',
      '오픈 API 및 외부 연동',
      '고급 통계·데이터 내보내기',
      '유료 구독 결제 (1차 범위 제외)',
    ],
    constraints: [
      '1차 릴리즈까지 8주',
      '개발 인력 3명 (프론트 1, 백엔드 1, 디자인 1)',
      '개인정보는 국내 서버에만 저장',
      '접근성 WCAG 2.1 AA 수준 준수',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 기능명세서                                                           */
/* ------------------------------------------------------------------ */

function buildFs(brief: PlanBrief): FsDraft {
  const kit = pickKit(brief);
  const reqs = allRequirements(kit);

  const requirements = reqs.map((r) => ({
    title: r.title,
    description: r.description,
    category: r.category,
    priority: r.priority as string,
  }));

  const features: FsDraft['features'] = [];
  reqs.forEach((req, requirementIndex) => {
    req.features.forEach((f) => {
      features.push({
        requirementIndex,
        name: f.name,
        description: f.description,
        priority: req.priority,
      });
    });
  });

  // 우선순위가 가장 높은 기능 위주로 상세 명세를 만든다.
  const specifications: FsDraft['specifications'] = features
    .map((feature, featureIndex) => ({ feature, featureIndex }))
    .filter(({ feature }) => feature.priority === 'P0')
    .slice(0, 8)
    .map(({ feature, featureIndex }) => ({
      featureIndex,
      title: `${feature.name} 상세 동작`,
      actor: '일반 회원',
      precondition: '로그인 상태이며 해당 화면에 진입해 있다.',
      mainFlow: [
        `사용자가 ${feature.name} 화면에 진입한다.`,
        '시스템이 필요한 데이터를 불러와 화면에 표시한다.',
        '사용자가 항목을 선택하거나 값을 입력한다.',
        '시스템이 입력값을 검증한다.',
        '시스템이 결과를 저장하고 완료 상태를 화면에 표시한다.',
      ],
      exceptions: [
        '필수 값이 비어 있으면 해당 입력 아래에 오류 문구를 표시하고 저장하지 않는다.',
        '네트워크 오류가 발생하면 토스트로 알리고 재시도 버튼을 노출한다.',
        '권한이 없는 사용자가 접근하면 로그인 화면으로 이동시킨다.',
      ],
      acceptanceCriteria: [
        '정상 입력 시 결과가 저장되고 목록에 즉시 반영된다.',
        '오류 상황에서 사용자가 입력한 값이 사라지지 않는다.',
        '모바일 375px 폭에서 레이아웃이 깨지지 않는다.',
      ],
      priority: feature.priority,
    }));

  return { requirements, features, specifications };
}

/* ------------------------------------------------------------------ */
/* 정보구조도                                                           */
/* ------------------------------------------------------------------ */

function buildIa(brief: PlanBrief, plan?: Plan): IaDraft {
  const kit = pickKit(brief);
  const pages: IaDraft['pages'] = [];

  const featureIdsByKeyword = (keyword: string): string[] => {
    if (!plan) return [];
    return plan.features
      .filter((f) => f.name.includes(keyword) || keyword.includes(f.name))
      .map((f) => f.id)
      .slice(0, 3);
  };

  const push = (
    page: Omit<IaDraft['pages'][number], 'parentIndex' | 'featureIds' | 'roles'> & {
      parentIndex: number;
      roles?: string[];
      featureIds?: string[];
    },
  ) => {
    pages.push({
      ...page,
      roles: page.roles ?? ['일반 회원'],
      featureIds: page.featureIds ?? [],
    });
    return pages.length - 1;
  };

  // 1 depth — 인증
  const authIndex = push({
    name: '인증',
    path: '/auth',
    description: '가입과 로그인을 담당하는 영역.',
    type: 'page',
    parentIndex: -1,
    roles: ['비회원'],
  });
  push({
    name: '로그인',
    path: '/auth/login',
    description: '이메일 또는 소셜 계정으로 로그인한다.',
    type: 'page',
    parentIndex: authIndex,
    roles: ['비회원'],
    featureIds: featureIdsByKeyword('로그인'),
  });
  push({
    name: '회원가입',
    path: '/auth/signup',
    description: '약관 동의 후 계정을 생성한다.',
    type: 'page',
    parentIndex: authIndex,
    roles: ['비회원'],
    featureIds: featureIdsByKeyword('회원가입'),
  });
  push({
    name: '비밀번호 재설정',
    path: '/auth/reset',
    description: '이메일로 재설정 링크를 받는다.',
    type: 'page',
    parentIndex: authIndex,
    roles: ['비회원'],
  });

  // 1 depth — 도메인 화면
  for (const group of kit.pages) {
    const parentIndex = push({
      name: group.name,
      path: group.path,
      description: group.description,
      type: 'page',
      parentIndex: -1,
    });
    for (const child of group.children ?? []) {
      push({
        name: child,
        path: `${group.path === '/' ? '' : group.path}/${child.replace(/\s+/g, '-')}`,
        description: `${group.name}의 ${child} 화면.`,
        type: child.includes('입력') || child.includes('작성') ? 'page' : 'page',
        parentIndex,
        featureIds: featureIdsByKeyword(child),
      });
    }
  }

  // 1 depth — 마이페이지
  const myIndex = push({
    name: '마이페이지',
    path: '/me',
    description: '내 정보와 활동을 관리하는 영역.',
    type: 'page',
    parentIndex: -1,
  });
  push({
    name: '프로필 수정',
    path: '/me/profile',
    description: '닉네임과 프로필 이미지를 수정한다.',
    type: 'page',
    parentIndex: myIndex,
    featureIds: featureIdsByKeyword('프로필'),
  });
  push({
    name: '알림함',
    path: '/me/notifications',
    description: '받은 알림을 확인한다.',
    type: 'page',
    parentIndex: myIndex,
    featureIds: featureIdsByKeyword('알림'),
  });
  push({
    name: '설정',
    path: '/me/settings',
    description: '알림 수신과 계정 설정을 변경한다.',
    type: 'page',
    parentIndex: myIndex,
  });
  push({
    name: '회원 탈퇴',
    path: '/me/withdraw',
    description: '탈퇴 사유를 남기고 계정을 비활성화한다.',
    type: 'modal',
    parentIndex: myIndex,
  });

  // 1 depth — 관리자
  const adminIndex = push({
    name: '관리자',
    path: '/admin',
    description: '운영자가 사용하는 영역.',
    type: 'page',
    parentIndex: -1,
    roles: ['관리자'],
  });
  push({
    name: '대시보드',
    path: '/admin/dashboard',
    description: '핵심 지표를 확인한다.',
    type: 'page',
    parentIndex: adminIndex,
    roles: ['관리자'],
  });
  push({
    name: '회원 관리',
    path: '/admin/users',
    description: '회원을 검색하고 상태를 변경한다.',
    type: 'page',
    parentIndex: adminIndex,
    roles: ['관리자'],
    featureIds: featureIdsByKeyword('회원 관리'),
  });
  push({
    name: '콘텐츠 관리',
    path: '/admin/contents',
    description: '등록 데이터를 검수한다.',
    type: 'page',
    parentIndex: adminIndex,
    roles: ['관리자'],
    featureIds: featureIdsByKeyword('콘텐츠 관리'),
  });

  return { pages };
}

/* ------------------------------------------------------------------ */
/* 유저 플로우                                                          */
/* ------------------------------------------------------------------ */

function buildFlow(brief: PlanBrief, plan?: Plan): FlowDraft {
  const kit = pickKit(brief);
  const pageId = (name: string): string =>
    plan?.iaPages.find((p) => p.name === name)?.id ?? '';

  return {
    flows: [
      {
        name: '회원가입 및 첫 이용',
        description: `처음 방문한 사용자가 가입 후 첫 ${kit.verb}까지 도달하는 흐름.`,
        actor: '비회원 → 일반 회원',
        nodes: [
          { key: 'n1', type: 'start', label: '서비스 진입', description: '', pageId: '' },
          {
            key: 'n2',
            type: 'screen',
            label: '홈 둘러보기',
            description: '가입 전에도 주요 화면을 볼 수 있다.',
            pageId: pageId(kit.pages[0]?.name ?? '홈'),
          },
          { key: 'n3', type: 'action', label: '가입하기 선택', description: '', pageId: '' },
          {
            key: 'n4',
            type: 'screen',
            label: '회원가입',
            description: '약관 동의 후 정보를 입력한다.',
            pageId: pageId('회원가입'),
          },
          { key: 'n5', type: 'decision', label: '이메일 인증 완료?', description: '', pageId: '' },
          {
            key: 'n6',
            type: 'system',
            label: '인증 메일 재발송',
            description: '3회까지 재발송한다.',
            pageId: '',
          },
          {
            key: 'n7',
            type: 'screen',
            label: '온보딩 · 관심사 선택',
            description: '첫 화면을 개인화한다.',
            pageId: '',
          },
          {
            key: 'n8',
            type: 'action',
            label: `첫 ${kit.verb} 실행`,
            description: '',
            pageId: '',
          },
          { key: 'n9', type: 'end', label: '핵심 가치 경험 완료', description: '', pageId: '' },
        ],
        edges: [
          { from: 'n1', to: 'n2', label: '' },
          { from: 'n2', to: 'n3', label: '' },
          { from: 'n3', to: 'n4', label: '' },
          { from: 'n4', to: 'n5', label: '' },
          { from: 'n5', to: 'n7', label: '완료' },
          { from: 'n5', to: 'n6', label: '미완료' },
          { from: 'n6', to: 'n5', label: '재확인' },
          { from: 'n7', to: 'n8', label: '' },
          { from: 'n8', to: 'n9', label: '' },
        ],
      },
      {
        name: `${kit.noun} ${kit.verb} 핵심 플로우`,
        description: `서비스의 핵심 가치를 사용하는 반복 흐름.`,
        actor: '일반 회원',
        nodes: [
          { key: 'm1', type: 'start', label: '로그인 상태로 진입', description: '', pageId: '' },
          {
            key: 'm2',
            type: 'screen',
            label: `${kit.noun} 목록`,
            description: '',
            pageId: pageId(kit.pages[1]?.children?.[0] ?? '목록'),
          },
          { key: 'm3', type: 'action', label: '검색·필터 적용', description: '', pageId: '' },
          { key: 'm4', type: 'decision', label: '결과가 있는가?', description: '', pageId: '' },
          {
            key: 'm5',
            type: 'screen',
            label: '빈 결과 안내',
            description: '조건 변경을 제안한다.',
            pageId: '',
          },
          { key: 'm6', type: 'screen', label: `${kit.noun} 상세`, description: '', pageId: '' },
          { key: 'm7', type: 'action', label: `${kit.verb} 실행`, description: '', pageId: '' },
          { key: 'm8', type: 'system', label: '결과 저장 및 알림 발송', description: '', pageId: '' },
          { key: 'm9', type: 'end', label: '완료 화면', description: '', pageId: '' },
        ],
        edges: [
          { from: 'm1', to: 'm2', label: '' },
          { from: 'm2', to: 'm3', label: '' },
          { from: 'm3', to: 'm4', label: '' },
          { from: 'm4', to: 'm6', label: '있음' },
          { from: 'm4', to: 'm5', label: '없음' },
          { from: 'm5', to: 'm3', label: '조건 변경' },
          { from: 'm6', to: 'm7', label: '' },
          { from: 'm7', to: 'm8', label: '' },
          { from: 'm8', to: 'm9', label: '' },
        ],
      },
      {
        name: '운영자 데이터 관리',
        description: '운영자가 문제 데이터를 발견하고 처리하는 흐름.',
        actor: '관리자',
        nodes: [
          { key: 'a1', type: 'start', label: '관리자 로그인', description: '', pageId: '' },
          {
            key: 'a2',
            type: 'screen',
            label: '운영 대시보드',
            description: '',
            pageId: pageId('대시보드'),
          },
          { key: 'a3', type: 'action', label: '신고·이상 항목 확인', description: '', pageId: '' },
          { key: 'a4', type: 'decision', label: '조치가 필요한가?', description: '', pageId: '' },
          { key: 'a5', type: 'action', label: '노출 중단 또는 회원 제재', description: '', pageId: '' },
          { key: 'a6', type: 'system', label: '처리 이력 기록 및 통보', description: '', pageId: '' },
          { key: 'a7', type: 'end', label: '처리 완료', description: '', pageId: '' },
        ],
        edges: [
          { from: 'a1', to: 'a2', label: '' },
          { from: 'a2', to: 'a3', label: '' },
          { from: 'a3', to: 'a4', label: '' },
          { from: 'a4', to: 'a5', label: '필요' },
          { from: 'a4', to: 'a7', label: '불필요' },
          { from: 'a5', to: 'a6', label: '' },
          { from: 'a6', to: 'a7', label: '' },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 와이어프레임                                                         */
/* ------------------------------------------------------------------ */

const LIST_KEYWORDS = ['목록', '리스트', '피드', '내역', '결과', '관리'];
const DETAIL_KEYWORDS = ['상세', '프로필', '리포트'];
const FORM_KEYWORDS = ['입력', '작성', '등록', '수정', '가입', '로그인', '설정', '신청', '주문서'];

function buildWireframes(brief: PlanBrief, plan?: Plan, pageIds?: string[]): WireframeDraft {
  const kit = pickKit(brief);
  const device = brief.platform === 'app' ? 'mobile' : 'desktop';
  const targets = (plan?.iaPages ?? []).filter((p) =>
    pageIds && pageIds.length > 0 ? pageIds.includes(p.id) : true,
  );

  const wireframes = targets.slice(0, 12).map((page) => {
    const name = page.name;
    const isList = LIST_KEYWORDS.some((k) => name.includes(k));
    const isForm = FORM_KEYWORDS.some((k) => name.includes(k));
    const isDetail = DETAIL_KEYWORDS.some((k) => name.includes(k));

    const blocks: WireframeDraft['wireframes'][number]['blocks'] = [
      {
        type: 'header',
        title: '상단 헤더',
        items: [`${brief.title} 로고`, '전역 검색', '알림 아이콘', '프로필 메뉴'],
        note: '스크롤 시 상단 고정.',
      },
    ];

    if (isForm) {
      blocks.push(
        {
          type: 'text',
          title: `${name}`,
          items: [`${name} 안내 문구`, '필수 항목 표시 안내'],
          note: '',
        },
        {
          type: 'form',
          title: '입력 폼',
          items: ['필수 입력 필드', '선택 입력 필드', '유효성 오류 메시지 영역', '약관 동의 체크박스'],
          note: '오류는 필드 바로 아래에 표시하고 첫 오류 필드로 포커스를 이동한다.',
        },
        {
          type: 'cta',
          title: '하단 액션',
          items: ['취소', `${name} 완료`],
          note: '필수 항목이 채워지기 전까지 완료 버튼은 비활성.',
        },
      );
    } else if (isDetail) {
      blocks.push(
        {
          type: 'detail',
          title: `${name} 요약`,
          items: ['제목', '대표 이미지', '핵심 속성 3~4개', '상태 배지'],
          note: '',
        },
        {
          type: 'tabs',
          title: '상세 탭',
          items: ['개요', '상세 정보', '관련 항목'],
          note: '탭 전환 시 URL 쿼리를 갱신한다.',
        },
        {
          type: 'list',
          title: '연관 목록',
          items: ['연관 항목 카드 최대 5개', '더보기'],
          note: '',
        },
        {
          type: 'cta',
          title: '주요 행동',
          items: [`${kit.verb}하기`, '저장', '공유'],
          note: '모바일에서는 하단 고정 바로 표시.',
        },
      );
    } else if (isList) {
      blocks.push(
        {
          type: 'search',
          title: '검색',
          items: ['키워드 입력', '최근 검색어'],
          note: '',
        },
        {
          type: 'filter',
          title: '필터·정렬',
          items: ['카테고리', '기간', '상태', '정렬 기준'],
          note: '적용된 필터는 칩으로 표시하고 개별 해제할 수 있다.',
        },
        {
          type: device === 'mobile' ? 'list' : 'table',
          title: `${name} 결과`,
          items: ['항목명', '요약 정보', '상태', '등록일', '바로가기'],
          note: '결과가 없으면 빈 상태 일러스트와 조건 초기화 버튼을 노출한다.',
        },
        {
          type: 'text',
          title: '페이지네이션',
          items: ['페이지 번호', '페이지당 개수 선택'],
          note: '모바일은 무한 스크롤로 대체.',
        },
      );
    } else {
      blocks.push(
        {
          type: 'hero',
          title: '핵심 메시지',
          items: [brief.oneLiner || `${kit.noun}을(를) 한 곳에서`, '시작하기 버튼'],
          note: '',
        },
        {
          type: 'card-grid',
          title: '주요 바로가기',
          items: kit.requirements.slice(0, 3).map((r) => r.title),
          note: '3열 그리드, 모바일 1열.',
        },
        {
          type: 'list',
          title: '최근 활동',
          items: ['최근 항목 5개', '전체 보기'],
          note: '비로그인 사용자에게는 인기 항목을 대신 노출한다.',
        },
        {
          type: 'banner',
          title: '온보딩 배너',
          items: ['프로필을 완성해 보세요', '완료율 표시'],
          note: '완료 시 자동으로 숨긴다.',
        },
      );
    }

    blocks.push({
      type: 'footer',
      title: '푸터',
      items: ['서비스 소개', '이용약관', '개인정보처리방침', '고객센터'],
      note: '',
    });

    return { pageId: page.id, name, device, blocks };
  });

  return { wireframes };
}

/* ------------------------------------------------------------------ */

/**
 * 아직 어느 플로우에도 안 나오는 화면마다 짧은 여정을 하나씩 만든다.
 *
 * `buildFlow` 는 늘 같은 세 가지를 돌려주므로, 플로우를 **더** 만들 때 그대로 쓰면
 * 똑같은 것이 두 번 붙는다. 여기서는 실제로 빠진 화면만 다룬다.
 */
function buildMoreFlows(plan: Plan | undefined): FlowDraft {
  if (!plan) return { flows: [] };
  const inFlows = new Set(
    plan.flows.flatMap((f) => f.nodes.map((n) => n.pageId).filter(Boolean) as string[]),
  );
  const uncovered = plan.iaPages
    .filter((p) => p.type === 'page' && p.featureIds.length > 0 && !inFlows.has(p.id))
    .slice(0, 5);

  return {
    flows: uncovered.map((page) => ({
      name: `${page.name} 이용`,
      description: `사용자가 ${page.name} 화면에 들어와 목적을 마치고 나가는 흐름.`,
      actor: '일반 회원',
      nodes: [
        { key: 'n1', type: 'start', label: '서비스 진입', description: '', pageId: '' },
        {
          key: 'n2',
          type: 'screen',
          label: page.name,
          description: page.description ?? '',
          pageId: page.id,
        },
        { key: 'n3', type: 'action', label: `${page.name}에서 작업 수행`, description: '', pageId: '' },
        { key: 'n4', type: 'decision', label: '작업에 성공했는가?', description: '', pageId: '' },
        { key: 'n5', type: 'screen', label: '결과 확인', description: '', pageId: page.id },
        { key: 'n6', type: 'action', label: '오류 안내 확인 후 재시도', description: '', pageId: '' },
        { key: 'n7', type: 'end', label: '종료', description: '', pageId: '' },
      ],
      edges: [
        { from: 'n1', to: 'n2', label: '' },
        { from: 'n2', to: 'n3', label: '' },
        { from: 'n3', to: 'n4', label: '' },
        { from: 'n4', to: 'n5', label: '예' },
        { from: 'n4', to: 'n6', label: '아니오' },
        { from: 'n6', to: 'n3', label: '' },
        { from: 'n5', to: 'n7', label: '' },
      ],
    })),
  };
}

export function generateLocally<K extends ArtifactKey>(
  artifact: K,
  brief: PlanBrief,
  plan?: Plan,
  options?: { pageIds?: string[]; merge?: boolean },
): ArtifactDraftMap[K] {
  switch (artifact) {
    case 'prd':
      return buildPrd(brief) as ArtifactDraftMap[K];
    case 'fs':
      return buildFs(brief) as ArtifactDraftMap[K];
    case 'ia':
      return buildIa(brief, plan) as ArtifactDraftMap[K];
    case 'flow':
      return (options?.merge
        ? buildMoreFlows(plan)
        : buildFlow(brief, plan)) as ArtifactDraftMap[K];
    case 'wireframe':
      return buildWireframes(brief, plan, options?.pageIds) as ArtifactDraftMap[K];
    default:
      throw new Error(`알 수 없는 산출물: ${artifact}`);
  }
}

export { pickKit };
