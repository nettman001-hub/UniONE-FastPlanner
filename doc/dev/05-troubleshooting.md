# 5. 문제 해결 (개발·운영)

## 좌측 하단 검은 원형 마크는 무엇인가요?

개발 모드(`npm run dev`)에서 화면 왼쪽 아래에 보이는 **Next.js 로고가 든 검은 원**은
**Next.js 가 프레임워크 차원에서 자동으로 넣는 개발 도구(Dev Tools) 버튼**입니다.
이 앱에서 넣은 것이 아니며, 코드에도 관련 부분이 없습니다.

- **개발 모드에서만 보입니다.** `npm run build && npm run start` 로 띄운 프로덕션
  화면에는 나타나지 않습니다.
- 사용자에게 배포되는 화면에는 절대 나오지 않습니다.
- 현재 라우트가 정적인지 동적인지, 컴파일 오류가 있는지 등을 알려 주는 개발용 도구입니다.

### 마크를 눌렀을 때 나오는 메뉴 (한글 대조표)

Next.js 내부 화면이라 표시 언어는 영어로 고정되어 있습니다. 각 항목의 뜻은 아래와 같습니다.

| 영문 표기 | 한글 뜻 | 설명 |
| --- | --- | --- |
| **Route** — `Static` | **라우트** — 정적 | 지금 보고 있는 페이지의 렌더링 방식. `Static` 은 빌드 시점에 미리 만들어 두는 페이지, `Dynamic` 은 요청할 때마다 서버에서 만드는 페이지입니다 |
| **Try Turbopack** › | **Turbopack 사용해 보기** | Next.js 의 새 번들러로 전환해 보라는 안내입니다. 지금은 쓰지 않아도 됩니다 |
| **Route Info** › | **라우트 정보** | 현재 페이지를 이루는 파일 구성을 보여줍니다 |
| **Preferences** ⚙ | **환경 설정** | 이 개발 도구 자체의 표시 설정입니다 |

### Route Info (라우트 정보)

| 영문 표기 | 한글 뜻 | 설명 |
| --- | --- | --- |
| **Route Info** | **라우트 정보** | 창 제목 |
| `↳ /` | 현재 경로 | 지금 보고 있는 URL 경로 |
| **app** ⓘ | **app 세그먼트** | App Router 의 경로 구간 |
| `layout.tsx` `page.tsx` | 이 경로를 구성하는 파일 | 각각 공통 레이아웃과 페이지 본문 파일입니다 |
| **Clear Segment Overrides** | **세그먼트 재정의 초기화** | 개발 중 임시로 바꿔 둔 라우트 설정을 되돌립니다 |

### Preferences (환경 설정)

| 영문 표기 | 한글 뜻 | 설명 |
| --- | --- | --- |
| **General** | **일반** | 설정 묶음 제목 |
| **Theme** — *Select your theme preference.* | **테마** — 테마를 고릅니다 | 개발 도구의 밝기 테마. 현재 값 `System`(시스템 설정 따름) |
| **Position** — *Adjust the placement of your dev tools.* | **위치** — 개발 도구가 표시될 위치를 조정합니다 | 현재 값 `Bottom Left`(좌측 하단). 화면 네 모서리 중에서 고를 수 있습니다 |
| **Size** — *Adjust the size of your dev tools.* | **크기** — 개발 도구의 크기를 조정합니다 | 현재 값 `Medium`(보통) |
| **Hide Dev Tools for this session** — *Hide Dev Tools until you restart your dev server, or 1 day.* | **이번 세션 동안 숨기기** — 개발 서버를 다시 시작하거나 하루가 지날 때까지 숨깁니다 | `Hide` 버튼을 누르면 임시로 사라집니다 |
| **Hide Dev Tools shortcut** — *Set a custom keyboard shortcut to toggle visibility.* | **숨기기 단축키** — 표시/숨김을 전환할 단축키를 직접 지정합니다 | `Record Shortcut` 을 누르고 원하는 키를 입력합니다 |
| **Disable Dev Tools for this project** — *To disable this UI completely, set `devIndicators: false` in your next.config* | **이 프로젝트에서 완전히 끄기** — 이 UI 를 완전히 끄려면 `next.config` 에 `devIndicators: false` 를 설정하세요 | 아래 방법 참고 |

### 완전히 없애려면

`next.config.ts` 에 한 줄을 추가합니다.

```ts
const nextConfig: NextConfig = {
  devIndicators: false,   // 좌측 하단 개발 도구 마크를 끕니다
  env: {
    NEXT_PUBLIC_HAS_LOGO: hasBrandLogo ? '1' : '',
  },
};
```

저장하고 개발 서버를 재시작하면 마크가 사라집니다.
다만 컴파일 오류나 라우트 정보를 빠르게 확인할 수단도 함께 사라지므로,
개발 중에는 켜 두고 필요할 때만 `Hide` 로 잠시 숨기는 편을 권합니다.

---

## 설치·실행

### `fatal: not a git repository`

저장소를 아직 내려받지 않은 폴더에서 `git pull` 을 실행한 경우입니다.
먼저 클론하세요.

