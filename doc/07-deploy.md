# 7. 배포 (Vercel + 도메인 연결)

이 앱을 인터넷에 올려 다른 사람도 쓰게 하는 방법입니다.

## 먼저: 어디에 올릴 수 있나

이 앱은 **Node.js 프로세스가 상시 떠 있어야** 동작합니다.
`npm run build` 결과에서 `ƒ` 표시가 붙은 라우트가 요청마다 서버에서 만들어지는 부분입니다.

```
├ ƒ /api/generate      생성 — DeepSeek 키를 여기서만 사용
├ ƒ /api/chat          AI 에이전트
├ ƒ /api/status        현재 공급자 상태
├ ƒ /plans/[id]        플랜 ID 가 실행 중에 생기는 동적 라우트
└ ○ /share             이것만 정적
```

| 올릴 곳 | 가능 | 비고 |
| --- | --- | --- |
| **Vercel** | ✅ | Next.js 를 만든 회사. 설정이 거의 없음 — **이 문서에서 다룹니다** |
| 일반 웹호스팅 (Cafe24 10G광 등) | ❌ | Apache + PHP + FTP 구조라 Node 프로세스를 띄울 수 없음 |
| Cafe24 Node.js 호스팅 | △ | 별도 상품. FTP 불가(git 배포만) 이고 Next.js 13+ 실패 사례가 많음 |
| VPS / 클라우드 VM | ✅ | `npm run build && npm start` + PM2 + nginx 리버스 프록시 |

> 일반 웹호스팅에 올리려면 API 라우트를 없애고 정적 파일로 뽑아야 하는데,
> 그러면 **AI 생성 기능을 포기**해야 합니다. 브라우저에서 DeepSeek 을 직접 부르려면
> API 키를 자바스크립트에 넣어야 하고, 그 키는 누구나 소스 보기로 가져갈 수 있습니다.

---

## 1단계 — 저장소 준비

Vercel 은 GitHub 저장소를 그대로 읽어 갑니다. 별도 업로드가 없습니다.

프로덕션 도메인은 기본적으로 **기본 브랜치(`main`)** 에 연결됩니다.
작업물이 아직 다른 브랜치에 있다면 먼저 Pull Request 를 머지하세요.

로고를 쓰려면 **`public/logo.png` 가 저장소에 커밋되어 있어야 합니다.**
`.gitignore` 에 걸려 있지 않은지 확인하세요. 파일이 없으면 `UB` 이니셜 마크로 나옵니다.

```bash
git add public/logo.png
git commit -m "브랜드 로고 추가"
git push
```

---

## 2단계 — Vercel 프로젝트 만들기

