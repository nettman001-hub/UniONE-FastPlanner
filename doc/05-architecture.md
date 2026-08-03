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

서버 데이터베이스가 없습니다. 문서는 브라우저에만 저장됩니다.

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
    api/
      generate/route.ts          생성 작업 접수 (202 + jobId)
      jobs/route.ts              플랜의 작업 목록
      jobs/[id]/route.ts         작업 진행 상태
      chat/route.ts              AI 에이전트 대화 + 문서 패치
      status/route.ts            현재 공급자 상태
  lib/
    types.ts                     도메인 모델 — 단일 계약
    store.ts                     zustand 스토어 + 영속화
    brand.ts                     서비스명·로고 경로
    validate.ts                  정합성 검사 규칙
    fs-tree.ts                   기능명세서 트리 (세 보기가 공유)
    fs-review.ts                 AI 제안 승인/거절 + 삭제 캐스케이드
    jobs/store.ts                작업 저장소 (메모리 / 파일)
    jobs/queue.ts                작업 실행 — 5단계를 서버가 이어서 돈다
    jobs/progress.ts             브라우저가 들고 있는 진행 사본
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
    JobWatcher.tsx               서버 큐 확인 · 결과 반영
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

## 생성 작업 큐

생성은 **서버 큐에서 돕니다.** 브라우저는 작업을 맡기고 결과를 가지러 올 뿐이라,
화면을 옮기거나 탭을 닫아도 작업이 끊기지 않습니다.

```
브라우저                         서버
   │  POST /api/generate          │
   │  { artifacts, plan }         │
   │ ───────────────────────────▶ │  작업 등록
   │ ◀─────────────────────────── │  202 { jobId }   ← 곧바로 응답
   │                              │
   │                              │  ① PRD → ② 기능명세서 → ③ 정보구조도
   │                              │  → ④ 유저 플로우 → ⑤ 와이어프레임
   │                              │  앞 단계 결과를 서버 사본에 반영해
   │                              │  다음 단계 컨텍스트로 넘긴다
   │  GET /api/jobs/{id}          │
   │ ───────────────────────────▶ │
   │ ◀─────────────────────────── │  { status, current, done, patch }
   │  스토어에 반영                 │
```

| 경로 | 하는 일 |
| --- | --- |
| `POST /api/generate` | 작업을 맡기고 `202 { jobId }` 를 곧바로 돌려줍니다 |
| `GET /api/jobs/{id}` | 그 작업의 진행 상태와 누적 결과 |
| `GET /api/jobs?planId=` | 그 플랜에 남아 있는 작업 — 화면을 다시 열 때 찾습니다 |

### 전체 자동 생성은 한 작업입니다

5단계를 **서버가 이어서 돕니다.** 예전에는 브라우저가 단계마다 다시 요청했는데,
화면을 옮기면 다음 단계를 아무도 시작하지 않아 끊겼습니다.

### 폴링은 `JobWatcher` 한 곳에서만

`src/components/JobWatcher.tsx` 가 플랜 화면에 하나만 떠서 결과를 받아 옵니다.
화면을 열 때 `GET /api/jobs?planId=` 로 **서버에 남은 작업을 먼저 찾기** 때문에,
다음이 모두 같은 경로를 탑니다.

- 생성을 걸고 다른 메뉴로 이동
- 새로고침
- 탭을 닫았다가 나중에 다시 열기

### 작업 저장소

`src/lib/jobs/store.ts` 의 `JobStore` 인터페이스로 갈아 끼웁니다.

| 저장소 | 조건 | 내구성 |
| --- | --- | --- |
| 메모리 (기본) | 없음 | 서버 프로세스가 사는 동안 |
| 파일 | `JOB_STORE_DIR` | 서버를 재시작해도 남음 |

**서버리스(Vercel) 주의** — 인스턴스가 흩어지고 `/tmp` 도 공유되지 않아 두 저장소 모두
인스턴스 간에는 보장되지 않습니다. 그 환경에서 완전한 내구성이 필요하면 같은 인터페이스로
외부 저장소(KV·Redis·DB) 어댑터를 만들어 `jobStore()` 에서 돌려주면 됩니다.

### 크레딧

작업을 맡길 때 차감하고, 실패하면 **못 만든 단계만큼 돌려줍니다.**
작업이 사라졌을 때(서버 재시작 등)는 전액 돌려줍니다.

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

## 저장 형식과 마이그레이션

localStorage 키는 `unione-fastplaner:v1` 입니다.
**이 키를 바꾸면 사용자가 만든 플랜이 전부 사라집니다.** 서비스명을 바꿔도 그대로 두세요.

크레딧 한도처럼 저장된 값의 의미가 달라지는 변경은 `store.ts` 의
`CREDIT_POLICY_VERSION` 을 올리고 `migrate()` 에서 처리합니다.

## 개발 명령

```bash
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드
npm run start     # 프로덕션 서버
npm run lint      # ESLint
npm run check:ai  # AI 공급자 연결 점검
npx tsc --noEmit  # 타입 검사
```
