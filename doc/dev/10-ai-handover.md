# 10. AI 에이전트 인수인계서 (2026-10-25)

> **다른 AI 코딩 에이전트에게 작업을 넘길 때 읽히는 문서입니다.** 사람용 설치 안내는
> [9. 인계인수서](./09-handover.md) 에 있고, 이 문서는 그 뒤에 이어진 **요구분석 깊이 개선 작업**의
> 현재 상태·구조·함정·남은 일을 적습니다. 코드를 읽기 전에 먼저 읽으세요.

---

## 1. 한눈에

| 항목 | 값 |
| --- | --- |
| 저장소 / 기본 브랜치 | https://github.com/nettman001-hub/UniONE-FastPlanner · `main` |
| 배포 | `main` 에 push → Vercel 자동 배포 (2~3분). 프로덕션은 https://uniboard.cloud |
| Vercel 프로젝트 | `unione-fastplanner`(uniboard.cloud 를 서비스) 와 `uniboard` 두 곳이 같은 저장소를 빌드한다. 상태 확인은 `unione-fastplanner` 를 볼 것 |
| 스택 | Next.js 15 · TypeScript · Tailwind v4 · zustand(persist) · Postgres(로컬은 PGlite) |
| AI | DeepSeek(OpenAI 호환). 기본 `deepseek-v4-flash` / 고급 `deepseek-v4-pro`, 추론 강도 max 사다리 |
| 하루 크레딧 | 200 (한국 시각 자정에 충전). 고급 엔진은 두 배 |
| 프로젝트 규칙 파일 | `CLAUDE.md`/`AGENTS.md` **없음**. 관례는 [9번 문서 §7](./09-handover.md) 과 이 문서 §6 |

이번 작업의 목표는 **"요구분석을 더 깊고 자세하게"** 였다. 얕아지는 원인을 코드에서 찾아
(PRD 가 기능명세서로 안 넘어감 · 한 번에 다 만들어 상세명세가 얕음 · 질문이 한 번으로 끝남 ·
검토 단계 없음) 고쳤다.

---

## 2. 이번에 들어간 커밋 (전부 `main` 에 push 됨)

| 커밋 | 내용 |
| --- | --- |
| `604525f` | 위저드 1단계: 아이디어 줄 칩, 서비스 구조 8종(주·보조) 추정, 빈 줄 제안, 구조 연동 2·4·5단계 |
| `c3d0ed5` | 서비스 구조는 `서비스 구조 생성하기` 버튼을 눌렀을 때만 AI 가 추정 (입력 중 자동 호출 제거) |
| `7882949` | 아이디어는 형식 없이 줄글로 써도 된다는 안내 |
| `a7063ff` | 위저드 2~5단계 요구분석 심화 + 6단계 `이해한 내용` 추가 |
| `883033b` | 기능명세서: PRD 전체 전달 · 요구사항 출처(sources) · 두 번에 나눠 생성 · `AI로 채우기` · 이번에만 추가 지시 |
| `7ed6275` | 기능명세서 AI 검토(빠진 것·모순·모호) |

---

## 3. 구조 — 어디에 무엇이 있나

### 3-1. 데이터 (`src/lib/types.ts`)

`PlanBrief` 에 추가된 필드 (전부 선택 — 예전 플랜은 없다):

| 필드 | 뜻 |
| --- | --- |
| `structure` | 서비스 구조 `{primary, secondary?, source:'user'｜'ai'｜'rule', twoSided?, cautions?, reason?}` |
| `providerUser` | 중개·매칭에서 제공하는 쪽 사용자 |
| `referenceDiff` · `niceToHave` · `notInScope` · `materials` | 참고 서비스와 다른 점 · 있으면 좋은 기능 · 이번에 만들지 않을 것 · 붙여 넣은 자료(프롬프트에는 5,000자까지) |
| `followups[]` | `{question, answer, area?}` — **답이 빈 질문도 남긴다**(문서에 '가정' 으로 들어가게) |
| `summary` | 6단계에서 사용자가 확인한 7줄 요약 + 가정 목록. **모든 생성 프롬프트에서 가장 우선** |