1. [vercel.com](https://vercel.com) → **Sign Up** → **Continue with GitHub**
2. **Add New…** → **Project**
3. 저장소 목록에서 이 저장소를 찾아 **Import**
   - 목록에 없으면 **Adjust GitHub App Permissions** 로 저장소 접근 권한을 허용합니다.
4. **Framework Preset** 이 `Next.js` 로 자동 인식됩니다.
   **Build Command / Output Directory / Install Command 는 건드리지 마세요.** 기본값이 맞습니다.
5. **Root Directory** 는 `./` 그대로 둡니다.

---

## 3단계 — 환경변수 넣기

`.env.local` 은 `.gitignore` 에 있어 저장소에 올라가지 않습니다.
**Vercel 에 따로 넣어야 합니다.**

Import 화면(또는 나중에 **Settings → Environment Variables**)에서 아래를 추가합니다.
Production · Preview · Development 를 모두 체크하세요.

### AI 공급자

| Key | Value |
| --- | --- |
| `AI_PROVIDER` | `deepseek` |
| `DEEPSEEK_API_KEY` | 발급받은 키 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` |
| `DEEPSEEK_MAX_TOKENS` | `8192` |

### 로그인과 저장소

| Key | Value | 없으면 |
| --- | --- | --- |
| `DATABASE_URL` | Postgres 접속 문자열 (아래 참고) | **플랜이 저장되지 않습니다** |
| `AUTH_SECRET` | 16자 이상의 임의 문자열 | **로그인이 동작하지 않습니다** |
| `TESTER_EMAIL` | 예: `tester@uniboard.app` | 공용 테스트 계정 없음 |
| `TESTER_PASSWORD` | 지인에게 알려 줄 비밀번호 (8자 이상) | 공용 테스트 계정 없음 |
| `SIGNUP_CODE` | 초대 코드 | 가입이 닫힙니다 |

`AUTH_SECRET` 만들기:

```powershell
# PowerShell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
```
```bash
# 맥 · 리눅스
openssl rand -base64 36
```

> `AUTH_SECRET` 을 나중에 바꾸면 **모든 사용자가 로그아웃**됩니다.
> 계정과 플랜은 그대로 남습니다.

> **이름 앞에 `NEXT_PUBLIC_` 을 붙이지 마세요.**
> 그 접두사가 붙은 환경변수는 브라우저로 그대로 내려가 키가 공개됩니다.
> 위 이름 그대로 써야 서버에만 남습니다.

환경변수를 나중에 바꾸면 **Redeploy** 를 해야 반영됩니다.
AI 키를 넣지 않으면 내장 생성기로 동작하며, AI 생성 외 모든 기능은 그대로 쓸 수 있습니다.

---

## 3-1단계 — 데이터베이스 (Supabase)

플랜을 계정에 저장하려면 Postgres 가 필요합니다. Supabase 무료 플랜으로 충분합니다.

1. https://supabase.com 에서 **New project**
2. **Region** 은 `Northeast Asia (Seoul)`
3. **Database password** 를 `Copy` 해서 따로 적어 둡니다 — 나중에 다시 볼 수 없습니다.
   `@ : / ? # % &` 같은 기호가 들어가면 접속 문자열이 깨집니다. 영문·숫자만 쓰세요.
4. **Security 의 체크 두 개를 모두 끕니다**

   | 항목 | 값 |
   | --- | --- |
   | Enable Data API | 끔 |
   | Automatically expose new tables | 끔 |

   이 앱은 접속 문자열로 직접 붙으므로 REST API 가 필요 없습니다.
   켜 두면 `users` 표(비밀번호 해시가 든 표)가 인터넷에서 열립니다.
5. 프로젝트가 만들어지면 상단 **Connect** → **Direct (Connection string)** →
   **Transaction pooler** 의 주소를 복사합니다.

```
postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres
                          └── 대괄호까지 지우고 3번에서 정한 비밀번호를 넣습니다
```

완성한 한 줄을 `DATABASE_URL` 에 넣습니다.

> **반드시 Transaction pooler(포트 6543)** 를 쓰세요.
> 무료 플랜의 직접 연결(포트 5432)은 IPv6 전용이라 Vercel 에서 연결되지 않습니다.

표는 서버가 처음 뜰 때 자동으로 만들어집니다. SQL 을 직접 실행할 필요가 없습니다.

자세한 내용은 [계정과 데이터 저장](./08-accounts.md) 을 보세요.

---

## 4단계 — 배포

**Deploy** 를 누르면 2~3분 뒤 `프로젝트이름.vercel.app` 주소가 나옵니다.

배포되면 `https://프로젝트이름.vercel.app/api/status` 를 열어 확인하세요.

```json
{ "mode": "ai", "provider": "deepseek", "model": "deepseek-v4-pro" }
```

`"mode": "local"` 이면 키가 제대로 들어가지 않은 것입니다. 3단계를 다시 확인하고 Redeploy 하세요.

### Fluid compute 확인

`/api/generate` 와 `/api/chat` 은 `maxDuration = 300`(5분)으로 선언되어 있습니다.
긴 산출물을 만들 때 시간이 걸리기 때문입니다.

무료(Hobby) 플랜에서 300초를 쓰려면 **Fluid compute 가 켜져 있어야** 합니다.
꺼져 있으면 상한이 60초라 배포가 실패합니다.

- **Settings → Functions → Fluid compute** 에서 확인 (새 프로젝트는 기본으로 켜져 있습니다)
- 켤 수 없는 상황이면 아래 두 파일의 값을 `60` 으로 낮추면 배포됩니다.
  - `src/app/api/generate/route.ts`
  - `src/app/api/chat/route.ts`

### 생성 방식

생성은 **한 요청 안에서 돌며 결과를 흘려보냅니다.** 서버가 작업을 기억하지 않으므로
Vercel 처럼 인스턴스가 여러 개인 환경에서도 그대로 동작합니다. 추가 설정이 없습니다.

`maxDuration` 안에 5단계를 다 못 만들면 만든 데까지 저장되고, 화면에 이어서 만들기
안내가 뜹니다. 크레딧은 받은 것에만 차감됩니다.

---

## 5단계 — 도메인 연결 (Cafe24 도메인 기준)

이미 쓰고 있는 도메인을 그대로 붙일 수 있습니다. 도메인은 Cafe24 에 두고 **DNS 만** 바꿉니다.

### Vercel 쪽

1. 프로젝트 → **Settings → Domains**
2. 쓸 주소를 입력하고 **Add** — 예: `plan.내도메인.com`
3. Vercel 이 **설정해야 할 DNS 레코드를 화면에 알려줍니다.**

### Cafe24 쪽

**나의서비스관리 → 도메인 → DNS 관리**(호스트 IP 관리)에서 레코드를 추가합니다.

| 붙일 주소 | 레코드 종류 | 값 |
| --- | --- | --- |
| 서브도메인 `plan.내도메인.com` | `CNAME` | Vercel 이 알려준 값 |
| 루트도메인 `내도메인.com` | `A` | Vercel 이 알려준 IP |

> 값을 **Vercel 화면에 나온 것 그대로** 넣으세요.
> 예전에는 모두 `cname.vercel-dns.com` / `76.76.21.21` 이었지만,
> 지금은 프로젝트마다 다른 값(`xxxx.vercel-dns-017.com` 형태)을 주는 경우가 있습니다.

### ⚠️ 기존 홈페이지를 유지해야 한다면

**루트 도메인의 A 레코드를 바꾸면 현재 Cafe24 웹호스팅으로 서비스 중인 홈페이지가
그 주소에서 내려갑니다.** 기존 사이트를 그대로 두려면 `plan.` 같은 **서브도메인**을 쓰세요.
서브도메인 CNAME 추가는 루트 도메인에 영향을 주지 않습니다.

### 확인

DNS 반영에는 보통 10분~1시간이 걸립니다.
Vercel 의 Domains 화면에 **Valid Configuration** 이 뜨면 완료입니다.
HTTPS 인증서는 Vercel 이 자동으로 발급·갱신하므로 따로 할 일이 없습니다.

---

## 이후 운영

| 상황 | 동작 |
| --- | --- |
| `main` 에 push | 프로덕션 자동 재배포 |
| 다른 브랜치에 push | 미리보기 URL 을 따로 만들어 줌 |
| Pull Request 생성 | 그 PR 전용 미리보기 URL 생성 |
| 환경변수 변경 | **Redeploy 필요** (자동 반영 안 됨) |
| 되돌리기 | Deployments 목록에서 이전 배포 → **Promote to Production** |

---

## 요금

| 플랜 | 용도 |
| --- | --- |
| **Hobby** (무료) | 개인·학습·비상업 용도 |
| **Pro** (유료) | **상업적 서비스는 이쪽이어야 합니다** |

무료 플랜은 약관상 상업적 사용이 제한됩니다.
실제로 서비스를 운영할 계획이면 Pro 로 올리세요.

DeepSeek API 요금은 Vercel 과 별개로 DeepSeek 쪽에 청구됩니다.
앱의 크레딧 한도(`DAILY_CREDIT_LIMIT`)는 브라우저별 제한일 뿐 실제 과금을 막지 못하므로,
공개 서비스로 열 계획이면 DeepSeek 콘솔에서 사용량 상한을 걸어 두세요.

---

## 문제가 생기면

| 증상 | 원인 / 해결 |
| --- | --- |
| 빌드 실패 — `maxDuration` 오류 | Fluid compute 가 꺼져 있음 (4단계 참고) |
| 로고가 `UB` 로 나옴 | `public/logo.png` 가 커밋되지 않음 (1단계 참고) |
| `/api/status` 가 `local` | 환경변수 누락 또는 Redeploy 안 함 (3단계 참고) |
| 도메인이 안 붙음 | DNS 반영 대기 중이거나 레코드 값 오타. Vercel Domains 화면의 안내 문구 확인 |
| AI 생성이 계속 내장 생성기로 넘어감 | 화면에 표시되는 실패 사유 확인. 키 잔액·모델명 문제가 대부분입니다 |

저장소 안에서 실행하는 점검은 [6. 문제 해결](./06-troubleshooting.md) 을 보세요.
