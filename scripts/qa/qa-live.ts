/**
 * qa-live — UniAI 실측 스모크.
 * 실행: npx tsx scripts/qa/qa-live.ts [BASE_URL]
 *
 * - .env.local 에 DEEPSEEK_API_KEY 가 없으면 SKIP(실패 아님) — 로컬에 키가
 *   없는 환경이 기본이다(scripts/check-ai.mjs 와 같은 규칙).
 * - 키가 있으면 dev 서버(BASE_URL, 기본 http://localhost:3000)에 실제로
 *   화면 1건(고급, clean 스킬)을 만들어 저장 CSS 의 토큰 반영을 측정한다.
 * - 운영(프로덕션) 주소로는 실행하지 않는다.
 */

import { existsSync, readFileSync } from 'node:fs';

interface EnvFile {
  [key: string]: string;
}

function readEnvLocal(): EnvFile {
  const path = new URL('../../.env.local', import.meta.url);
  if (!existsSync(path)) return {};
  const env: EnvFile = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const base = process.argv[2] ?? 'http://localhost:3000';
const env = readEnvLocal();

if (!env.DEEPSEEK_API_KEY) {
  console.log('SKIP (키 없음) — .env.local 에 DEEPSEEK_API_KEY 가 없어 실측을 건너뜁니다.');
  process.exit(0);
}

const fixture = {
  id: 'qa-live-plan',
  brief: {
    title: '산책메이트',
    oneLiner: '동네 반려견 산책 친구를 찾아주는 앱',
    idea: '반려견 산책 친구를 조건으로 매칭한다',
    targetUser: '반려인',
    purpose: '',
    platform: 'app',
  },
  prd: {
    overview: 'QA 실측용 제품 개요',
    background: '',
    goals: [],
    personas: [],
    roles: [{ id: 'r1', name: '일반 사용자' }],
    environment: {},
    coreValues: ['즐거움'],
    successMetrics: [],
    inScope: [],
    outOfScope: [],
    constraints: [],
  },
  requirements: [],
  features: [
    {
      id: 'FN-001',
      requirementId: 'REQ-001',
      name: '산책 친구 찾기',
      description: '조건에 맞는 친구를 보여 줍니다',
      priority: 'P0',
      status: 'todo',
      order: 1,
    },
  ],
  specifications: [],
  iaPages: [
    {
      id: 'PG-001',
      parentId: null,
      name: '홈',
      path: '/',
      description: '첫 화면',
      type: 'page',
      roles: ['일반 사용자'],
      featureIds: ['FN-001'],
      order: 1,
    },
  ],
  flows: [],
  wireframes: [
    {
      id: 'WF-001',
      pageId: 'PG-001',
      name: '홈',
      device: 'mobile',
      blocks: [
        { id: 'b1', type: 'header', title: '홈 헤더', items: ['산책메이트'] },
        { id: 'b2', type: 'card-grid', title: '추천 친구', items: ['뽀삐네', '콩이네'] },
      ],
      order: 1,
    },
  ],
  generated: {},
  chat: [],
  comments: [],
  versions: [],
  createdAt: '2026-08-22T00:00:00Z',
  updatedAt: '2026-08-22T00:00:00Z',
};

async function main(): Promise<void> {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${base}/api/design/uinai/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: fixture,
      pageId: 'PG-001',
      requestId,
      engine: 'advanced',
      emphasis: 'strict',
      skill: 'clean',
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    screen?: { files?: Array<{ language?: string; content?: string }>; engine?: string };
    error?: string;
    code?: string;
  };
  if (!response.ok || !data.screen) {
    console.error(`FAIL — HTTP ${response.status}: ${data.error ?? '결과 없음'} (${data.code ?? '-'})`);
    process.exit(1);
  }
  const css = data.screen.files?.find((file) => file.language === 'css')?.content ?? '';
  const startsWithRoot = css.startsWith('*,*::before') && css.includes(':root {');
  const varUses = (css.match(/var\(--/g) ?? []).length;
  const hardcodedColors = (css.match(/#[0-9a-fA-F]{3,6}\b|rgb\(/g) ?? []).length;
  const engine = data.screen.engine;

  console.log(`화면 생성 완료 — 엔진: ${engine}`);
  console.log(`저장 CSS 시작: ${startsWithRoot ? '리셋+토큰 블록' : '일반 CSS (FAIL)'}`);
  console.log(`var(--) 사용: ${varUses}`);
  console.log(`하드코딩 색: ${hardcodedColors}`);

  const pass = startsWithRoot && varUses >= hardcodedColors;
  console.log(pass ? '\n실측 통과 — 토큰 우위 확인.' : '\n실측 실패 — 토큰 우위 미달.');
  process.exit(pass ? 0 : 1);
}

void main().catch((error) => {
  console.error('FAIL —', error instanceof Error ? error.message : error);
  process.exit(1);
});
