/**
 * qa-prompt — buildUinAiPrompt 조립 검사.
 * 실행: npx tsx scripts/qa/qa-prompt.ts
 *
 * fixture 는 검증 대상 함수가 실제로 읽는 필드만 채운 최소 플랜이며,
 * 전체 Plan 타입 검증은 이 스크립트의 목적이 아니므로 한 번만 단언한다.
 */

import { buildUinAiPrompt } from '@/lib/design/uinai-prompt';
import type { Plan } from '@/lib/types';

let failures = 0;

function ok(name: string, pass: boolean, detail = ''): void {
  const mark = pass ? 'ok' : 'FAIL';
  if (!pass) failures += 1;
  console.log(`${mark}  ${name}${pass || !detail ? '' : ` — ${detail}`}`);
}

const fixture = {
  id: 'plan-test',
  brief: {
    title: '산책메이트',
    oneLiner: '동네 반려견 산책 친구를 찾아주는 앱',
    idea: '반려견 산책 친구를 조건으로 매칭한다',
    targetUser: '반려인',
    purpose: '',
    platform: 'app',
  },
  prd: {
    overview: '테스트 제품 개요',
    background: '',
    goals: [],
    personas: [],
    roles: [{ id: 'r1', name: '일반 사용자' }],
    environment: {},
    coreValues: ['즐거움', '안전'],
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
    {
      id: 'PG-002',
      parentId: null,
      name: '매칭',
      path: '/match',
      description: '친구 매칭 화면',
      type: 'page',
      roles: ['일반 사용자'],
      featureIds: ['FN-001'],
      order: 2,
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
} as unknown as Plan;

const page = fixture.iaPages.find((item) => item.id === 'PG-001')!;

// happy — clean 스킬
const prompt = buildUinAiPrompt(fixture, page, 'strict', 'clean');
const tokenVars = (prompt.match(/--c-[\w-]+:/g) ?? []).length;
ok(`토큰 블록: --c- 변수 10개 이상 (실제 ${tokenVars})`, tokenVars >= 10);
ok('토큰 블록에 변수명 포함', prompt.includes('--c-primary:'));
ok('퓨샷 포함', prompt.includes('.btn-primary'));
ok('스킬 designMd 포함', prompt.includes('주 색은 강조에만'));
ok('screenPrompt 블록 포함', prompt.includes('표시할 내용'));
ok('화면 이름 포함', prompt.includes('홈'));
ok('대화형 도구용 방향 문장 부재', !prompt.includes('색·글꼴·간격·버튼 모양을 정해 주세요'));
ok('글자 지침 상향 문구 포함', prompt.includes('css ≤ 20,000자'));
ok(
  `전체 길이 40,000자 이내 (실제 ${prompt.length})`,
  prompt.length <= 40000,
);
ok('서비스 배경 포함', prompt.includes('산책메이트'));
ok('strict 강조 문장 포함', prompt.includes('위 순서와 문구를 그대로 지켜 주세요'));

// failure — none: designMd 미포함 + 중립 토큰
const nonePrompt = buildUinAiPrompt(fixture, page, 'balanced', 'none');
ok("[none] designMd 미포함", !nonePrompt.includes('주 색은 강조에만'));
ok('[none] 중립 토큰 포함', nonePrompt.includes('--c-primary:#4b5563'));
ok('[none] 예외 없이 조립됨', nonePrompt.length > 0);

// failure — 미지 스킬: 중립으로 안전 폴백
const bogusPrompt = buildUinAiPrompt(fixture, page, 'free', 'bogus');
ok('[bogus] 중립 토큰으로 폴백', bogusPrompt.includes('--c-primary:#4b5563'));
ok('[bogus] designMd 미포함', !bogusPrompt.includes('주 색은 강조에만'));

console.log(failures === 0 ? '\n모두 통과했습니다.' : `\n${failures}건 실패.`);
process.exitCode = failures === 0 ? 0 : 1;
