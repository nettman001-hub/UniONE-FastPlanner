# UniONE FastPlanner

> 서비스 아이디어 한 줄에서 **PRD → 기능명세서 → 정보구조도 → 유저 플로우 → 와이어프레임**까지.
> 기획 산출물을 한 번에 만들고, 서로 연결하고, 정합성을 검증해 개발팀에 넘기는 AI 기획 에디터.

[docs.manyfast.io/plan/plan](https://docs.manyfast.io/plan/plan) 의 "기획하기" 워크플로를 분석해
동일한 기능을 수행하도록 만든 웹 애플리케이션입니다.

> **자세한 사용 설명서는 [`doc/`](./doc/README.md) 폴더에 있습니다.**
> 설치·화면별 사용법·AI 설정·내보내기·구조·문제 해결·배포를 7개 문서로 나누어 정리했습니다.

---

## 무엇을 하는 앱인가

기획자는 보통 PRD 문서, 기능 정의 스프레드시트, IA 시트, 플로우차트 툴, 와이어프레임 툴을
각각 열어 놓고 같은 내용을 다섯 번 옮겨 적습니다. 하나가 바뀌면 나머지 넷이 조용히 낡습니다.

이 앱은 다섯 산출물을 **하나의 데이터 모델**로 묶습니다.
기능(`FN-003`)은 화면(`PG-012`)에 배치되고, 화면은 플로우 노드가 되고, 플로우 노드는
와이어프레임으로 이어집니다. 그래서 "어떤 화면에도 배치되지 않은 기능"이나
"빠져나갈 수 없는 플로우 단계" 같은 구멍을 앱이 직접 찾아낼 수 있습니다.

---

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| **기획하기 위저드** | 서비스명·아이디어·타겟·목적·플랫폼을 3단계로 입력하면 플랜 생성 |
| **프로덕트 요구사항 (PRD)** | 개요, 배경, 핵심 목표, 페르소나, 사용자 역할, 사용 환경, 핵심 가치, 성공 지표, 범위, 제약사항 |
| **기능명세서 (FS)** | 요구사항 `REQ-001` → 기능 `FN-001` → 상세명세 `SP-001` 3단 구조. **마인드맵 / 리스트 / 표** 3가지 보기. 기본 흐름·예외 처리·인수 조건까지 |
| **정보구조도 (IA)** | 최대 3 depth 화면 트리 / 표 / 사이트맵 3가지 보기. 화면별 접근 역할과 **상세 기능 연결** |
| **유저 플로우** | 시작·화면·행동·분기·시스템·종료 노드로 구성된 플로우차트. 직접 그린 SVG 캔버스 + Mermaid 코드 내보내기 |
| **와이어프레임** | IA 화면마다 저해상도 목업 생성. 모바일/데스크톱 프레임, 17종 블록 |
| **AI 제안 검토** | AI 가 만든 항목에 `신규` 배지. 하나씩 넘겨 보며 승인·거절하거나 일괄 처리 |
| **AI 에이전트** | 현재 문서 전체를 읽고 답하거나, 요청대로 산출물을 다시 만들어 반영 |
| **정합성 검사** | 배치되지 않은 기능, 도달 불가 플로우 단계, 분기가 하나뿐인 조건, 중복 경로 등을 자동 탐지 |
| **내보내기** | 마크다운 · 기능명세서 CSV · IA CSV · 플랜 JSON · **코딩 에이전트 번들** · Mermaid |
| **이미지** | 와이어프레임과 플로우차트를 SVG·PNG로 (디자인 전달용) |
| **공유** | 문서를 링크에 담아 전달하는 보기 전용 페이지 — 서버를 거치지 않음 |
| **협업** | 항목별 코멘트와 해결 처리, 버전 스냅샷 저장/복원 |
| **단계별 스트리밍** | 산출물이 만들어지는 대로 화면에 반영. 화면을 옮겨도 이어지고, 창을 닫으면 그 단계까지만 하고 멈췄다가 돌아오면 이어서 만듭니다 |
| **크레딧** | 산출물별 크레딧 차감, 매일 자동 충전 (현재 하루 200 — 임시 한도) |

### 코딩 에이전트 연동

내보내기의 **에이전트 번들**은 ID 참조를 모두 이름까지 펼쳐 담은 JSON입니다.
Cursor나 Claude Code에 그대로 물려서 기획서를 읽고 구현하게 할 수 있습니다.

```
plan-bundle.json 을 읽고 informationArchitecture 의 각 페이지를 라우트로,
requirements[].features[].specifications 를 구현 단위로 삼아 작업 계획을 세워줘.
```

---

## 시작하기

```bash
npm install
cp .env.example .env.local   # DEEPSEEK_API_KEY 입력
npm run check:ai             # 키·모델·연결 점검
npm run dev
```

http://localhost:3000 에서 열립니다.

### 로고

`public/logo.png` 를 두면 헤더·홈 제목·브라우저 탭 아이콘에 그 이미지를 씁니다.
정사각형 이미지를 권장하며, 파일이 없으면 `UF` 이니셜 마크로 대체됩니다.

> 파일 유무는 **빌드 시점에 판단**합니다. 로고를 새로 넣거나 지웠다면 개발 서버를
> 다시 시작(프로덕션은 `npm run build` 후 재시작)해야 반영됩니다.

### AI 공급자

`.env.local` 로 정합니다. 키가 없으면 내장 생성기로 동작하며, 앱의 모든 기능은 그대로 쓸 수 있습니다.

```ini
AI_PROVIDER=deepseek                       # deepseek | anthropic | local
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com # OpenAI 호환 엔드포인트
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_MAX_TOKENS=8192                   # 응답이 잘리면 올리세요
```

| | DeepSeek | Anthropic | 내장 생성기 |
| --- | --- | --- | --- |
| 조건 | `DEEPSEEK_API_KEY` | `ANTHROPIC_API_KEY` | 키 없음 |
| JSON 형식 강제 | JSON 모드 + 프롬프트 내 스키마 | 구조화 출력(`output_config.format`) | 해당 없음 |
| AI 에이전트 채팅 | 문서를 실제로 수정 | 문서를 실제로 수정 | 문서 현황 요약만 |
| 그 외 모든 기능 | 동일 | 동일 | 동일 |

`AI_PROVIDER` 를 지정하지 않으면 `DEEPSEEK_API_KEY` → `ANTHROPIC_API_KEY` → 내장 생성기 순으로 고릅니다.

내장 생성기는 아이디어에서 도메인(커머스 · 커뮤니티 · 예약 · 교육 · 협업 · 헬스 · 금융 · 일반)을
추정해 그에 맞는 산출물을 만듭니다. **모델 호출이 실패하면 자동으로 내장 생성기로 넘어가고
실패 사유를 화면에 알려주므로, 작업 흐름이 끊기지 않습니다.**

`npm run check:ai` 는 실제로 한 번 호출해 보고 키·모델명·잔액·네트워크 중 무엇이 문제인지
집어서 알려줍니다. 앱을 띄우기 전에 먼저 돌려 보세요.

---

## 구조

```
src/
  app/
    page.tsx                     플랜 목록 + 기획하기 위저드
    plans/[id]/
      layout.tsx                 워크스페이스 셸 (사이드바 · 크레딧 · AI 에이전트)
      page.tsx                   개요 — 파이프라인 · 정합성 검사 · 버전 · 코멘트
      prd/ fs/ ia/ flow/ wireframe/ export/
    share/page.tsx               보기 전용 공유 (URL 해시에서 문서를 읽음)
    api/
      generate/route.ts          생성 — 결과를 NDJSON 으로 흘려보냄
      chat/route.ts              AI 에이전트 대화 + 문서 패치
      status/route.ts            현재 생성 모드
  lib/
    types.ts                     도메인 모델 (단일 계약)
    store.ts                     zustand + localStorage 영속화
    validate.ts                  정합성 검사 규칙
    fs-tree.ts                   기능명세서 트리 (마인드맵·리스트·표 공유)
    fs-review.ts                 AI 제안 승인/거절 + 삭제 캐스케이드
    jobs/                        생성 파이프라인 (서버) · 스트림 읽기 (브라우저)
    export.ts                    마크다운 / CSV / JSON / Mermaid / 에이전트 번들
    image-export.ts              와이어프레임·플로우차트 SVG / PNG
    share.ts                     보기 전용 링크 인코딩
    ai/
      provider.ts                공급자 결정 (DeepSeek / Anthropic / 내장)
      client.ts                  공급자 분기 + Anthropic 어댑터
      deepseek.ts                DeepSeek 어댑터 (OpenAI 호환 + JSON 모드)
      schemas.ts                 산출물 JSON 스키마
      prompts.ts                 시스템 프롬프트 · 단계별 컨텍스트 구성
      local-generator.ts         키 없이 동작하는 규칙 기반 생성기
      apply.ts                   초안 → 도메인 객체 (ID 부여 · 참조 검증)
  components/
    ui.tsx                       토스트 · 모달 · 인라인 편집기 · 리스트 편집기
    FsMindmap.tsx                기능명세서 마인드맵 캔버스
    ReviewBar.tsx                AI 제안 검토 바 · 신규 배지
    ResumeBanner.tsx             멈춘 작업 이어서 만들기 안내
    AgentPanel.tsx               AI 에이전트 패널
    FlowCanvas.tsx               플로우차트 SVG 렌더러
    WireframeView.tsx            와이어프레임 렌더러
```

### 설계 노트

- **ID는 서버가 부여합니다.** 모델은 배열 인덱스로 상위 항목을 가리키고,
  `REQ-001` 같은 실제 ID는 `apply.ts`에서 규칙에 따라 붙입니다. 모델이 ID를 지어내며
  생기는 참조 깨짐을 원천적으로 막습니다.
- **단계마다 앞 산출물을 컨텍스트로 넘깁니다.** IA를 만들 때는 이미 확정된 기능 ID 목록을
  주고, 그 안에서만 고르게 합니다 (`prompts.ts` → `contextBlock`).
- **공급자는 갈아 끼울 수 있습니다.** 호출부는 `generateJson({prompt, schema})` 만 알고,
  DeepSeek 은 JSON 모드로 Anthropic 은 구조화 출력으로 같은 계약을 지킵니다.
  스키마를 벗어난 값이 와도 `apply.ts` 가 열거형·인덱스·참조를 정규화하므로 파이프라인이 깨지지 않습니다.
- **생성 결과는 단계마다 흘러옵니다.** `/api/generate` 가 NDJSON 으로 내보내고 브라우저가
  받는 대로 반영합니다. 읽기는 모듈 수준에서 돌아 화면을 옮겨도 끊기지 않고, 창을 닫으면
  서버가 다음 단계로 넘어가지 않습니다. 돌아오면 남은 단계부터 이어 갑니다.
  서버가 아무것도 기억하지 않으므로 서버리스에서도 그대로 동작합니다.
- **문서는 브라우저에만 저장됩니다.** 서버로 나가는 것은 AI 생성 요청 시점의 문서 내용뿐이고,
  API 키는 서버에만 있습니다.

---

## 스크립트

```bash
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드
npm run start     # 프로덕션 서버
npm run lint      # ESLint
npm run check:ai  # AI 공급자 연결 점검
```

> 서버를 켜 둔 채 `npm run build` 를 다시 돌리면 브라우저가 이전 빌드의 청크를 찾다가
> `Application error` 가 납니다. 빌드 후에는 서버를 재시작하세요.

---

## 배포

이 앱은 API 라우트와 동적 라우트를 쓰므로 **Node.js 프로세스가 필요합니다.**
정적 파일만 올리는 일반 웹호스팅(FTP)에는 그대로 올릴 수 없습니다.

권장은 **Vercel** 입니다. 저장소를 연결하고 환경변수만 넣으면 되고,
쓰던 도메인은 DNS 만 바꿔 그대로 붙일 수 있습니다.

단계별 안내는 [`doc/07-deploy.md`](./doc/07-deploy.md) 를 보세요.
환경변수 이름, Fluid compute 설정, 도메인 레코드, 요금까지 정리해 두었습니다.
