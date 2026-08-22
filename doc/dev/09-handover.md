# 9. 인계인수서 (2026-08-23)

> 새 컴퓨터에서 이어서 작업하는 사람을 위한 문서입니다.
> 저장소를 내려받으면 이 파일이 그대로 들어 있습니다.

---

## 1. 서비스 개요

**UniBoard** — 서비스 아이디어 한 줄로 기획서 한 세트(PRD → 기능명세서 → 정보구조도 →
유저 플로우 → 와이어프레임)를 만들고, 내보내기에서 **UniAI 화면 생성**(HTML/CSS/JS 코드)과
스티치·디자인 도구 핸드오프까지 하는 AI 기획 에디터.

| 항목 | 값 |
| --- | --- |
| 저장소 | https://github.com/nettman001-hub/UniONE-FastPlanner (기본 브랜치 `main`) |
| 프로덕션 | https://uniboard.cloud |
| 호스팅 | Vercel (Hobby 플랜) — **`main` push 시 자동 재배포** |
| 데이터베이스 | Supabase Postgres (`DATABASE_URL`, Transaction pooler 포트 6543) |
| AI 공급자 | DeepSeek (`deepseek-v4-flash` 기본 / `deepseek-v4-pro` 고급) |
| 스택 | Next.js 15 App Router · TypeScript · Tailwind v4 · zustand · PGlite(로컬) |

---

## 2. 새 컴퓨터에서 시작하기

```powershell
git clone https://github.com/nettman001-hub/UniONE-FastPlanner.git
cd UniONE-FastPlanner
npm install
Copy-Item .env.example .env.local   # 선택 — 키 없이도 내장 생성기 모드로 동작
npm run dev                          # http://localhost:3000
```

- Node.js 20 이상 (이 문서 작성 시점에 24 사용)
- **AI 실측을 하려면** `.env.local`에 `DEEPSEEK_API_KEY` 입력 후
  `npx tsx scripts/qa/qa-live.ts` — 키 없으면 `SKIP (키 없음)` 이라고 나오며 실패가 아니다
- **로컬 로그인**: `.env.local`에 `AUTH_SECRET` + `TESTER_EMAIL`/`TESTER_PASSWORD` 두 줄이면
  첫 로그인 때 계정이 자동 생성된다
- `.env.local`이 없으면 PGlite(파일 기반 Postgres)가 `.pglite` 폴더에 데이터를 둔다.
  **배포에는 반드시 `DATABASE_URL` 필요** (서버리스는 파일이 인스턴스와 함께 사라짐)

점검 명령 한 벌:

```powershell
npx tsc --noEmit              # 타입
npm run lint                  # 린트
npm run build                 # 프로덕션 빌드 (docs 정적 생성 포함)
npm run check:ai              # DeepSeek 키·모델·잔액 점검
npx tsx scripts/qa/qa-tokens.ts   # 토큰 셋 결정적 검사
npx tsx scripts/qa/qa-style.ts    # 퓨샷·품질 기준 검사
npx tsx scripts/qa/qa-prompt.ts   # 프롬프트 조립 검사
```

> `scripts/qa/*.ts`는 `tsx`(devDependency, 이미 package.json에 있음)로 실행한다.

---

## 3. 이번 세션에서 한 일 — UniAI 디자인 품질 개선

**배경**: "UniAI로 바로 만들기" 결과물이 범용적(AI-slop)이었다. 디자인 스킬 6종이
산문 지침뿐이라 모델이 색·간격·타이포를 즉흥 결정했기 때문.

**해법**: 스킬마다 **구체 디자인 토큰**(색 16종·타입 스케일·간격 스케일·모서리·그림자·폰트
스택)을 코드로 정의하고, 서버가 생성 CSS 맨 앞에 토큰 `:root` 블록을 직접 주입 —
모델은 `var(--*)` 참조만 하면 된다. 고급 엔진은 만든 뒤 "디자인 비평 → CSS 재작성"
2차 호출로 한 번 더 다듬는다(추가 크레딧 없음).

### 커밋 목록 (전부 `main`에 push 완료)

