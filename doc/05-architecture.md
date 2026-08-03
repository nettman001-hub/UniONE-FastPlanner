# 5. 구조와 데이터 모델

## 기술 스택

| 영역 | 선택 |
| --- | --- |
| 프레임워크 | Next.js 15 (App Router) |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS v4 + CSS 변수 기반 디자인 토큰 |
| 상태 | zustand + localStorage 영속화 |
| 아이콘 | lucide-react |
| AI SDK | `openai` (DeepSeek 호환), `@anthropic-ai/sdk` |
| 데이터베이스 | Postgres — 배포는 `pg` 드라이버, 로컬은 PGlite |
| 로그인 | 자체 세션 쿠키 (scrypt 해시 + HMAC 서명) |

브라우저 저장소가 여전히 **정본**입니다. 계정이 붙으면 그 사본이 뒤에서 서버로
올라갑니다 — 자세한 이유는 아래 "저장과 동기화" 를 보세요.

## 폴더 구조

```
src/
  app/
    page.tsx                     플랜 목록 + 기획하기 위저드
    layout.tsx                   루트 레이아웃 (메타데이터·토스트)
    plans/[id]/
      layout.tsx                 워크스페이스 셸 (헤더·사이드바·에이전트)
      page.tsx                   개요 — 파이프라인·정합성·버전·코멘트
      prd/ fs/ ia/ flow/ wireframe/ export/
    share/page.tsx               보기 전용 공유
    docs/                        설명서 — doc/ 마크다운을 빌드 때 읽어 정적 생성
    api/
      generate/route.ts          생성 — 결과를 NDJSON 으로 흘려보냄
      chat/route.ts              AI 에이전트 대화 + 문서 패치
      status/route.ts            현재 공급자 상태
  lib/
    types.ts                     도메인 모델 — 단일 계약
    store.ts                     zustand 스토어 + 영속화
    brand.ts                     서비스명·로고 경로
    validate.ts                  정합성 검사 규칙
    fs-tree.ts                   기능명세서 트리 (세 보기가 공유)
    fs-review.ts                 AI 제안 승인/거절 + 삭제 캐스케이드
    sync.ts                      플랜을 서버와 맞춘다 (브라우저 우선, 뒤에서 올림)
    auth/                        비밀번호 해시·세션 서명·가입 정책
    db/                          스키마와 질의 (Postgres / PGlite 공용)
    jobs/queue.ts                생성 파이프라인 (서버) — 결과를 흘려보낸다
    jobs/runner.ts               스트림 읽기 (브라우저) — 화면과 무관하게 돈다
    jobs/progress.ts             진행 상태 타입
    export.ts                    마크다운 / CSV / JSON / Mermaid / 번들
    image-export.ts              SVG / PNG 변환
    share.ts                     보기 전용 링크 인코딩
    selection.ts                 AI 에이전트 대상 항목 선택
    useGenerate.ts               생성 훅 (작업을 큐에 맡긴다) + 공급자 상태 훅
    ids.ts                       REQ-001 같은 ID 발급 규칙
    ai/
      provider.ts                공급자 결정
      client.ts                  공급자 분기 + Anthropic 어댑터
      deepseek.ts                DeepSeek 어댑터
      schemas.ts                 산출물 JSON 스키마
      prompts.ts                 시스템 프롬프트 · 단계별 컨텍스트
      local-generator.ts         키 없이 동작하는 규칙 기반 생성기
      apply.ts                   초안 → 도메인 객체 (ID 부여·참조 검증)
  components/
    ui.tsx                       토스트·모달·인라인 편집기·리스트 편집기
    Logo.tsx                     로고 (파일 없으면 이니셜 마크)
    StepNav.tsx                  다음 단계로 버튼
    FsMindmap.tsx                기능명세서 마인드맵 캔버스
    ReviewBar.tsx                AI 제안 검토 바 · 신규 배지
    ResumeBanner.tsx             멈춘 작업 이어서 만들기 안내
    DocsNav.tsx                  설명서 목차
    GeneratingState.tsx          생성 중 안내
    AgentPanel.tsx               AI 에이전트 패널
    FlowCanvas.tsx               플로우차트 SVG 렌더러
    WireframeView.tsx            와이어프레임 렌더러
    MarkdownView.tsx             마크다운 렌더러
doc/                             이 설명서
scripts/check-ai.mjs             AI 공급자 연결 점검
```