그 밖에: `Requirement.sources`(PRD 출처 ID), `Reviewable.reviewReason`(AI 검토가 덧붙인 이유),
`PlanDocuments.reviewNotes`(AI 검토의 모순·모호).

플랜 가져오기(`src/lib/plan-file.ts`)는 **필드를 하나씩 명시적으로 복사**한다. 새 브리프 필드를
만들면 여기도 고쳐야 가져오기에서 안 사라진다 (이미 위 필드는 반영됨).

### 3-2. 서비스 구조 — `src/lib/archetypes.ts`

- 구조 8종: `matching`·`commerce`·`booking`·`community`·`workspace`·`personal`·`learning`·`directory`.
  업종이 아니라 **누가 무엇을 주고받는가** 로 나눈다 (업종 키워드로 고르면 "공유" 한 단어로 오분류됨).
- 유형마다 `effects[prd|fs|ia|flow]` — **생성 프롬프트에 그대로 들어가는 문장**. 화면의
  "문서에 반영" 줄(`preview`)은 이것을 줄인 것이어야 한다 (보여 준 것과 넣는 것이 달라선 안 됨).
- `structureBlock(brief, artifact)` 는 그 문서 몫만 10~15줄. 사용자가 확인한 구조(`source:'user'`)는
  "반드시 반영", AI·키워드 추정은 "아이디어와 어긋나면 아이디어를 따름". 4단계 확정 답이 항상 우선.
- `CAUTIONS` 5종(위치·대면·미성년·건강·돈) 은 PRD·FS 에만 들어간다.
- `guessStructure` 는 AI 가 꺼졌거나 실패했을 때의 키워드 추정. `normalizeStructure` 는 어디서 온 값이든
  다시 세운다 (**브라우저에서 온 값은 믿지 않는다**).
- 내장 생성기(`local-generator.ts`)는 `pickKit` 이 구조를 먼저 본다. `matching` 키트를 새로 추가함.

### 3-3. 질문 — `src/lib/brief-questions.ts`

- 질문은 **한 목록** `BRIEF_QUESTIONS` 에 모두 둔다. 필드: `types`(이 구조일 때만), `step`(2 또는 4),
  `advanced`(4단계 `더 자세히`). 프롬프트(`answersBlock`)와 개요(`answersText`)가 **둘 다 이 목록만 돈다** —
  따로 두면 답이 조용히 사라진다.
- `visibleQuestions(structure)` = 공통 + 주 유형 앞 2개 + 보조 유형 앞 1개. 위저드 제출 때 **안 보이는
  질문의 답은 버린다**.
- `UNSURE = '__unsure'` (`잘 모르겠어요`): 고르면 프롬프트에 "AI 가 정하고 PRD 제약사항에 `가정:` 으로
  적는다" 가 들어간다. 비워 두는 것(AI 가 말없이 추측)과 구별된다.

### 3-4. 위저드 — `src/app/page.tsx` 의 `PlanWizard`

6단계: ①무엇을 만드나요 ②누구를 위해 ③참고 정보 ④몇 가지만 더 ⑤확인할 것 ⑥이해한 내용.
필수는 1단계의 아이디어·서비스명뿐이고 3단계부터 언제든 `이대로 만들기`.

| API (모두 `requireUser`, **크레딧 차감 없음**) | 언제 | 비고 |
| --- | --- | --- |
| `POST /api/brief/structure` | 1단계 `서비스 구조 생성하기` 를 눌렀을 때만 | 기본 엔진 고정, 15초 넘으면 키워드 추정. 구조 + 빈 줄 제안 |
| `POST /api/brief/questions` | 3→4, 4→5 로 넘어갈 때 미리. `round:2` 면 꼬리 질문 | 영역 꼬리표·추천 보기·이유. 5단계에서 약 20~30초 |
| `POST /api/brief/summary` | 5→6 으로 들어설 때 | 7줄 + 가정. 10~20초 |

