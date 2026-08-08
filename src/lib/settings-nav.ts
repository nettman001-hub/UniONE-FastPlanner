/**
 * 설정 메뉴 차림표.
 *
 * ## 왜 아직 못 쓰는 것까지 적어 두나
 *
 * 무엇을 만들 생각인지 보이면 사용자가 기다릴 수 있다. 없으면 "이 서비스는
 * 그런 걸 못 하는구나" 로 끝난다.
 *
 * 다만 **회색으로만 두면 고장으로 읽힌다.** 그래서 `soon` 에 왜 아직인지를
 * 한 줄로 적는다. 이유가 붙으면 "아직 안 만든 것" 으로 읽힌다. 한 줄 차이가 크다.
 */

export interface SettingsItem {
  /** 주소 조각. `/settings/<key>` */
  key: string;
  name: string;
  /** 한 줄 설명 — 메뉴에서 무엇을 하는 자리인지 알려 준다. */
  what: string;
  /** 아직 못 쓰는 항목이면 **왜 아직인지**. 비어 있으면 쓸 수 있는 항목이다. */
  soon?: string;
}

export const SETTINGS_ITEMS: SettingsItem[] = [
  { key: 'account', name: '계정', what: '이름·비밀번호·탈퇴' },
  { key: 'integrations', name: '연결', what: '스티치 등 바깥 서비스' },
  { key: 'skills', name: '기획 스킬', what: '단계마다 이런 식으로 써 달라고 적어 두기' },
  { key: 'usage', name: '사용량', what: '오늘 남은 크레딧' },
  { key: 'data', name: '데이터', what: '백업·동기화·기록 지우기' },
  {
    key: 'generation',
    name: '만들기 기본값',
    what: '디자인 결·와이어프레임 가중치',
    soon: '지금은 만들 때마다 고르게 되어 있습니다. 기본값으로 기억하는 기능을 준비 중입니다.',
  },
  {
    key: 'appearance',
    name: '화면',
    what: '밝게·어둡게, 글자 크기',
    soon: '지금은 컴퓨터의 밝게·어둡게 설정을 그대로 따릅니다. 직접 고르는 기능을 준비 중입니다.',
  },
  {
    key: 'notifications',
    name: '알림',
    what: '다 만들어지면 알려 주기',
    soon: '화면을 떠나 있어도 끝난 것을 알 수 있게 준비 중입니다.',
  },
];

export function findSettingsItem(key: string): SettingsItem | undefined {
  return SETTINGS_ITEMS.find((item) => item.key === key);
}