## 도메인 모델

모든 타입은 `src/lib/types.ts` 한 파일에 있습니다. 여기가 단일 계약이며,
UI·AI·내보내기·검증이 모두 이 타입을 공유합니다.

### 플랜

```
Plan
├─ brief          위저드 입력값 (서비스명·아이디어·타겟·목적·플랫폼)
├─ prd            프로덕트 요구사항 (단일 객체)
├─ requirements   요구사항 목록
├─ features       기능 목록
├─ specifications 상세명세 목록
├─ iaPages        화면 목록
├─ flows          유저 플로우 목록
├─ wireframes     와이어프레임 목록
├─ generated      산출물별 생성 여부
├─ chat           AI 에이전트 대화
├─ comments       코멘트
└─ versions       버전 스냅샷
```

### ID 규칙

| 대상 | 접두사 | 예 |
| --- | --- | --- |
| 요구사항 | `REQ-` | `REQ-001` |
| 기능 | `FN-` | `FN-014` |
| 상세명세 | `SP-` | `SP-037` |
| 페이지 | `PG-` | `PG-012` |
| 플로우 | `FL-` | `FL-002` |
| 와이어프레임 | `WF-` | `WF-005` |

번호는 플랜 단위로 1부터 증가하며 **재사용하지 않습니다.**
`REQ-003` 을 지워도 다음 요구사항은 `REQ-004` 입니다.

### 항목 간 연결

```
Requirement (REQ)
    └─ Feature (FN)  ──────────┐
           └─ Specification (SP)│
                    │           │
                    │ pageIds   │ featureIds
                    ▼           ▼
                  IaPage (PG)
                    │
       ┌────────────┴────────────┐
       │ pageId                  │ pageId
       ▼                         ▼
  FlowNode (플로우 안)      Wireframe (WF)
```

이 연결 덕분에 정합성 검사가 "어느 화면에도 배치되지 않은 기능" 같은 문제를 찾아냅니다.

## AI 생성 파이프라인

```
사용자 요청
   ↓
/api/generate  (artifact, plan)
   ↓
provider.ts    어떤 공급자를 쓸지 결정
   ↓
prompts.ts     시스템 프롬프트 + 앞 단계 산출물 컨텍스트 구성
   ↓
deepseek.ts 또는 client.ts (Anthropic)
   ↓  JSON 초안
apply.ts       ID 부여 · 열거형 정규화 · 참조 검증
   ↓  PlanDocuments 패치
store.ts       스토어에 반영 → 화면 갱신
```

### 설계 원칙 3가지

**1. ID 는 모델이 만들지 않습니다.**

AI 응답은 배열 인덱스로 상위 항목을 가리키고, 실제 ID 는 `apply.ts` 가 붙입니다.
모델이 ID 를 지어내며 생기는 참조 깨짐이 구조적으로 불가능합니다.

**2. 단계마다 앞 산출물을 컨텍스트로 넘깁니다.**

정보구조도를 만들 때는 이미 확정된 기능 ID 목록을 주고 그 안에서만 고르게 합니다
(`prompts.ts` → `contextBlock`). 그래서 산출물끼리 어긋나지 않습니다.

**3. 스키마를 벗어난 값도 통과시키지 않습니다.**

`apply.ts` 가 우선순위·페이지 유형·노드 종류 같은 열거형을 검사하고,
범위를 벗어난 인덱스와 존재하지 않는 ID 참조를 걸러냅니다.
그래서 공급자마다 형식 보장 수준이 달라도 파이프라인이 깨지지 않습니다.