| 커밋 | 내용 |
| --- | --- |
| `d6eb9c8` | feat(design): UniAI 디자인 토큰 셋과 생성기 추가 |
| `7df0f0d` | feat(design): UniAI 품질 기준과 퓨샷 예시 추가 |
| `d6c6c9d` | feat(uniai): UniAI 프롬프트를 토큰 기반으로 재구성 |
| `f6b5323` | feat(uniai): UniAI 결과 CSS에 토큰 주입 + 고급 엔진 디자인 정제 패스 |
| `c5e0a34` | docs(uniai): UniAI 엔진·스킬 안내 갱신 |
| `ce2b818` | docs(uniai): UniAI 디자인 스킬·정제 안내 문서 갱신 |
| `a2fc76d` | test(uniai): UniAI 실측 스모크 스크립트 추가 및 .omo gitignore |
| `c692726` | fix(uniai): :root 이중 선언·style 침투 방어와 토큰 사용 교정 재시도 |

### 핵심 파일

| 파일 | 역할 |
| --- | --- |
| `src/lib/design/uniai-tokens.ts` | **신규.** 토큰 셋 6종+중립(`none`), `tokensToCssBlock`·`tokensToPromptBlock`·`componentRecipes`·`composeScreenCss`·`stripRootBlocks`·`stripStyleTags` |
| `src/lib/design/uniai-style.ts` | **신규.** `UINAI_HARD_RULES`(토큰만 사용·:root 재선언 금지 등)·`UINAI_SOFT_RULES`(안티-slop 품질 기준)·`UINAI_STYLE_EXEMPLAR`(퓨샷 CSS) |
| `src/lib/design/uinai-prompt.ts` | 재구성 — 시스템 프롬프트 교체, `buildUinAiPrompt`(서비스 배경 → 스킬 designMd → 토큰 → 레시피 → 퓨샷 → screenPrompt → 결과물 기준) |
| `src/app/api/design/uinai/run/route.ts` | 배선 — 처리 순서: `sanitize → stripRoot :root 제거 → (고급) refineCss 비평·재작성 → 품질 게이트(교정 1회) → composeScreenCss 주입 → 저장` |
| `src/components/UinAiRun.tsx` | UI 텍스트 — 토큰 반영 안내, 고급 엔진 "한 번 더 다듬습니다" 문구 |
| `scripts/qa/qa-*.ts` 4종 | **신규.** 토큰/스타일/프롬프트 단위 검사 + 실측 스모크 |

### 동작 원리 요약

1. 사용자가 스킬 선택(기본 `깔끔한 기본`) → 서버가 `findTokenSet(skill)` 로 토큰 셋 결정
2. 프롬프트에 토큰 **변수명 그대로**(예: `--c-primary:#3B5BDB;`)를 실어 주고,
   ":root를 다시 선언하지 말고 var(--*) 참조만" 을 하드 제약으로 못 박는다
3. 생성된 CSS에서 모델의 `:root`·HTML의 `<style>` 을 **결정적으로 제거** (서버 주입 블록이
   유일한 선언 — 뒤에 오는 모델 선언이 값을 덮는 사고 방지)
4. 고급 엔진만: 시니어 리뷰어 페르소나로 "비평 → 개선한 CSS 전문" 2차 호출 (실패 시 1차 유지)
5. 품질 게이트: `var(--)` 사용 < 8회 또는 하드코딩 색이 더 많으면 교정 프롬프트로 1회 재시도
6. 저장 직전 `composeScreenCss(skill, css)` 가 리셋+토큰 블록+모델 CSS 순으로 조립 —
   **이 함수가 저장 CSS의 유일한 출구**

### 2026-08-23 실서비스 검증 기록

uniboard.cloud(배포 `c692726`)에서 "인스타그램_V2_Flash" 플랜의 PG-005 로그인 화면을
기본 엔진·깔끔한 기본 스킬로 생성(5크레딧)하여 확인:

- 토큰 블록이 CSS 맨 앞에 정확히 주입됨, 모델 `:root` 이중 선언 없음
- 모델 CSS가 색·간격·모서리·글자 크기 전부 `var(--*)` 사용
- hover/focus-visible/disabled/error/success/placeholder 상태와 모바일 반응형 포함
- 크레딧 5 정확 차감

---

## 4. 배포와 운영

### 배포

- `main` push → Vercel 자동 재배포 (2~3분, 프로덕션 = uniboard.cloud)
- 되돌리기: Vercel Deployments → 이전 배포 → Promote to Production
- 환경변수 변경 후에는 **Redeploy 필요**
- `/api/generate`·`/api/chat`·UniAI 라우트는 `maxDuration=300` — Vercel 설정에서
  **Fluid compute**가 켜져 있어야 함 (Settings → Functions)

