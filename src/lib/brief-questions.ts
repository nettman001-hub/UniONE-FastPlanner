/**
 * 요구분석 문답 — **고르기만 하면 되는 질문들.**
 *
 * ## 왜 빈칸이 아니라 보기인가
 *
 * 예전 마법사는 여덟 칸이 전부 빈칸이었다. 칸이 적어서 문제가 아니라, "기획 목적"
 * 칸에 무엇을 써야 할지 몰라서 대부분 비워 둔 것이 문제였다. 비면 AI 가 추측하고,
 * 추측이 빗나가면 문서를 통째로 다시 만들게 된다.
 *
 * 그런데 요구분석 질문의 상당수는 **타이핑이 필요 없다.** 누가 쓰는지, 돈을 받는지,
 * 로그인이 필요한지는 고르면 되는 것들이다. 여섯 개를 다 골라도 10초면 끝난다.
 *
 * ## 물어만 보고 안 쓰면 최악이다
 *
 * "관리자 화면 필요" 라고 답했는데 정보구조도에 관리자 화면이 안 생기면, 답한
 * 보람이 없는 정도가 아니라 신뢰를 잃는다. 그래서 보기마다 **무엇을 바꾸는지**
 * (`effect`) 를 함께 적어 두고, 그 문장이 실제로 생성 프롬프트에 들어간다.
 * 여기 적은 것이 곧 약속이다.
 */

import type { ArchetypeKey, BriefStructure } from './types';

export interface BriefChoice {
  value: string;
  label: string;
  /**
   * 이 답이 산출물을 어떻게 바꾸는지 — **그대로 프롬프트에 들어간다.**
   * 비워 두면 아무것도 바뀌지 않는다는 뜻이므로, 그런 보기는 만들지 않는다.
   */
  effect?: string;
}

export interface BriefQuestion {
  key: string;
  /** 질문. 짧고 사람 말로. */
  ask: string;
  /** 왜 묻는지 — 한 줄. */
  why: string;
  multi: boolean;
  choices: BriefChoice[];
  /**
   * 이 구조일 때만 묻는다. 없으면 모든 서비스에 묻는 공통 질문.
   *
   * 유형별 질문을 **따로 두지 않고 이 목록에 함께 둔다.** 답을 프롬프트에 넣는 곳과
   * 개요에 보여 주는 곳이 모두 이 목록만 돌기 때문에, 따로 두면 답이 조용히 사라진다.
   */
  types?: ArchetypeKey[];
}