## 공급자 어댑터

호출부는 `generateJson({ prompt, schema })` 만 압니다.

| 공급자 | 형식 강제 방법 |
| --- | --- |
| DeepSeek | OpenAI 호환 `response_format: json_object` + 프롬프트에 JSON Schema 삽입 |
| Anthropic | `output_config.format` 구조화 출력 |

새 공급자를 추가하려면:

1. `src/lib/ai/` 에 어댑터 파일을 만듭니다.
2. `provider.ts` 의 `ProviderId` 와 `resolveProvider()` 에 분기를 추가합니다.
3. `client.ts` 의 `generateJson()` 에서 새 어댑터로 보냅니다.

## 정합성 검사 규칙 추가하기

`src/lib/validate.ts` 의 `validatePlan()` 안에 규칙을 하나 더 넣으면 됩니다.

```ts
add({
  id: 'fs-spec-no-actor',
  level: 'warn',
  artifact: 'fs',
  title: '수행 주체가 없는 상세 명세',
  detail: '누가 하는 동작인지 명시해야 합니다.',
  targets: plan.specifications.filter((s) => !s.actor).map((s) => `${s.id} ${s.title}`),
  href: '/fs',
});
```

`add()` 는 `targets` 가 비어 있으면 보고하지 않습니다. 즉 규칙을 통과한 것으로 봅니다.

## 설명서 화면

`/docs` 는 `doc/` 폴더의 마크다운과 `manifest.json` 을 **그대로** 읽습니다.
같은 내용을 두 벌 관리하지 않으므로, 문서를 고치면 화면도 함께 바뀝니다.

**빌드 시점에만 읽습니다.** `generateStaticParams` 로 목차에 있는 문서를 모두 미리 만들고
`dynamicParams = false` 로 두어, 실행 중에는 파일을 건드리지 않습니다. 서버리스에 올려도
파일이 없어 깨질 일이 없습니다.

문서 사이의 `./06-troubleshooting.md` 같은 링크는 `docLinkMap()` 이 `/docs/troubleshooting`
으로 바꿔 줍니다. 대응표에 없는 상대 경로(`./manifest.json` 처럼 저장소 안의 파일)는
링크가 아니라 **글자로만** 보여 줍니다 — 웹에서 열 수 없는 주소를 눌러 404 가 나지 않도록.

문서를 추가하려면 `doc/` 에 파일을 넣고 `manifest.json` 에 한 줄 더하면 됩니다.

## 스타일 규칙

색은 반드시 CSS 변수를 통해 씁니다.

```tsx
// 좋음
<div className="text-[var(--fg-muted)] bg-[var(--surface-2)]" />

// 나쁨 — 다크 모드가 깨집니다
<div className="text-gray-500 bg-gray-100" />
```

버튼·입력·카드·표·칩은 `src/app/globals.css` 의 기존 클래스를 재사용합니다.

`.btn` `.btn-primary` `.btn-ghost` `.btn-sm` `.card` `.input` `.textarea` `.select`
`.label` `.chip` `.chip-primary` `.chip-ok` `.chip-warn` `.chip-danger`
`.table-wrap` `.data` `.id-tag` `.section-title` `.empty`

## 생성 파이프라인 — 스트리밍

생성은 **한 요청 안에서 돌면서 결과를 흘려보냅니다.** 브라우저는 단계가 끝나는 대로 받아
문서에 반영하므로, 5단계가 다 끝나기를 기다리지 않습니다.

```
브라우저                              서버
   │  POST /api/generate               │
   │  { artifacts, plan }              │
   │ ────────────────────────────────▶ │
   │ ◀── {"type":"start","artifact":"prd"}
   │ ◀── {"type":"step","artifact":"prd","patch":{…}}    → 바로 문서에 반영
   │ ◀── {"type":"start","artifact":"fs"}
   │ ◀── {"type":"step","artifact":"fs","patch":{…}}     → 바로 반영
   │            …                      │
   │ ◀── {"type":"done"}               │
```

