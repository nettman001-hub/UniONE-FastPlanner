# 개발·운영 문서

**이 폴더는 UniBoard 를 직접 설치·배포·운영하는 사람을 위한 것입니다.**
서비스를 쓰는 고객용 설명서는 [`doc/`](../README.md) 에 따로 있고, 앱의 `/docs` 화면에
나오는 것도 그쪽입니다.

| # | 문서 | 내용 |
| --- | --- | --- |
| 1 | [설치와 실행](./01-setup.md) | 내려받기, 환경변수, 로컬 실행 |
| 2 | [구조와 데이터 모델](./02-architecture.md) | 폴더 구조, 도메인 모델, 저장·동기화 설계, 확장 방법 |
| 3 | [배포](./03-deploy.md) | Vercel 배포, 환경변수, Supabase 연결, 도메인, 요금 |
| 4 | [AI 공급자 설정](./04-ai-providers.md) | DeepSeek·Anthropic·내장 생성기, 환경변수 |
| 5 | [문제 해결](./05-troubleshooting.md) | 개발·운영 중 겪는 오류 |
| 6 | [계정과 데이터베이스 운영](./06-accounts.md) | 가입 정책, 스키마, 보안 |
| 7 | [Claude Design 에 디자인 올리기](./07-claude-design.md) | 우리 디자인 스킬을 Claude Design 디자인 시스템으로 |

## 문서를 고칠 때

앱의 `/docs` 화면은 **`doc/` 바로 아래의 마크다운을 빌드 시점에 읽어** 정적으로 만듭니다.
목차는 [`doc/manifest.json`](../manifest.json) 이 정합니다.

- **고객용 문서를 추가하면** `manifest.json` 에도 한 줄 넣어야 화면에 나옵니다.
- **이 폴더(`dev/`)의 문서는 `manifest.json` 에 넣지 마세요.** 고객이 볼 내용이 아닙니다.
  저장소에서 읽는 용도입니다.