- AI 호출이 실패해도 **진행을 막지 않는다** (키워드 추정 / 빈 목록 / "그냥 진행하셔도 됩니다").
- 창을 닫아도 쓰던 내용은 남는다. 제출했을 때와 `새로 쓰기` 때만 지운다 (`reset`).

### 3-5. 문서 생성 — `src/lib/jobs/queue.ts`, `src/lib/ai/*`

- `briefBlock`(prompts.ts) 이 모든 단계 프롬프트의 서비스 정보를 만든다 — 새 브리프 필드는 **여기에
  넣어야 모든 문서에 반영**된다.
- **기능명세서(`fs`)는 두 번에 나눠** 만든다 (`generateFsInTwoPasses`):
  ① 골격(`FS_SKELETON_SCHEMA`: 요구사항·기능, PRD 전체 `prdFullBlock` 를 받음)
  → ② 요구사항마다 `SPEC_SCHEMA` 로 상세명세를 **동시에**(`SPEC_CONCURRENCY=10`) 호출.
  `FS_TIME_BUDGET_MS=230초` 가 지나면 남은 호출을 끊고 **받은 것까지만** 낸다 (Vercel 제한 300초).
- 요구사항에 PRD 출처 ID(`SC-n` 시나리오·`G-n` 목표·`IN-n` 범위·`NFR-n` 비기능)를 적게 한다.
  ID 는 **순서로 매긴다** (`prdSourceId`). 정합성 검사가 같은 함수로 세므로 어긋나지 않는다.
- 생성 직후 **AI 검토**(`reviewFs`): `buildReviewPrompt` → `REVIEW_SCHEMA` → `applyReview`.
  빠진 기능은 `신규`(review:'pending') 로 덧붙고 `reviewReason` 을 단다. 모순·모호는
  `reviewNotes` 로 남아 정합성 검사에 `AI 검토 · …` 로 뜬다. 생성에 시간을 많이 써서
  남은 시간이 45초 미만이면(`FS_REVIEW_DEADLINE_MS=280초`) 검토를 건너뛴다. 검토가 실패해도
  만든 기능명세서는 그대로 낸다.
- 단독 실행: `specFeatureIds`(→ `fillSpecs`, `AI로 채우기`, 2 크레딧) · `reviewFs:true`
  (→ AI 검토만, 2 크레딧). 둘 다 **내장 생성기로 대신하지 않는다**(대신하면 기능명세서를 갈아엎게 됨).
  `/api/generate` 는 `artifacts.length===1 && artifacts[0]==='fs'` 일 때만 이 옵션을 받는다.
- 크레딧: 기능명세서 5(고급 10)는 그대로. 값을 매기는 곳(`runner.ts` 사전 점검)과 치르는 곳(`queue.ts`)이
  **같은 함수**(`costWithEngine`/`costOfArtifact`)를 쓴다 — 어긋나면 안 된다.

### 3-6. 정합성 검사 — `src/lib/validate.ts`

추가된 지적: `fs-scenario-uncovered`(요구사항으로 이어지지 않은 시나리오, 경고) ·
`fs-scope-uncovered`(범위 항목, 제안) — **요구사항에 출처가 하나라도 있을 때만** 본다(예전 플랜 보호) ·
`structure-screens`(구조가 약속한 화면이 IA 에 없음, 제안) · `fs-ai-*`(AI 검토의 고칠 점) ·
`fs-p0-no-spec` 에 `fillSpecs`(→ `AI로 채우기` 버튼). 화면은 `components/IssueBar.tsx` 와
개요(`plans/[id]/page.tsx` 의 `IssueRow`) 두 곳이다.

