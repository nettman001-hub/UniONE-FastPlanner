# 우리 디자인을 Claude Design 에 올리기

**한 번만 해 두면, Claude Design 에서 만드는 화면이 전부 UniBoard 의 결을 따릅니다.**

`src/lib/design/skills.ts` 에 디자인 스킬 여섯 벌이 있습니다. 지금은 스티치에 넘길
때만 씁니다. 이걸 Claude Design 쪽에도 **디자인 시스템 프로젝트**로 올려 두면,
거기서 화면을 만들 때마다 색·글꼴·모서리·간격이 저절로 맞습니다.

작업은 **여러분 PC 의 Claude Code** 에서 합니다. 클라우드 세션에서는 안 됩니다
(아래 [왜 서버에서 못 하나](#왜-서버에서-못-하나)).

---

## 미리 필요한 것

| | |
| --- | --- |
| Claude 요금제 | **Pro 이상.** Claude Design 은 유료 요금제에서만 열립니다 |
| Claude Code | 여러분 PC 에 설치된 것. 터미널에서 `claude` 가 실행돼야 합니다 |
| 이 저장소 | 로컬에 내려받은 것 (`git clone`) |

브라우저에서 <https://claude.ai/design> 이 열리는지 먼저 확인하세요. 안 열리면
요금제 문제입니다. 여기서 더 진행해도 소용없습니다.

---

## 1. 디자인 시스템 파일을 만듭니다

Claude Design 은 **파일**을 읽습니다. 우리 스킬은 타입스크립트 객체라 그대로는
못 넘깁니다. 스킬마다 미리보기 HTML 한 장씩으로 펼쳐야 합니다.

저장소를 연 Claude Code 에서 그대로 시키시면 됩니다.

```
src/lib/design/skills.ts 의 DESIGN_SKILLS 여섯 벌을 읽어서,
스킬마다 미리보기 HTML 한 장씩 ui_kits/uniboard/<key>.html 로 만들어 줘.

각 장에 담을 것:
  - 색 견본 (color, colorMode 반영)
  - 제목 글꼴(headlineFont) · 본문 글꼴(bodyFont) 견본
  - 버튼 (기본 / 보조 / 비활성), roundness 반영
  - 입력칸, 카드, 목록 한 줄
  - designMd 의 규칙을 주석이 아니라 실제 스타일로

첫 줄에 이 주석을 넣어 줘 — Claude Design 이 이걸로 카드를 만든다:
  <!-- @dsCard group="Components" -->

바깥에서 불러오는 것 없이 한 파일 안에서 끝나게 해 줘.
```

만들어진 파일을 브라우저로 한 번 열어 보세요. **여기서 이상하면 올려도 이상합니다.**

---

## 2. Claude Design 에 올립니다

같은 Claude Code 창에서:

```
/design-sync
```

처음 한 번은 로그인을 묻습니다(`/design-login`). 브라우저가 열리고, claude.ai
계정으로 승인하면 됩니다.

그다음 물어보는 것에 이렇게 답하시면 됩니다.

| 물음 | 답 |
| --- | --- |
| 어느 프로젝트에 넣을까 | **새로 만들기** → 이름은 `UniBoard 디자인 스킬` |
| 어느 파일을 올릴까 | `ui_kits/uniboard/**` |

올리기 전에 **정확히 어떤 경로에 무엇을 쓸지 목록으로 보여 줍니다.** 그때 확인하고
승인하세요. 승인 전에는 아무것도 안 올라갑니다.

---

## 3. 확인합니다

<https://claude.ai/design> 에서 방금 만든 프로젝트를 엽니다. `Design System` 칸에
스킬 여섯 장이 카드로 보이면 된 것입니다.

이제 새 디자인 프로젝트를 만들 때 이 디자인 시스템을 붙이면, 거기서 만드는 화면이
우리 결을 따릅니다. UniBoard 에서 뽑은 화면별 요청문(`디자인 도구로 넘기기` →
`Claude Design`)을 그대로 붙여 넣으시면 됩니다.

---

## 스킬을 고쳤을 때

`skills.ts` 를 고치면 올려 둔 것은 **자동으로 안 바뀝니다.** 1번을 다시 돌려
파일을 새로 만들고, `/design-sync` 를 다시 하세요. 이번에는 새 프로젝트가 아니라
**아까 만든 프로젝트**를 고르시면 바뀐 파일만 갈아 끼웁니다.

---

## 왜 서버에서 못 하나

`api.anthropic.com/v1/design/mcp` 는 열려 있습니다. 직접 두드려 보면 이렇게 답합니다.

```
POST https://api.anthropic.com/v1/design/mcp
→ 401
   www-authenticate: Bearer scope="user:design:read user:design:write"
```

두 가지가 막습니다.

**개발자 키를 안 받습니다.** `x-api-key` 로 Anthropic API 키를 넣어도 401 입니다.
토큰을 내주는 곳이 `claude.ai` 라, **사람이 브라우저로 로그인해야** 나옵니다.
그 로그인 화면이 봇 검사 뒤에 있어서 헤드리스로는 못 지나갑니다.

**그 창구로 오가는 것은 디자인 시스템 파일입니다.** `list_files`·`get_file`·
`write_files` 같은 것들입니다. 스티치의 `generate_screen_from_text` 처럼 "이 문장으로
화면 하나 만들어 줘" 는 없습니다. 화면을 만드는 일은 저쪽 웹 화면 안에서만 됩니다.

그래서 UniBoard 는 Claude Design 을 **스티치 자리가 아니라 v0·Figma 자리**에
붙였습니다 — 요청문을 넘기는 도구로요.

> 토큰이 없어 공식 창구의 전체 도구 목록까지는 확인하지 못했습니다. 401 과 메타데이터는
> 직접 확인한 사실이고, "화면 생성은 없다" 는 노출된 도구 표면에서 나온 추정입니다.
> 저쪽이 생성 창구를 열면 스티치와 같은 방식으로 붙일 수 있습니다.

---

## 막힐 때

| 증상 | 원인 |
| --- | --- |
| `/design-sync` 가 없다고 나온다 | Claude Code 가 오래된 판입니다. 최신으로 올리세요 |
| `design-login requires an interactive terminal` | 클라우드 세션에서 돌리셨습니다. 여러분 PC 의 터미널에서 하세요 |
| 로그인은 됐는데 프로젝트가 안 보인다 | 요금제가 Pro 미만이거나, 다른 계정으로 로그인하셨습니다 |
| 올렸는데 카드가 안 보인다 | HTML 첫 줄의 `<!-- @dsCard ... -->` 주석이 빠졌습니다 |