export const BRIEF_QUESTIONS: BriefQuestion[] = [
  {
    key: 'actors',
    ask: '누가 쓰나요?',
    why: '역할이 늘면 화면과 권한이 함께 늘어납니다.',
    multi: true,
    choices: [
      { value: '일반 사용자', label: '일반 사용자', effect: '일반 사용자 역할과 그 사용자용 화면을 반드시 포함합니다.' },
      { value: '운영자', label: '운영자 · 관리자', effect: '운영자 역할과 운영자 전용 화면(회원 관리·신고 처리 등)을 포함합니다.' },
      { value: '판매자', label: '판매자 · 공급자', effect: '판매자 역할과 등록·정산 화면을 포함합니다.' },
      { value: '전문가', label: '전문가 · 담당자', effect: '전문가 역할과 배정·응대 화면을 포함합니다.' },
      { value: '기관', label: '기관 · 회사 담당자', effect: '기관 계정 개념과 소속 구성원 관리 화면을 포함합니다.' },
    ],
  },
  {
    key: 'auth',
    ask: '로그인이 필요한가요?',
    why: '가입·로그인·비밀번호 찾기 화면이 통째로 달라집니다.',
    multi: false,
    choices: [
      { value: '필요', label: '필요합니다', effect: '가입·로그인·비밀번호 찾기 화면과 계정 관련 기능을 포함합니다.' },
      { value: '소셜', label: '소셜 로그인만', effect: '소셜 로그인만 제공합니다. 비밀번호 입력·찾기 화면은 만들지 않습니다.' },
      { value: '불필요', label: '없어도 됩니다', effect: '로그인 없이 쓸 수 있어야 합니다. 가입·로그인 화면을 만들지 않습니다.' },
    ],
  },
  {
    key: 'revenue',
    ask: '돈은 어떻게 버나요?',
    why: '결제·정산·환불 화면이 생길지 결정합니다.',
    multi: false,
    choices: [
      { value: '무료', label: '무료입니다', effect: '결제 기능을 넣지 않습니다.' },
      { value: '구독', label: '구독료', effect: '요금제 선택·구독 관리·결제 수단 화면을 포함합니다.' },
      { value: '건당결제', label: '건당 결제 · 수수료', effect: '주문·결제·환불 흐름과 정산 화면을 포함합니다.' },
      { value: '광고', label: '광고', effect: '광고 노출 지면을 화면 설계에 반영합니다.' },
      { value: '미정', label: '아직 안 정했습니다' },
    ],
  },
  {
    key: 'notify',
    ask: '알림이 필요한가요?',
    why: '알림 설정 화면과 발송 기능이 붙습니다.',
    multi: true,
    choices: [
      { value: '푸시', label: '앱 푸시', effect: '푸시 알림 발송 기능과 알림 설정 화면을 포함합니다.' },
      { value: '이메일', label: '이메일', effect: '이메일 발송 기능을 포함합니다.' },
      { value: '문자', label: '문자(SMS)', effect: '문자 발송 기능을 포함합니다.' },
      { value: '없음', label: '필요 없습니다' },
    ],
  },
  {
    key: 'admin',
    ask: '관리자 화면이 필요한가요?',
    why: '필요하다면 화면 수가 눈에 띄게 늘어납니다.',
    multi: false,
    choices: [
      { value: '필요', label: '필요합니다', effect: '관리자 화면 묶음(대시보드·회원 관리·신고 처리·통계)을 정보구조도에 포함합니다.' },
      { value: '나중에', label: '나중에 만들 겁니다', effect: '관리자 화면은 범위에서 제외하고, 향후 과제로 적습니다.' },
      { value: '불필요', label: '필요 없습니다', effect: '관리자 화면을 만들지 않습니다.' },
    ],
  },
  {
    key: 'stage',
    ask: '언제까지 만드시나요?',
    why: '기능의 우선순위(P0·P1·P2) 배분이 달라집니다.',
    multi: false,
    choices: [
      {
        value: 'MVP',
        label: '2~4주 안에 최소 버전',
        effect: '꼭 필요한 것만 P0 로 두고 나머지는 P2 로 미룹니다. 기능 수를 적게 유지합니다.',
      },
      { value: '정식', label: '1~3개월, 제대로', effect: 'P0·P1 을 고르게 배분하고 예외 흐름까지 설계합니다.' },
      { value: '검토', label: '아직 검토 단계입니다', effect: '범위를 넓게 잡고 선택지를 함께 제시합니다.' },
    ],
  },

  /* 구조별 질문 — 주 유형에서 앞의 2개, 보조 유형에서 앞의 1개를 묻는다 ---- */

  {
    key: 'matching_money',
    types: ['matching'],
    ask: '돈은 서로 어떻게 주고받나요?',
    why: '안전결제·정산·환불 화면이 생길지 결정합니다.',
    multi: false,
    choices: [
      { value: '직접', label: '서로 직접 (앱 밖)', effect: '거래 대금은 서비스 밖에서 주고받습니다. 결제·정산 화면 대신 거래 완료 확인만 둡니다.' },
      { value: '안전결제', label: '서비스가 맡아 둠', effect: '서비스가 대금을 맡아 두었다가 완료 후 지급하는 안전결제·정산·환불 흐름을 포함합니다.' },
      { value: '없음', label: '돈이 오가지 않음', effect: '금전 거래가 없는 매칭입니다. 결제 관련 기능을 넣지 않습니다.' },
    ],
  },
  {
    key: 'matching_verify',
    types: ['matching'],
    ask: '제공하는 쪽을 심사하나요?',
    why: '가입 심사·승인 화면이 붙을지 결정합니다.',
    multi: false,
    choices: [
      { value: '심사', label: '심사 후 활동', effect: '제공자 가입 신청·서류 제출·운영자 승인 흐름과 승인 상태 화면을 포함합니다.' },
      { value: '바로', label: '누구나 바로', effect: '누구나 바로 활동하며, 후기와 신고로 신뢰를 관리합니다.' },
    ],
  },
  {
    key: 'matching_contact',
    types: ['matching'],
    ask: '성사된 뒤 연락은 어떻게 하나요?',
    why: '채팅 기능이 들어갈지 결정합니다.',
    multi: false,
    choices: [
      { value: '채팅', label: '앱 안 채팅', effect: '매칭된 사용자끼리 앱 안 1:1 채팅을 포함합니다.' },
      { value: '연락처', label: '연락처 공개', effect: '성사되면 연락처를 공개합니다. 공개 시점과 동의를 상세명세에 적습니다.' },
    ],
  },
  {
    key: 'commerce_delivery',
    types: ['commerce'],
    ask: '상품은 어떻게 전달하나요?',
    why: '배송·픽업 화면이 달라집니다.',
    multi: true,
    choices: [
      { value: '택배', label: '택배 배송', effect: '배송지 입력·배송 상태 조회·송장 등록을 포함합니다.' },
      { value: '픽업', label: '매장 픽업', effect: '픽업 시간 선택과 픽업 완료 처리를 포함합니다.' },
      { value: '디지털', label: '디지털 상품', effect: '구매 즉시 이용 권한을 주는 디지털 상품입니다. 배송 대신 이용 권한 부여를 설계합니다.' },
    ],
  },
  {
    key: 'commerce_refund',
    types: ['commerce'],
    ask: '취소·환불은 어떻게 하나요?',
    why: '취소·반품 흐름과 운영자 처리 화면이 달라집니다.',
    multi: false,
    choices: [
      { value: '출고전', label: '출고 전엔 바로 취소', effect: '출고 전에는 구매자가 바로 취소하고, 출고 후에는 반품 신청→승인 흐름을 둡니다.' },
      { value: '승인', label: '운영자 승인 후', effect: '모든 취소·환불은 운영자 승인을 거치며 신청·처리 상태를 보여 줍니다.' },
    ],
  },
  {
    key: 'commerce_stock',
    types: ['commerce'],
    ask: '재고 수량을 관리하나요?',
    why: '품절 처리와 재입고 알림이 붙을지 결정합니다.',
    multi: false,
    choices: [
      { value: '관리', label: '수량 관리', effect: '옵션별 재고 수량, 품절 표시, 재입고 알림을 포함합니다.' },
      { value: '안함', label: '관리 안 함', effect: '재고 수량은 관리하지 않습니다.' },
    ],
  },
  {
    key: 'booking_confirm',
    types: ['booking'],
    ask: '예약은 바로 확정되나요?',
    why: '승인 대기 상태와 받는 쪽 처리 화면이 생길지 결정합니다.',
    multi: false,
    choices: [
      { value: '즉시', label: '빈 자리면 바로 확정', effect: '빈 자리면 신청 즉시 확정합니다.' },
      { value: '승인', label: '받는 쪽이 승인', effect: '신청 후 받는 쪽이 승인해야 확정되며 승인 대기·거절 상태를 둡니다.' },
    ],
  },
  {
    key: 'booking_cancel',
    types: ['booking'],
    ask: '예약 취소는 언제까지 되나요?',
    why: '취소 마감과 위약 규정이 상세명세에 들어갑니다.',
    multi: false,
    choices: [
      { value: '전날', label: '이용 전날까지 무료', effect: '이용 전날까지는 무료 취소, 그 뒤에는 취소 불가 또는 위약금으로 정의합니다.' },
      { value: '언제든', label: '언제든 무료', effect: '이용 시작 전이면 언제든 무료로 취소합니다.' },
      { value: '불가', label: '취소 불가', effect: '확정 후에는 취소할 수 없고 일정 변경만 허용합니다.' },
    ],
  },
  {
    key: 'booking_noshow',
    types: ['booking'],
    ask: '노쇼는 어떻게 하나요?',
    why: '노쇼 처리 기능과 제재가 들어갈지 결정합니다.',
    multi: false,
    choices: [
      { value: '기록', label: '기록만', effect: '받는 쪽이 노쇼를 표시하고 이용 내역에 남깁니다.' },
      { value: '제한', label: '반복 시 이용 제한', effect: '노쇼가 반복되면 일정 기간 예약을 제한합니다.' },
    ],
  },
  {
    key: 'community_writer',
    types: ['community'],
    ask: '누가 글을 쓰나요?',
    why: '작성 권한과 운영자 화면이 달라집니다.',
    multi: false,
    choices: [
      { value: '모두', label: '모든 회원', effect: '모든 회원이 글을 씁니다.' },
      { value: '승인', label: '승인된 회원만', effect: '작성 권한 신청·승인 흐름을 포함합니다.' },
      { value: '운영자', label: '운영자만 (댓글은 회원)', effect: '글은 운영자만 쓰고 회원은 댓글·반응만 남깁니다.' },
    ],
  },
  {
    key: 'community_moderation',
    types: ['community'],
    ask: '올라온 글은 어떻게 관리하나요?',
    why: '검수 대기열과 신고 처리 화면이 달라집니다.',
    multi: false,
    choices: [
      { value: '신고', label: '신고가 오면 처리', effect: '신고 접수 → 운영자 검토 → 숨김·제재 흐름을 둡니다.' },
      { value: '사전', label: '올리기 전에 검수', effect: '게시 전 검수 대기 상태와 운영자 검수 화면을 둡니다.' },
    ],
  },
  {
    key: 'community_anon',
    types: ['community'],
    ask: '익명으로 쓸 수 있나요?',
    why: '프로필 노출과 신고 추적 방식이 달라집니다.',
    multi: false,
    choices: [
      { value: '닉네임', label: '닉네임으로', effect: '닉네임과 프로필을 보여 줍니다.' },
      { value: '익명', label: '익명 허용', effect: '익명 글을 허용하되 운영자는 신고 처리 시 작성자를 확인할 수 있게 합니다.' },
    ],
  },
  {
    key: 'workspace_approval',
    types: ['workspace'],
    ask: '결재·승인 단계가 있나요?',
    why: '요청·승인 흐름과 이력 화면이 생길지 결정합니다.',
    multi: false,
    choices: [
      { value: '있음', label: '있습니다', effect: '요청 → 검토 → 승인/반려 단계와 승인 이력을 포함합니다.' },
      { value: '없음', label: '없습니다', effect: '별도 승인 단계 없이 권한에 따라 바로 처리합니다.' },
    ],
  },
  {
    key: 'workspace_external',
    types: ['workspace'],
    ask: '조직 밖 사람(고객·학부모 등)도 들어오나요?',
    why: '외부 참여자용 화면과 초대 방식이 생길지 결정합니다.',
    multi: false,
    choices: [
      { value: '외부', label: '들어옵니다', effect: '외부 참여자용 제한된 화면(보기·응답 전용)과 초대 링크를 포함합니다.' },
      { value: '내부', label: '내부만 씁니다', effect: '조직 구성원만 씁니다.' },
    ],
  },
  {
    key: 'workspace_multi',
    types: ['workspace'],
    ask: '한 사람이 여러 조직에 속하나요?',
    why: '조직 전환 메뉴가 필요한지 결정합니다.',
    multi: false,
    choices: [
      { value: '여럿', label: '여러 조직', effect: '한 계정이 여러 워크스페이스에 속하고 전환할 수 있게 합니다.' },
      { value: '하나', label: '하나만', effect: '한 계정은 하나의 워크스페이스에만 속합니다.' },
    ],
  },
  {
    key: 'personal_input',
    types: ['personal'],
    ask: '기록은 어떻게 넣나요?',
    why: '입력 화면과 외부 연동이 달라집니다.',
    multi: true,
    choices: [
      { value: '직접', label: '직접 입력', effect: '빠른 직접 입력 화면을 둡니다.' },
      { value: '사진', label: '사진·영수증 찍기', effect: '사진을 찍어 내용을 읽어 들이는 입력과 확인·수정 화면을 포함합니다.' },
      { value: '연동', label: '다른 서비스에서 불러오기', effect: '외부 서비스 연동과 불러오기 상태 화면을 포함합니다.' },
    ],
  },
  {
    key: 'personal_share',
    types: ['personal'],
    ask: '기록을 다른 사람과 나누나요?',
    why: '공유 링크나 함께 쓰기 기능이 붙을지 결정합니다.',
    multi: false,
    choices: [
      { value: '혼자', label: '혼자만', effect: '공유 기능을 넣지 않습니다.' },
      { value: '링크', label: '링크로 보여 주기', effect: '보기 전용 공유 링크를 포함합니다.' },
      { value: '함께', label: '가족·친구와 함께', effect: '초대한 사람과 같은 기록을 함께 쓰는 기능을 포함합니다.' },
    ],
  },
  {
    key: 'learning_maker',
    types: ['learning'],
    ask: '콘텐츠는 누가 만드나요?',
    why: '강사 등록·업로드 화면이 생길지 결정합니다.',
    multi: false,
    choices: [
      { value: '운영자', label: '운영자가', effect: '운영자가 콘텐츠를 올리고 관리합니다.' },
      { value: '강사', label: '강사가 직접 올림', effect: '강사 등록·콘텐츠 업로드·검수·수익 확인 화면을 포함합니다.' },
    ],
  },
  {
    key: 'learning_check',
    types: ['learning'],
    ask: '배운 것을 어떻게 확인하나요?',
    why: '퀴즈·과제·피드백 기능이 달라집니다.',
    multi: true,
    choices: [
      { value: '퀴즈', label: '퀴즈', effect: '레슨별 퀴즈와 채점·재도전을 포함합니다.' },
      { value: '과제', label: '과제·피드백', effect: '과제 제출과 강사 피드백을 포함합니다.' },
      { value: '없음', label: '확인 안 함', effect: '학습 확인 기능은 넣지 않고 진도만 기록합니다.' },
    ],
  },
  {
    key: 'directory_source',
    types: ['directory'],
    ask: '정보는 누가 채우나요?',
    why: '등록·검수·연동 화면이 달라집니다.',
    multi: true,
    choices: [
      { value: '운영자', label: '운영자가 등록', effect: '운영자 데이터 등록·수정 화면을 둡니다.' },
      { value: '제보', label: '사용자 제보', effect: '사용자 제보 → 운영자 검수 → 반영 흐름을 둡니다.' },
      { value: '연동', label: '외부 데이터 연동', effect: '외부 데이터 연동과 갱신 주기, 연동 실패 처리를 포함합니다.' },
    ],
  },
  {
    key: 'directory_map',
    types: ['directory'],
    ask: '지도로 보여 주나요?',
    why: '지도 보기와 위치 권한이 필요한지 결정합니다.',
    multi: false,
    choices: [
      { value: '지도', label: '지도 + 목록', effect: '목록/지도 전환과 현재 위치 기준 정렬을 포함합니다.' },
      { value: '목록', label: '목록만', effect: '지도 없이 목록과 필터로 보여 줍니다.' },
    ],
  },
];

