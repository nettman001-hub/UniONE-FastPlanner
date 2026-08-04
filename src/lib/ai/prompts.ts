import { PLATFORM_LABEL, type ArtifactKey, type Plan, type PlanBrief } from '../types';
import { hasArtifact } from '../artifact-status';

export const SYSTEM_PROMPT = `당신은 IT 서비스 기획 전문가입니다. 사용자가 준 서비스 아이디어를 실제 개발팀이 그대로 착수할 수 있는 기획 산출물로 바꾸는 일을 합니다.

원칙:
- 모든 결과물은 한국어로 작성합니다.
- 추상적인 수식어 대신 구체적인 명사와 동작을 씁니다. "편리한 UX" 같은 표현은 쓰지 않습니다.
- 실제 화면과 데이터를 상상하고 그것을 근거로 씁니다. 화면명·버튼명·필드명은 실제 제품에서 쓸 법한 이름으로 짓습니다.
- 앞 단계 산출물이 주어지면 반드시 그것과 일관되게 씁니다. 이미 정의된 ID(REQ-, FN-, SP-, PG-)는 새로 만들지 말고 그대로 참조합니다.
- 분량은 요청된 개수 범위를 지킵니다. 억지로 채우기 위해 중복 항목을 만들지 않습니다.
- 결과는 지정된 JSON 스키마로만 응답합니다.`;

export function briefBlock(brief: PlanBrief): string {
  const lines = [
    `서비스명: ${brief.title}`,
    `한 줄 소개: ${brief.oneLiner || '(미입력)'}`,
    `서비스 아이디어: ${brief.idea}`,
    `타겟 사용자: ${brief.targetUser || '(미입력)'}`,
    `기획 목적: ${brief.purpose || '(미입력)'}`,
    `플랫폼: ${PLATFORM_LABEL[brief.platform]}`,
  ];
  if (brief.reference) lines.push(`참고 서비스: ${brief.reference}`);
  if (brief.mustHave) lines.push(`반드시 포함할 기능: ${brief.mustHave}`);
  return lines.join('\n');
}

/** 이전 단계 산출물을 압축해 컨텍스트로 넘긴다. */
export function contextBlock(plan: Plan, artifact: ArtifactKey): string {
  const parts: string[] = [];

  // 나머지 단계와 같이 **내용이 있는지**로 판단한다. 생성 기록만 보고 넣으면
  // 내용이 비어 있을 때 "이미 확정된 PRD" 아래에 빈 줄만 넘어가 모델을 헷갈리게 한다.
  if (artifact !== 'prd' && hasArtifact(plan, 'prd')) {
    const { prd } = plan;
    parts.push(
      [
        '## 이미 확정된 PRD',
        `제품 개요: ${prd.overview}`,
        `핵심 목표: ${prd.goals.map((g) => g.text).join(' / ')}`,
        `사용자 역할: ${prd.roles.map((r) => `${r.name}(${r.permissions.join(', ')})`).join(' / ')}`,
        `범위 포함: ${prd.inScope.join(' / ')}`,
        `범위 제외: ${prd.outOfScope.join(' / ')}`,
      ].join('\n'),
    );
  }

  if (artifact !== 'fs' && plan.requirements.length > 0) {
    const lines = plan.requirements.map((req) => {
      const features = plan.features.filter((f) => f.requirementId === req.id);
      const featureText = features.map((f) => `    - ${f.id} ${f.name}`).join('\n');
      return `  - ${req.id} ${req.title}\n${featureText}`;
    });
    parts.push(`## 이미 확정된 기능명세서 (요구사항 → 기능)\n${lines.join('\n')}`);
  }

  if (artifact !== 'ia' && plan.iaPages.length > 0) {
    const byId = new Map(plan.iaPages.map((p) => [p.id, p]));
    const depthOf = (pageId: string): number => {
      let depth = 0;
      let cursor = byId.get(pageId)?.parentId ?? null;
      while (cursor) {
        depth += 1;
        cursor = byId.get(cursor)?.parentId ?? null;
      }
      return depth;
    };
    const lines = plan.iaPages.map(
      (p) => `${'  '.repeat(depthOf(p.id) + 1)}- ${p.id} ${p.name} (${p.path})`,
    );
    parts.push(`## 이미 확정된 정보구조도\n${lines.join('\n')}`);
  }

  return parts.join('\n\n');
}