### 환경변수 (이름만 — 값은 Vercel 대시보드에서 확인)

```
AI_PROVIDER · DEEPSEEK_API_KEY · DEEPSEEK_BASE_URL · DEEPSEEK_MODEL · DEEPSEEK_MAX_TOKENS(구식)
DATABASE_URL · AUTH_SECRET · ADMIN_EMAILS · SIGNUP_CODE · TESTER_EMAIL · TESTER_PASSWORD
```

- `DEEPSEEK_MODEL_BASIC`/`_ADVANCED` 는 미설정 → 기본 엔진은 코드 기본값
  (`deepseek-v4-flash`), 고급은 `DEEPSEEK_MODEL` 값으로 동작
- `DEEPSEEK_MAX_TOKENS` 는 더 이상 쓰지 않음(출력 상한은 앱 전체 384K 고정)
- `AUTH_SECRET` 을 바꾸면 **모든 사용자가 로그아웃** (계정·플랜은 유지)
- `ADMIN_EMAILS` 에 적힌 계정으로 로그인해야 `/admin` (점검 탭에서 배포 상태 진단)

### 관리자

- `/admin` 대시보드 · `/admin/users` (크레딧 되돌리기) · `/admin/ai` (AI 설정 —
  여기서 바꾼 키·모델은 재배포 없이 적용, 키는 잠금 저장) · `/admin/health` 점검

---

## 5. 알려진 한계와 다음 작업 후보

| 항목 | 내용 |
| --- | --- |
| 스킬 변경 시 "업데이트 필요" 배지 | `uinAiSourceSignature`(src/lib/design/uinai.ts)에 `skill` 미포함 — 스킬을 바꿔도 기존 결과에 배지가 안 붙음. 개선 후보 |
| 기본 엔진 모델 | `deepseek-v4-flash`는 빠르지만 디자인 품질이 약하다. 품질 우선이면 Vercel에 `DEEPSEEK_MODEL_BASIC=deepseek-v4-pro` 를 넣거나 고급 엔진 권장 |
| 시각 검증 | 생성 결과의 픽셀 확인은 이미지를 읽는 모델/사람이 필요. 코드 수준 검증은 `scripts/qa/qa-live.ts` |
| `doc/dev/04-ai-providers.md` 말미 | "데이터가 어디로 가는가" 섹션이 계정 기능 도입 전 내용("서버 DB 없음")으로 낡음 — 갱신 필요 |
| `doc/dev/01-setup.md` | 클론 명령이 옛 브랜치(`claude/manyfast-plan-app-d9q2c7`)를 참조 — `main`으로 고칠 것 |
| `.omo/` 폴더 | 작업 계획·검증 증거(로컬 전용, gitignore). 다른 PC에서 보려면 폴더째 복사 |
| 오픈소스 에이전트 플러그인(oh-my-openagent) | 이 PC에서 삭제됨 — 순수 OpenCode로 작업 중. 에이전트 설정은 `~/.config/opencode/` |

## 6. 키와 계정 (위치만 — 값은 각자 안전하게 관리)

- **DeepSeek 키**: Vercel 환경변수 + 관리자 화면(AI 설정, AES 잠금 저장). 로컬 `.env.local`에는 없음
- **Supabase**: `DATABASE_URL`(Vercel). Supabase 무료 플랜은 1주일 미사용 시 일시 정지 → 대시보드에서 Restore
- **Vercel**: 프로젝트 `unione-fastplanner` (팀 nettman001-5045s-projects). 브라우저 로그인 세션 사용 중
- **관리자 계정**: `ADMIN_EMAILS`에 등록된 이메일(로그인 후 오른쪽 위 메뉴에 "관리자")

## 7. 작업 규칙 요약 (이 저장소의 관례)

- 커밋 메시지: `feat/fix/docs/test(스코프): 한국어 요약` (최근 로그 참조)
- 문서: 고객용은 `doc/`(manifest.json에 등록), 개발·운영용은 `doc/dev/` — 빌드 시 정적 생성
- 색은 CSS 변수(`var(--*)`)만 — 다크 모드가 깨진다
- 새 파일 표기는 `UniAI`/`uniai-*`. 기존 `uinai.ts`·`uinAiScreens` 등은 **저장된 플랜
  JSON 필드 호환 때문에 리네임 금지**
- 크레딧 표시와 서버 차감은 반드시 같은 함수(`costWithEngine`/`costOfArtifact`) 사용