/**
 * 지금 구조에서 묻는 질문 — 공통 질문 + 주 유형 앞 2개 + 보조 유형 앞 1개.
 *
 * 답을 프롬프트에 넣을 때도 **이것만** 본다. 유형을 바꾸면 화면에서 사라진 질문의 답은
 * 문서에도 들어가지 않는다 — 보이지 않는 답이 문서를 바꾸면 안 된다.
 */
export function visibleQuestions(structure: BriefStructure | undefined): BriefQuestion[] {
  const common = BRIEF_QUESTIONS.filter((q) => !q.types);
  if (!structure || structure.primary === 'none') return common;
  const of = (key: ArchetypeKey) => BRIEF_QUESTIONS.filter((q) => q.types?.includes(key));
  const typed = [
    ...of(structure.primary).slice(0, 2),
    ...(structure.secondary ? of(structure.secondary).slice(0, 1) : []),
  ];
  return [...common, ...typed];
}

/**
 * 구조에 어울리는 공통 질문의 보기 — 화면에 `추천` 표시만 한다. **미리 고르지 않는다.**
 * 고른 답은 추측할 여지가 없는 사실이어야 하기 때문이다.
 */
export function recommendedChoices(structure: BriefStructure | undefined): Record<string, string[]> {
  if (!structure || structure.primary === 'none') return {};
  const rec: Record<ArchetypeKey, Record<string, string[]>> = {
    matching: structure.twoSided === false ? { admin: ['필요'] } : { actors: ['판매자', '전문가'], admin: ['필요'] },
    commerce: { revenue: ['건당결제'], admin: ['필요'], auth: ['필요'] },
    booking: { notify: ['푸시', '문자'], revenue: ['건당결제'] },
    community: { admin: ['필요'], notify: ['푸시'] },
    workspace: { actors: ['기관'], revenue: ['구독'], auth: ['필요'] },
    personal: { notify: ['푸시'] },
    learning: { actors: ['전문가'], revenue: ['구독'] },
    directory: { admin: ['필요'] },
  };
  return rec[structure.primary];
}

