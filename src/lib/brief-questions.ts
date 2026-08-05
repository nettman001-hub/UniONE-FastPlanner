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
];

/** 사용자가 고른 것 — `{ actors: ['일반 사용자','운영자'], auth: ['필요'] }` */
export type BriefAnswers = Record<string, string[]>;

/**
 * 고른 답을 프롬프트에 넣을 문장으로 바꾼다.
 *
 * 답만 나열하지 않고 **무엇을 하라는 것인지**(`effect`)까지 적는다. "관리자: 필요"
 * 라고만 하면 모델이 알아서 해석하지만, "관리자 화면 묶음을 포함합니다" 라고 하면
 * 빠뜨릴 수 없다.
 */
export function answersBlock(answers: BriefAnswers | undefined): string {
  if (!answers) return '';
  const lines: string[] = [];

  for (const question of BRIEF_QUESTIONS) {
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
