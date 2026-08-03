/** 서비스 표기를 한곳에서 관리한다. */

export const BRAND_NAME = 'UniBoard';
export const BRAND_SHORT = 'UniBoard';
export const BRAND_TAGLINE = '아이디어만 입력하면 PRD부터 와이어프레임까지, 한 번에 정리해 드립니다.';

/** public/logo.png 를 쓴다. 파일이 없으면 워드마크로 대체된다. */
export const BRAND_LOGO_SRC = '/logo.png';

/**
 * 저장소 키는 이 이름을 따라가지 않는다.
 *
 * `store.ts` 의 `unione-fastplaner:v1` 과 `sync.ts` 의 키들은 **예전 이름 그대로
 * 두어야 한다.** 이미 사용자 브라우저에 그 이름으로 저장되어 있어서, 이름을 바꾸면
 * 만들어 둔 플랜을 앱이 찾지 못한다 — 사용자에게는 전부 사라진 것으로 보인다.
 *
 * 서비스명이 또 바뀌어도 마찬가지다. 표기와 저장소 키는 별개다.
 */