한 줄에 한 사건씩(NDJSON) 나갑니다.

### 왜 작업 큐가 아니라 스트리밍인가

처음에는 서버 메모리에 작업을 쌓아 두고 브라우저가 `/api/jobs/{id}` 로 찾아가게 했습니다.
**서버리스에서 깨졌습니다.** 인스턴스가 여러 개라 등록한 쪽과 조회하는 쪽이 달라
"작업을 찾을 수 없습니다" 가 났습니다.

한 요청 안에서 끝내면 인스턴스가 갈릴 일이 없습니다. 외부 저장소도 필요 없습니다.

### 화면을 옮겨도 이어지는 이유

읽기는 `src/lib/jobs/runner.ts` 의 **모듈 수준 함수**가 합니다. React 컴포넌트 안이
아니므로 화면이 언마운트돼도 멈추지 않습니다. 진행 상태는 스토어(`activeRun`)에 두어
어느 화면에서든 같게 보입니다.

### 창을 닫으면 그 단계까지만

연결이 끊기면 서버의 `request.signal` 이 서고, 파이프라인은 **다음 단계로 넘어가지 않습니다.**
지금 돌던 단계는 마칩니다 — 이미 모델을 부른 뒤라 버리면 그만큼이 낭비입니다.

```
① PRD ✓  ② 기능명세서 ✓  ③ 정보구조도  ④ 유저 플로우  ⑤ 와이어프레임
                              ▲
                    여기서 창이 닫힘 → 여기까지만
```

이어 하기 위한 기록은 **브라우저가 가지고 있습니다**(`interrupted`, localStorage 저장).
시작할 때 적어 두고 단계마다 갱신하므로 탭이 갑자기 사라져도 남습니다.
돌아오면 `ResumeBanner` 가 떠서 **남은 단계만** 다시 맡깁니다.

서버는 아무것도 기억하지 않습니다. 그래서 서버리스에서도 그대로 동작합니다.

### 크레딧

**결과를 받았을 때** 차감합니다. 시작할 때 미리 빼면, 그 단계가 끝나기 전에 창을 닫았을 때
받지도 못한 것에 값을 치른 셈이 됩니다. 다음 단계 값을 낼 수 없으면 거기서 멈춥니다.

## AI 제안 검토 상태

AI 가 만든 요구사항·기능·상세명세에는 `review: 'pending'` 이 붙습니다.

```ts
export interface Reviewable {
  review?: ReviewState;   // 'pending' | 없음
}
```

**승인하면 필드를 지웁니다.** 값이 없는 상태가 곧 승인된 상태이므로,
이 필드가 없던 시절에 저장된 플랜도 마이그레이션 없이 그대로 열립니다.
사용자가 직접 추가한 항목에는 붙이지 않습니다.

**거절은 삭제입니다.** 그래서 삭제 캐스케이드를 `fs-review.ts` 한 곳에 두고
스토어의 `removeRequirement` · `removeFeature` · `removeSpecification` 도 같은 함수를 씁니다.
두 곳에 나눠 두면 한쪽만 고쳐져 정보구조도의 기능 연결이 남는 식으로 어긋납니다.

## 저장과 동기화

### 왜 브라우저가 계속 정본인가

계정이 붙었지만 편집은 **여전히 localStorage 에 먼저 쓴다.** 서버는 그 뒤에
따라간다.

```
편집 → zustand → localStorage        (즉시, 예전과 동일)
                    ↓ 1.2초 디바운스
                 PUT /api/plans/:id   (뒤에서)
```

플랜을 서버 우선으로 바꾸면 생성 파이프라인·되돌리기·검토 워크플로가 전부
네트워크에 묶인다. 지금 방식은 이 셋을 하나도 건드리지 않으면서, 연결이 끊겨도
작업이 멈추지 않고, 올리기에 실패해도 내용이 사라지지 않는다.

### 무엇이 최신인지 판단하는 규칙