---

## 4. 확인한 것 / 확인하지 못한 것

**로컬에서 실제 AI 로 확인함** (장비 대여 테스트 플랜):

| 흐름 | 결과 |
| --- | --- |
| 위저드 1~6단계 끝까지 + 플랜 생성 + 개요 브리프 표시 | 정상 |
| 구조 추정 / 되묻기 / 꼬리 질문 / 요약 | 각각 4초 · 30초 · 30초 · 10~20초 |
| PRD 생성 | 약 79초 |
| 기능명세서 두 번에 나눠 생성 | 157초 (골격 55초 + 상세명세 동시). 요구사항 10 · 기능 36 · 상세명세 78, P0·P1 전부 커버, 출처 10/10 |
| `AI로 채우기` | 기존 76개 유지 + 4개 추가, 74초 |
| AI 검토 단독 | 78초 · 기능 6개 추가 · 고칠 점 8개 |
| 프롬프트 반영 | 새 브리프 필드·가정이 PRD 프롬프트에 모두 들어감 (스크립트로 확인) |

**아직 못 본 것 (먼저 확인하세요):**

1. **프로덕션에서 기능명세서 생성 + 바로 이어지는 AI 검토가 한 요청(300초) 안에 끝나는지.**
   로컬 측정으로는 157 + 78 ≈ 235초라 들어갈 것으로 보이지만 Vercel 에서 실측하지 않았다.
2. **`전체 자동 생성`(5단계를 한 요청에서)** — PRD 79 + FS 157 + 검토 78 + IA·플로우·와이어프레임이면
   300초를 넘길 가능성이 높다. 단계별 `AI로 생성` 은 문제없다. 해결 후보: 전체 자동 생성에서 FS 검토를
   건너뛰거나, FS 를 별도 요청으로 분리.
3. 검토 바에 "AI 검토: 이유" 가 실제로 보이는지(코드는 넣었고 빌드는 통과, 화면은 직접 못 봄).
4. 프로덕션 위저드 6단계를 로그인해서 써 보기.
5. AI 검토로 덧붙은 기능 승인·거절 동작(기존 `신규` 배지 흐름을 재사용하므로 문제는 없을 것).

---

## 5. 남은 일 (우선순위 순)

1. **상세명세 칸 확장** — 비즈니스 규칙, 입력 항목·검증, 상태 변화, 사후 조건, 역할별 차이.
   `Specification` 타입 · `SPEC_ITEM`(schemas.ts) · `applyFs`/`appendSpecs`(apply.ts) · 기능명세서 편집 화면 ·
   `export.ts`(마크다운·CSV·JSON) · `local-generator.ts` · `agent-edit.ts`(AI 에이전트 패치) 를 함께 고쳐야 한다.
   **필드는 모두 선택(optional)** 으로 — 저장된 플랜과 호환.
2. 위 §4 의 1·2 번 확인과 필요하면 시간 예산 조정 (`FS_TIME_BUDGET_MS`, `SPEC_CONCURRENCY`, 검토 데드라인).
3. 구조 추정 신뢰도가 낮을 때 "후보 2개 중 고르기" (계획에만 있고 미구현. 지금은 `바꾸기` 로 직접 고침).
4. 생성 뒤 개요에서 브리프(특히 구조·요약) 고치기 — 지금은 보기만 가능, 잘못된 구조는 플랜을 다시 만들어야 고쳐진다.
5. 위저드 단계별 도달률·이탈률 계측 (없어서 "이탈 감소" 를 검증할 수 없다).
6. 낡은 문서: [9번](./09-handover.md) §5 의 두 항목(`04-ai-providers.md` 말미, `01-setup.md` 의 옛 브랜치 참조).
7. Vercel 프로젝트가 둘이라 push 마다 두 번 빌드된다 — 안 쓰는 쪽(`uniboard`) 정리 여부를 사용자에게 물을 것.

