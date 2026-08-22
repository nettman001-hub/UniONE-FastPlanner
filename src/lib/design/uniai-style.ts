/**
 * UniAI 스타일 기준 — 퓨샷 예시와 품질 규칙.
 *
 * ## 구성
 *
 * - UINAI_STYLE_EXEMPLAR: 토큰 사용을 보여 주는 고품질 CSS 스니펫. 모델에게
 *   "이 정도 결"을 보여 주는 퓨샷이다. 반드시 sanitizeUinAiCss 를 통과해야
 *   한다(외부 url·@import 없음 — 미리보기 CSP 와 동일한 한계).
 * - UINAI_HARD_RULES: 무조건 지켜야 할 하드 제약(토큰만 사용).
 * - UINAI_SOFT_RULES: 품질 기준(타입 위계·간격 리듬·안티-slop).
 *
 * ## 왜 하드와 소프트를 나누나
 *
 * "이건 지키지 않으면 안 된다"와 "되도록 이렇게"를 한 문단에 섞으면 모델이
 * 전부 선택 사항으로 읽는다(DesignRepair 의 hard/soft 제약 구분을 따름).
 */

export const UINAI_STYLE_EXEMPLAR = `/* 토큰 사용 예시 — 이 결을 따르세요 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-4) var(--sp-6);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.topbar h1 { font-size: var(--fs-h2); font-weight: var(--fw-h2); color: var(--c-fg); }
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-5);
  border: none;
  border-radius: var(--r-button);
  background: var(--c-primary);
  color: var(--c-surface);
  font-size: var(--fs-body);
  font-weight: 600;
}
.btn-primary:hover { background: var(--c-primary-hover); }
.btn-primary:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.btn-ghost {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 var(--sp-5);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-button);
  background: transparent;
  color: var(--c-fg);
}
.card {
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-surface);
  padding: var(--sp-5);
}
.card-title { font-size: var(--fs-h3); font-weight: var(--fw-h3); color: var(--c-fg); }
.card-desc { font-size: var(--fs-body); color: var(--c-fg-muted); }
.field input {
  width: 100%;
  height: 40px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-input);
  background: var(--c-surface);
  color: var(--c-fg);
  font-size: var(--fs-body);
}
.field input:focus { border-color: var(--c-primary); box-shadow: var(--focus-ring); outline: none; }
table th {
  background: var(--c-surface-2);
  color: var(--c-fg-muted);
  font-size: var(--fs-caption);
  font-weight: 600;
  text-align: left;
}
table td { border-bottom: 1px solid var(--c-border); font-size: var(--fs-body); }
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--sp-3);
  border-radius: 999px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: var(--fs-caption);
  font-weight: 600;
}`;

export const UINAI_HARD_RULES = `## 하드 제약 (반드시 지킵니다)
- 색·간격·모서리·글자 크기·그림자는 하드코딩하지 않고, 위 "디자인 토큰"의 var(--*) 참조만 사용합니다. 색 코드(#...), rgb(), px 단위 값을 스타일에 직접 쓰지 않습니다.
- :root에 토큰을 선언할 때는 주어진 값 그대로 적습니다(값을 임의로 바꾸지 않습니다).
- 외부 자원(@import, url(...), webfont, CDN 링크)을 사용하지 않습니다. 아이콘은 인라인 SVG나 글자로 만듭니다.
- 이미지를 생성하거나 불러오지 않습니다.
- html/css/javascript 필드 구분과 JSON 스키마를 정확히 지킵니다.`;

export const UINAI_SOFT_RULES = `## 품질 기준 (되도록 이렇게)
- 타입 위계: display·h1·h2·h3·body·caption을 용도에 맞게 쓰고, 애매한 중간 크기를 만들지 않습니다.
- 간격 리듬: 요소 사이 여백은 간격 스케일(4·8·12·16·24·32·48) 값만 씁니다. 관련 있는 것끼리 가깝게, 없는 것끼리 멀게.
- 색 절제: 주 색은 강조(주요 버튼·선택·링크)에만 씁니다. 화면 대부분은 surface와 무채색 계열입니다.
- 한 화면에 주요 버튼은 하나. 나머지는 보조(테두리)나 글자만 있는 버튼.
- AI-slop 금지: 형광 기본 파랑(#3B82F6 류)에 흰 카드 도배, 전면 중앙 정렬 히어로, 뚜렷한 이유 없는 그라데이션·큰 그림자, 말풍선 이모지 남용을 피합니다.
- 상태 커버리지: hover·focus-visible·disabled·빈 목록(empty state) 스타일을 실제로 포함합니다.
- 접근성: 글자-배경 대비를 확보하고, 색만으로 뜻을 전하지 않습니다.
- 콘텐츠 밀도는 화면 성격에 맞춥니다 — 업무 화면은 촘촘하게, 소비자용은 여유 있게.`;