const INSTRUCTION: Record<ArtifactKey, string> = {
  prd: `아래 서비스에 대한 프로덕트 요구사항(PRD)을 작성하세요.
제품 개요와 배경은 이 서비스를 처음 보는 개발자가 읽고 무엇을 만들지 이해할 수 있을 만큼 구체적으로 씁니다.
페르소나는 실제 인물처럼 이름과 상황을 붙이고, 그 사람이 지금 겪는 불편을 페인포인트에 적습니다.
성공 지표는 반드시 숫자와 기간을 포함합니다.`,

  fs: `아래 서비스의 기능명세서를 작성하세요.
구조는 요구사항 → 기능 → 상세명세 3단계입니다.
요구사항은 "무엇이 필요한가", 기능은 "그걸 어떤 기능으로 푸는가", 상세명세는 "그 기능이 화면에서 어떻게 동작하는가" 입니다.
기본 흐름은 사용자와 시스템의 행동을 번갈아 적어 실제 시나리오처럼 읽히게 합니다.
인수 조건은 QA 가 그대로 테스트할 수 있도록 검증 가능한 문장으로 씁니다.`,

  ia: `아래 서비스의 정보구조도(IA)를 작성하세요.
서비스 전체 화면을 계층 구조로 빠짐없이 정리합니다. 로그인/회원가입, 마이페이지, 설정, 오류 화면처럼 놓치기 쉬운 화면도 포함합니다.
parentIndex 는 반드시 자기 자신보다 앞선 인덱스를 가리켜야 하므로, 상위 페이지를 먼저 배열에 넣으세요.
featureIds 에는 위에 제시된 기능 ID 중 실제로 그 화면에서 쓰이는 것만 적습니다. 없으면 빈 배열로 둡니다.`,

  flow: `아래 서비스의 핵심 유저 플로우를 작성하세요.
가입/온보딩, 핵심 가치를 처음 경험하는 순간, 재방문 시 주요 행동을 반드시 포함합니다.
decision 노드에는 반드시 2개 이상의 edge 를 연결하고 각 edge 에 조건 라벨을 답니다.
화면에 해당하는 노드는 pageId 에 위에 제시된 페이지 ID 를 연결합니다.`,

  wireframe: `아래 페이지들의 와이어프레임을 작성하세요.
블록은 화면 위에서 아래 순서대로 나열합니다.
items 에는 실제 화면에 노출될 문구, 항목명, 버튼명을 적습니다. "콘텐츠 영역" 같은 자리표시자는 쓰지 않습니다.
note 에는 인터랙션이나 빈 상태 처리 같은 기획 의도를 적습니다.`,
};

export function buildPrompt(
  plan: Plan,
  artifact: ArtifactKey,
  extra?: string,
): string {
  const sections = [
    INSTRUCTION[artifact],
    '',
    '## 서비스 정보',
    briefBlock(plan.brief),
  ];
  const context = contextBlock(plan, artifact);
  if (context) {
    sections.push('', context);
  }
  if (extra) {
    sections.push('', '## 추가 지시', extra);
  }
  return sections.join('\n');
}