/** 사용자가 고른 것 — `{ actors: ['일반 사용자','운영자'], auth: ['필요'] }` */
export type BriefAnswers = Record<string, string[]>;

/**
 * 고른 답을 프롬프트에 넣을 문장으로 바꾼다.
 *
 * 답만 나열하지 않고 **무엇을 하라는 것인지**(`effect`)까지 적는다. "관리자: 필요"
 * 라고만 하면 모델이 알아서 해석하지만, "관리자 화면 묶음을 포함합니다" 라고 하면
 * 빠뜨릴 수 없다.
 */
export function answersBlock(answers: BriefAnswers | undefined, structure?: BriefStructure): string {
  if (!answers) return '';
  const lines: string[] = [];

  for (const question of visibleQuestions(structure)) {
    const picked = answers[question.key];
    if (!picked || picked.length === 0) continue;

    const chosen = question.choices.filter((c) => picked.includes(c.value));
    if (chosen.length === 0) continue;

    lines.push(`- ${question.ask} ${chosen.map((c) => c.label).join(', ')}`);
    for (const c of chosen) {
      if (c.effect) lines.push(`  → ${c.effect}`);
    }
  }

  return lines.length > 0 ? `## 확정된 요구사항 (사용자가 직접 고른 것 — 반드시 반영)\n${lines.join('\n')}` : '';
}

/** 자유 문답(AI 되묻기)의 답. */
export interface BriefFollowup {
  question: string;
  answer: string;
}

export function followupBlock(followups: BriefFollowup[] | undefined): string {
  const answered = (followups ?? []).filter((f) => f.answer.trim());
  if (answered.length === 0) return '';
  return [
    '## 추가 문답 (사용자가 답한 것 — 반드시 반영)',
    ...answered.map((f) => `- ${f.question}\n  답: ${f.answer.trim()}`),
  ].join('\n');
}
