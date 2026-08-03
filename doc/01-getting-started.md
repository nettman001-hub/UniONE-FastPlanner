# 1. 설치와 실행

## 필요한 것

| 항목 | 요구 사항 |
| --- | --- |
| Node.js | 20 이상 (22 권장) |
| Git | 저장소를 내려받는 데 필요 |
| API 키 | 선택 — 없어도 모든 기능이 동작합니다 |

Node 버전은 `node --version` 으로 확인합니다. 없다면 [nodejs.org](https://nodejs.org) 에서
LTS 버전을 설치하세요.

## 내려받기

```bash
git clone -b claude/manyfast-plan-app-d9q2c7 https://github.com/nettman001-hub/UniONE-FastPlanner.git
cd UniONE-FastPlanner
npm install
```

`-b` 로 브랜치를 지정하는 것이 중요합니다. 아직 `main` 에 병합되기 전이라,
브랜치를 지정하지 않으면 빈 저장소를 받게 됩니다.

## 환경변수

```bash
cp .env.example .env.local
```

Windows PowerShell 이라면 `Copy-Item .env.example .env.local` 입니다.

`.env.local` 을 열어 키를 넣습니다.

```ini
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-여기에_키
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_MAX_TOKENS=8192
```

**키를 넣지 않아도 앱은 완전히 동작합니다.** 이 경우 내장 생성기(규칙 기반)가 산출물을
만듭니다. 자세한 내용은 [3. AI 공급자와 크레딧](./03-ai-providers.md) 을 보세요.

> `.env.local` 은 `.gitignore` 에 걸려 있어 저장소에 올라가지 않습니다.
> 키를 커밋하지 않도록 이 파일에만 넣으세요.

## 연결 점검

앱을 띄우기 전에 키·모델명·잔액·네트워크를 한 번에 확인합니다.

```bash
npm run check:ai
```

정상이면 이렇게 나옵니다.

```
── AI 공급자 점검 ──────────────────────────────
AI_PROVIDER   : deepseek
선택된 공급자 : deepseek
Base URL      : https://api.deepseek.com
모델          : deepseek-v4-pro
출력 상한     : 8192 토큰
API 키        : sk-009…3785 (35자)

▶ 엔드포인트 연결 및 모델 목록 … ok — 사용 가능 모델 3개
▶ JSON 모드 생성 (response_format) … ok — 토큰 82→24
▶ 잔액 조회 … ok — 9.7 CNY

모두 통과했습니다.
```

실패하면 무엇이 문제인지 짚어 줍니다. 모델명이 틀렸다면 사용 가능한 모델 목록을
함께 출력하므로 그중 하나로 `DEEPSEEK_MODEL` 을 바꾸면 됩니다.

## 실행

### 개발 모드

```bash
npm run dev
```

http://localhost:3000 에서 열립니다. 코드를 고치면 자동으로 새로고침됩니다.
화면 좌측 하단에 검은 원형 마크가 보이는데, 이는 Next.js 개발 도구입니다.
자세한 설명은 [6. 문제 해결 → 좌측 하단 마크](./06-troubleshooting.md#좌측-하단-검은-원형-마크는-무엇인가요) 를 보세요.

### 프로덕션 모드

```bash
npm run build
npm run start
```

실제 배포와 같은 조건으로 동작합니다. 개발 도구 마크도 나타나지 않습니다.

> **서버를 켜 둔 채로 `npm run build` 를 다시 돌리지 마세요.**
> 브라우저가 이전 빌드의 파일을 찾다가 `Application error` 가 납니다.
> 빌드 후에는 반드시 서버를 재시작하세요.

## 로고 넣기

`public/logo.png` 에 이미지를 두면 헤더, 홈 제목, 브라우저 탭 아이콘에 쓰입니다.
정사각형 이미지를 권장합니다.

```bash
# 예: 프로젝트 루트에 있던 logo.png 를 옮기기
mv logo.png public/logo.png     # PowerShell: Move-Item logo.png public\logo.png
```

파일이 없으면 `UF` 이니셜 마크로 대체되므로 화면이 깨지지 않습니다.

> 파일 유무는 **빌드 시점에 판단**합니다. 로고를 새로 넣거나 지웠다면
> 개발 서버를 재시작(프로덕션은 `npm run build` 후 재시작)해야 반영됩니다.

## 첫 플랜 만들기

1. 홈에서 **[＋ 기획하기]** 를 누릅니다.
2. **1단계 — 무엇을 만드나요**
   - 서비스명 *(필수)*: 예) `산책메이트`
   - 한 줄 소개: 예) `동네 반려견 산책 친구를 찾아주는 앱`
   - 서비스 아이디어 *(필수)*: 자세할수록 결과가 좋아집니다.
     아래 예시 칩을 눌러 채울 수도 있습니다.
3. **2단계 — 누구를 위한 건가요**
   - 타겟 사용자, 기획 목적, 플랫폼(웹 / 모바일 앱 / 웹＋앱 / 어드민)
   - 비워 두면 AI 가 아이디어를 보고 추정합니다.
4. **3단계 — 참고 정보(선택)**
   - 참고 서비스, 반드시 포함할 기능
   - `만들면서 PRD도 바로 생성하기` 를 켜 두면 플랜 생성 직후 PRD 가 자동으로 만들어집니다.
5. **[플랜 만들기]** → 개요 화면으로 이동합니다.
6. 개요에서 **[전체 자동 생성]** 을 누르면 PRD 부터 와이어프레임까지 순서대로 만들어집니다.

## 다음 단계

- 각 화면을 어떻게 쓰는지 → [2. 화면별 사용법](./02-screens.md)
- 문서를 밖으로 가져가려면 → [4. 내보내기와 공유](./04-export-and-share.md)