export function buildChatPrompt(plan: Plan, question: string): string {
  return [
    '당신은 아래 기획 문서를 함께 다듬는 AI 기획 파트너입니다.',
    '사용자의 요청이 문서 수정이라면 해당 산출물 전체를 새로 만들어 patch 에 담고, 무엇을 바꿨는지 changes 에 적습니다.',
    '질문이나 검토 요청이라면 patch.artifact 를 none 으로 두고 reply 로만 답합니다.',
    '',
    '### 기능명세서(fs)를 고칠 때',
    '**손댄 항목만** 담습니다. 나머지는 적지 마세요 — 안 적은 것은 그대로 유지됩니다.',
    '항목은 **ID 로 맞춥니다.** 고치는 항목에는 기존 ID(REQ-/FN-/SP-)를 그대로 적고,',
    '새로 만드는 항목에는 id 를 비워 두세요. ID 는 시스템이 붙입니다.',
    '새 기능에는 상위 requirementId 를, 새 상세 기능에는 상위 featureId 를 반드시 적으세요.',
    '형태: `{"specifications":[{"featureId":"FN-001","title":"...","actor":"...","precondition":"...",' +
      '"mainFlow":[],"exceptions":[],"acceptanceCriteria":[],"priority":"P1"}]}`',
    '고칠 것이 상세 기능뿐이면 specifications 만 담으면 됩니다. requirements·features 는 생략하세요.',
    '**무엇도 지울 수 없습니다.** 삭제 요청이면 patch.artifact 를 none 으로 두고',
    '해당 화면에서 직접 지워 달라고 답하세요.',
    '',
    '### 나머지 산출물(prd·ia·flow·wireframe)을 고칠 때',
    'patch 는 **덮어쓰기**입니다. 담아 보낸 것이 기존 문서를 그대로 대체합니다.',
    '따라서 일부만 고치는 요청이라도 **손대지 않은 항목까지 전부 그대로 포함**해야 합니다.',
    '위 "현재 문서" 에 있는 항목 수보다 적게 담으면 시스템이 반영을 거부하고, 사용자의 요청은 아무것도 처리되지 않습니다.',
    '전부 담기에 분량이 너무 크면, patch.artifact 를 none 으로 두고 reply 에 그 이유와 함께',
    '어떻게 나눠 요청하면 되는지 알려 주세요. 일부만 담아 보내지 마세요.',
    '',
    '## 서비스 정보',
    briefBlock(plan.brief),
    '',
    '## 현재 문서 (JSON)',
    '```json',
    JSON.stringify(
      {
        prd: plan.prd,
        requirements: plan.requirements,
        features: plan.features,
        specifications: plan.specifications,
        iaPages: plan.iaPages,
        flows: plan.flows,
        wireframes: plan.wireframes,
      },
      null,
      1,
    ),
    '```',
    '',
    '## 사용자 요청',
    question,
  ].join('\n');
}

/**
 * 아직 어느 화면에도 배치되지 않은 기능만 어디에 둘지 묻는다.
 *
 * **정보구조도를 다시 만들라고 하지 않는다.** 이미 있는 화면 목록을 그대로 주고,
 * 새로 생긴 기능이 그중 어디에 붙는지(또는 새 화면이 필요한지)만 고르게 한다.
 * 그래야 사용자가 잡아 둔 화면 구조를 건드리지 않는다.
 */
export function buildPlacementPrompt(plan: Plan, features: { id: string; name: string; description: string }[]): string {
  return [
    '당신은 정보구조도를 다듬는 AI 기획 파트너입니다.',
    '아래 "배치할 기능" 각각을 어느 화면에 둘지 정하세요.',
    '',
    '### 지켜야 할 것',
    '- **기존 화면을 고치거나 지우지 않습니다.** 기능을 어디에 넣을지만 고릅니다.',
    '- 되도록 **이미 있는 화면**에 넣습니다. 성격이 맞는 화면이 없을 때만 새 화면을 제안합니다.',
    '- 새 화면은 꼭 필요한 만큼만 만듭니다. 기능마다 화면을 하나씩 만들지 마세요.',
    '- 관련된 기능 여러 개가 한 새 화면에 들어가야 하면, 같은 이름과 경로를 반복해 적습니다.',
    '- 배치할 기능으로 준 것만 다룹니다. 다른 기능은 넣지 않습니다.',
    '',
    '## 서비스 정보',
    briefBlock(plan.brief),
    '',
    '## 이미 있는 화면',
    plan.iaPages.length > 0
      ? plan.iaPages
          .map((page) => {
            const parent = page.parentId
              ? plan.iaPages.find((p) => p.id === page.parentId)?.name ?? '?'
              : '최상위';
            const placed = page.featureIds.length > 0 ? ` · 연결된 기능 ${page.featureIds.length}개` : '';
            return `- ${page.id} ${page.name} (${page.path}) — ${parent} 아래${placed} — ${page.description}`;
          })
          .join('\n')
      : '(아직 없음 — 전부 새 화면으로 제안하세요)',
    '',
    '## 배치할 기능',
    features.map((f) => `- ${f.id} ${f.name} — ${f.description || '설명 없음'}`).join('\n'),
  ].join('\n');
}