```bash
cd C:\dev
git clone -b claude/manyfast-plan-app-d9q2c7 https://github.com/nettman001-hub/UniONE-FastPlanner.git
cd UniONE-FastPlanner
npm install
```

### `npm install` 이 `package.json` 을 못 찾음

프로젝트 폴더 밖에서 실행한 경우입니다. `cd UniONE-FastPlanner` 로 들어간 뒤 실행하세요.

### `Application error: a client-side exception has occurred`

서버를 켜 둔 채로 `npm run build` 를 다시 돌리면 발생합니다.
브라우저가 이전 빌드의 파일을 찾다가 실패한 것입니다.

**해결** — 서버를 완전히 종료하고 다시 시작하세요.

```bash
# 터미널에서 Ctrl+C 로 서버 종료 후
npm run start
```

### 포트 3000 이 이미 사용 중

다른 포트로 띄웁니다.

```bash
npm run dev -- -p 3001
```

---

## AI 생성

### `내장 생성기` 로만 동작함

`.env.local` 이 없거나 키가 비어 있습니다.

1. `.env.local` 파일이 프로젝트 루트에 있는지 확인
2. `DEEPSEEK_API_KEY=` 뒤에 키가 들어 있는지 확인
3. **서버를 재시작** — 환경변수는 서버 시작 시점에 읽습니다

`npm run check:ai` 로 어떤 공급자가 선택됐는지 바로 확인할 수 있습니다.

### 모델을 찾을 수 없다는 오류

`DEEPSEEK_MODEL` 값이 실제 제공되는 모델명과 다릅니다.

```bash
npm run check:ai
```

사용 가능한 모델 목록을 출력해 주므로 그중 하나로 바꾸고 서버를 재시작하세요.

### 응답이 출력 한도에서 잘림

기능명세서나 와이어프레임처럼 결과가 긴 산출물에서 발생할 수 있습니다.

`.env.local` 에서 상한을 올리세요.

```ini
DEEPSEEK_MAX_TOKENS=16384
```

모델이 지원하는 상한을 넘기면 오히려 400 오류가 나므로, 오류가 나면 값을 낮추세요.
와이어프레임은 한 번에 만드는 화면 수를 줄이는 것도 방법입니다.

### `Host not in allowlist` / 연결 실패

사내 프록시나 방화벽이 API 도메인을 막고 있습니다. 네트워크 관리자에게
`api.deepseek.com` 허용을 요청하거나, 키 없이 내장 생성기로 사용하세요.

---

## 운영 중 문의

### 로그인이 안 됨 — 배포한 주소에서

`AUTH_SECRET` 환경변수가 없으면 로그인이 동작하지 않습니다. 개발용 기본값으로
넘어가면 누구나 세션을 위조할 수 있어 일부러 막아 두었습니다.

Vercel **Settings → Environment Variables** 에 `AUTH_SECRET` 을 넣고
**Redeploy** 하세요. 자세한 내용은 [배포](./03-deploy.md).

### 사용자가 "저장 안 됨" 이 뜬다고 함

서버가 플랜을 받지 못하고 있습니다. 사용자의 작업 내용은 브라우저에 남아 있으므로
당장 유실되지는 않습니다.

1. `/api/auth/me` 를 열어 `"database"` 값을 봅니다.
   - `"local"` → `DATABASE_URL` 이 없습니다. [배포](./03-deploy.md) 참고
   - `"postgres"` → 연결은 되어 있습니다. 아래로.
2. Supabase 무료 플랜은 **일주일 넘게 안 쓰면 프로젝트가 일시 정지**됩니다.
   대시보드에서 `Restore` 를 누르면 다시 삽니다.
3. Vercel 함수 로그에서 실패 사유를 확인합니다.

### 사용자가 "플랜이 사라졌다" 고 함

먼저 어느 계정으로 로그인했는지 확인하게 하세요. 대부분 다른 계정으로 들어간 경우입니다.

로그인 기능이 생기기 전에 만든 플랜이라면, 처음 로그인할 때 뜨는
`내 계정으로 가져오기` 를 눌러야 계정으로 올라옵니다.

### 로고가 안 보이고 `UB` 만 나옴

`public/logo.png` 가 없습니다. 파일을 그 경로에 두고 **서버를 재시작**하세요.
파일 유무는 빌드 시점에 판단하므로 재시작 없이는 반영되지 않습니다.

### 크레딧 한도를 바꾸고 싶음

`src/lib/store.ts` 의 `DAILY_CREDIT_LIMIT` 을 수정하고 `CREDIT_POLICY_VERSION` 도
함께 올리세요. 올리지 않으면 기존 사용자는 다음 날 충전 전까지 옛 잔량을 그대로 씁니다.

---

## 사용자에게서 온 문의라면

화면 사용법·저장·크레딧·내보내기처럼 **고객이 겪는 문제**는 고객용 설명서의
[자주 묻는 질문](../08-faq.md) 에 정리되어 있습니다. 링크를 안내하세요.