---

## 6. 이 저장소에서 일할 때의 함정

- **대부분의 소스 파일이 CRLF** 다. `Edit` 도구는 되지만 셸 heredoc·`sed` 로 여러 줄을 바꿀 때는 줄바꿈이
  깨질 수 있다. 여러 곳을 한꺼번에 고칠 땐 Node 스크립트로 `\r\n → \n` 으로 바꿔 치환한 뒤 원래 줄바꿈으로
  되돌려 쓰는 방식이 안전했다. git 이 `LF will be replaced by CRLF` 경고를 내는 것은 정상이다.
- 셸 인용: 한국어 템플릿 문자열(`${…}`, 백틱)이 든 코드를 `node -e "…"` 에 넣으면 깨진다 — 파일로 쓰고 실행할 것.
- **긴 AI 호출을 기다릴 때** `sleep` 은 막혀 있다. 백그라운드 명령 + 알림 또는 짧은 `wait` 를 쓸 것.
- 로컬 로그인은 계정을 새로 만들어야 한다(로컬은 PGlite, 프로덕션 계정과 다름). 테스트 플랜
  `plan_mvmss2ki_1`("빌려써") 이 로컬 DB 에 남아 있다 — 프로덕션과 무관.
- 로컬 서버 실행은 `.claude/launch.json`(커밋하지 않은 미추적 파일, `npm run dev` / 3000) 의 `dev` 로 띄웠다.
  첫 컴파일이 느려 처음 응답은 몇 초 걸린다.
- `main` 에 push 하면 **곧바로 프로덕션 배포**다. 배포 전에 `npx tsc --noEmit` · `npx eslint src` ·
  `npm run build` 를 돌렸다. 상태는
  `gh api repos/nettman001-hub/UniONE-FastPlanner/commits/<sha>/status` 의 `unione-fastplanner` 로 본다.
- 새 파일에는 한국어 주석으로 **왜 그렇게 했는지** 를 적는 것이 이 저장소의 관례다 (기존 파일 참고).
  색은 `var(--*)` 만, 사용자 화면에 공급자·모델 이름을 내보내지 않는다 ([9번 §7](./09-handover.md)).
- 위저드의 AI 호출은 **크레딧을 받지 않는다** (되묻기와 같은 정책). 운영 비용이 늘어나는 구조이니
  남용 방지가 필요하면 한도를 서버에서 걸어야 한다(지금은 로그인만 확인).
- 프롬프트에 새 문장을 넣을 때는 `scripts/qa/qa-prompt.ts` 를 돌리고, 사용자 화면의 안내 문구와
  실제 프롬프트 문장이 같은 뜻인지 확인할 것 (§3-2 의 `preview` ↔ `effects` 원칙).
- 작업 트리에 **미추적 파일**이 있다: `.claude/` 와 `기능명세서_*.png` 두 장(사용자가 둔 참고 이미지). 커밋하지 말 것.

---

## 7. 처음 30분 체크리스트

```powershell
git clone https://github.com/nettman001-hub/UniONE-FastPlanner.git
cd UniONE-FastPlanner
npm install
npx tsc --noEmit ; npm run lint ; npm run build     # 전부 통과해야 출발점
```

1. 이 문서 §3 의 파일을 순서대로 읽는다 (`archetypes.ts` → `brief-questions.ts` → `prompts.ts` →
   `jobs/queue.ts` → `page.tsx` 의 `PlanWizard`).
2. `DEEPSEEK_API_KEY` 가 `.env.local` 에 있으면 위저드를 끝까지 돌려 본다 (키가 없으면 내장 생성기로 동작 —
   AI 호출 API 는 빈 결과/키워드 추정을 돌려준다).
3. §4 의 "못 본 것" 1번을 먼저 확인하고, 이어서 §5 의 1번(상세명세 칸 확장)을 시작한다.