같은 플랜이 양쪽에 있으면 `updatedAt` 이 최신인 쪽이 이긴다. 서버도 같은 규칙을
`on conflict ... where plans.updated_at <= excluded.updated_at` 로 한 번 더 건다.
탭을 두 개 띄웠을 때 오래된 쪽의 저장이 늦게 도착해도 새 내용을 지우지 못한다.

### 지운 것과 못 올린 것을 어떻게 구별하나

`unione-fastplaner:synced:v1` 에 **서버로 올린 플랜의 ID 와 시각**을 남긴다.
새로고침한 뒤 "로컬에는 있는데 서버에 없는 플랜" 을 만나면 이 기록으로 나눈다.

| 올린 기록 | 판단 | 처리 |
| --- | --- | --- |
| 있음 | 다른 기기에서 지웠다 | 여기서도 지운다 |
| 없음 | 연결이 끊긴 채 새로 만들었다 | 서버로 올린다 |

이 기록이 없으면 둘을 구별할 수 없어 **한쪽 기기에서 지운 플랜이 다른 기기에서
되살아난다.** 검증 중에 실제로 겪었다.

### 계정이 바뀔 때

로그인·로그아웃하면 브라우저의 플랜 사본을 비운다. 한 컴퓨터를 여러 명이 쓸 때
앞사람 플랜이 뒷사람 계정으로 올라가는 사고를 막기 위해서다.

로그인 **전에** 만든 플랜(`owner === null`)은 버리지 않고
`unione-fastplaner:guest-backup` 으로 옮긴 뒤 화면에서 물어본다. 누르기 전까지
서버로 올라가지 않는다.

### 받아 오기와 올리기는 겹치지 않는다

`sync.ts` 의 `serialize()` 가 둘을 한 줄로 세운다. 겹치면 올리기가 붙잡고 있던
옛 목록을 기준으로 삭제를 판단해 방금 받아 온 플랜을 지운다.

### 키

| 키 | 내용 | 바꿔도 되나 |
| --- | --- | --- |
| `unione-fastplaner:v1` | 플랜·크레딧·중단된 생성 | **안 된다** — 바꾸면 사용자 플랜이 전부 사라진다 |
| `unione-fastplaner:synced:v1` | 서버로 올린 기록 | 지워도 안전 (다음 동기화에서 다시 만든다) |
| `unione-fastplaner:guest-backup` | 로그인 전 플랜 보관함 | 지우면 그 플랜은 사라진다 |

크레딧 한도처럼 저장된 값의 의미가 달라지는 변경은 `store.ts` 의
`CREDIT_POLICY_VERSION` 을 올리고 `migrate()` 에서 처리한다.

## 데이터베이스 — 한 SQL, 두 엔진

`lib/db/index.ts` 는 `DATABASE_URL` 유무로 백엔드를 고른다.

| 환경 | 백엔드 |
| --- | --- |
| 배포 | Supabase 등 Postgres (`pg` 드라이버) |
| 로컬·테스트 | PGlite — Postgres 를 WebAssembly 로 빌드한 것 |

둘 다 진짜 Postgres 라서 **같은 SQL 이 양쪽에서 그대로 돈다.** Postgres 서버를
띄울 수 없는 환경에서도 질의를 실제로 실행해 검증할 수 있고, Supabase 전용 SDK 를
쓰지 않으므로 나중에 Neon·RDS 로 옮겨도 코드가 그대로다.

스키마는 서버가 뜰 때 `create table if not exists` 로 만든다. 서버리스는
인스턴스가 여러 개 동시에 뜨므로 `pg_advisory_xact_lock` 으로 한 번에 하나만
들어가게 한다 — `if not exists` 만으로는 이 경쟁을 막지 못한다.

## 개발 명령

```bash
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드
npm run start     # 프로덕션 서버
npm run lint      # ESLint
npm run check:ai  # AI 공급자 연결 점검
npx tsc --noEmit  # 타입 검사
```
