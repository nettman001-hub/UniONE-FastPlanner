/**
 * AI 생성 결과의 JSON 스키마.
 *
 * 모델이 ID 를 직접 만들지 않도록 상위 항목은 인덱스로 참조하게 하고,
 * 실제 ID(REQ-001 …)는 서버에서 규칙에 따라 부여한다.
 */

import type { ArtifactKey } from '../types';

const str = (description: string) => ({ type: 'string', description });
const strArray = (description: string) => ({
  type: 'array',
  description,
  items: { type: 'string' },
});

const PRIORITY = {
  type: 'string',
  enum: ['P0', 'P1', 'P2', 'P3'],
  description: 'P0=필수, P1=높음, P2=보통, P3=낮음',
};

function object<T extends Record<string, unknown>>(properties: T, description?: string) {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export const PRD_SCHEMA = object({
  overview: str('제품 개요. 이 서비스가 무엇인지 3~5문장으로 서술한다.'),
  background: str('배경 및 문제 정의. 어떤 문제를 왜 지금 푸는지 3~5문장.'),
  goals: {
    type: 'array',
    description: '핵심 목표 3~5개',
    items: object({
      text: str('목표 문장'),
      metric: str('목표 달성을 판단할 지표'),
    }),
  },
  personas: {
    type: 'array',
    description: '타겟 유저 페르소나 2~3개',
    items: object({
      name: str('페르소나 이름 (예: 바쁜 1인 창업자 김대표)'),
      summary: str('한 줄 소개'),
      needs: strArray('니즈 2~4개'),
      painPoints: strArray('페인포인트 2~4개'),
    }),
  },
  roles: {
    type: 'array',
    description: '사용자 역할 2~4개 (비회원/일반회원/관리자 등)',
    items: object({
      name: str('역할명'),
      description: str('역할 설명'),
      permissions: strArray('권한 2~5개'),
    }),
  },
  environment: object(
    {
      platforms: strArray('지원 플랫폼 (예: 반응형 웹, iOS, Android)'),
      devices: strArray('지원 기기'),
      browsers: strArray('지원 브라우저 또는 OS 버전'),
    },
    '사용 환경',
  ),
  coreValues: strArray('핵심 가치 3~5개'),
  successMetrics: {
    type: 'array',
    description: '성공 지표 3~5개',
    items: object({
      name: str('지표명'),
      target: str('목표 수치 (예: 출시 3개월 내 MAU 5,000)'),
    }),
  },
  inScope: strArray('이번 범위에 포함되는 항목 4~7개'),
  outOfScope: strArray('이번 범위에서 제외하는 항목 3~5개'),
  constraints: strArray('제약사항 3~5개'),
});

export const FS_SCHEMA = object({
  requirements: {
    type: 'array',
    description: '요구사항 5~8개. 기능의 상위 묶음이다.',
    items: object({
      title: str('요구사항명'),
      description: str('요구사항 설명 1~2문장'),
      category: str('분류 (예: 회원, 콘텐츠, 결제, 관리자)'),
      priority: PRIORITY,
    }),
  },
  features: {
    type: 'array',
    description: '기능. 요구사항마다 2~4개씩 만든다.',
    items: object({
      requirementIndex: {
        type: 'integer',
        description: 'requirements 배열에서 상위 요구사항의 0-based 인덱스',
      },
      name: str('기능명'),
      description: str('기능 설명 1~2문장'),
      priority: PRIORITY,
    }),
  },
  specifications: {
    type: 'array',
    description: '상세 명세. 핵심 기능마다 1~2개씩 만든다.',
    items: object({
      featureIndex: {
        type: 'integer',
        description: 'features 배열에서 상위 기능의 0-based 인덱스',
      },
      title: str('상세 명세명'),
      actor: str('수행 주체 (예: 일반 회원)'),
      precondition: str('사전 조건'),
      mainFlow: strArray('기본 흐름 3~6단계. 각 항목은 한 단계.'),
      exceptions: strArray('예외 처리 2~4개'),
      acceptanceCriteria: strArray('인수 조건 2~4개'),
      priority: PRIORITY,
    }),
  },
});

export const IA_SCHEMA = object({
  pages: {
    type: 'array',
    description:
      '정보구조도의 페이지. 1 depth 부터 최대 3 depth 까지 계층으로 만들며 12~24개가 적당하다.',
    items: object({
      name: str('페이지명'),
      path: str('경로 (예: /products/:id)'),
      description: str('페이지 설명 한 문장'),
      type: {
        type: 'string',
        enum: ['page', 'modal', 'tab', 'section'],
        description: '화면 종류',
      },
      parentIndex: {
        type: 'integer',
        description: '상위 페이지의 0-based 인덱스. 1 depth 는 -1. 반드시 자기 인덱스보다 작아야 한다.',
      },
      roles: strArray('접근 가능한 역할명'),
      featureIds: strArray('연결되는 기능 ID (FN-001 형식). 없으면 빈 배열.'),
    }),
  },
});

export const FLOW_SCHEMA = object({
  flows: {
    type: 'array',
    description: '핵심 유저 플로우 3~5개',
    items: object({
      name: str('플로우명 (예: 회원가입 및 온보딩)'),
      description: str('플로우 설명 한 문장'),
      actor: str('수행 역할'),
      nodes: {
        type: 'array',
        description: '플로우 노드 5~10개. 반드시 start 로 시작해 end 로 끝난다.',
        items: object({
          key: str('플로우 안에서 유일한 짧은 키 (예: n1)'),
          type: {
            type: 'string',
            enum: ['start', 'screen', 'action', 'decision', 'system', 'end'],
            description: '노드 종류',
          },
          label: str('노드 라벨'),
          description: str('부연 설명. 없으면 빈 문자열.'),
          pageId: str('연결되는 IA 페이지 ID (PG-001 형식). 없으면 빈 문자열.'),
        }),
      },
      edges: {
        type: 'array',
        description: '노드 연결. decision 노드는 2개 이상의 경로를 가진다.',
        items: object({
          from: str('출발 노드 key'),
          to: str('도착 노드 key'),
          label: str('분기 조건. 없으면 빈 문자열.'),
        }),
      },
    }),
  },
});

export const WIREFRAME_SCHEMA = object({
  wireframes: {
    type: 'array',
    description: '주요 화면의 와이어프레임. 요청받은 페이지마다 하나씩 만든다.',
    items: object({
      pageId: str('대상 IA 페이지 ID (PG-001 형식)'),
      name: str('화면명'),
      device: {
        type: 'string',
        enum: ['mobile', 'desktop'],
        description: '기준 기기',
      },
      blocks: {
        type: 'array',
        description: '화면을 위에서 아래로 구성하는 블록 4~8개',
        items: object({
          type: {
            type: 'string',
            enum: [
              'header',
              'nav',
              'hero',
              'search',
              'filter',
              'list',
              'card-grid',
              'table',
              'form',
              'detail',
              'tabs',
              'text',
              'image',
              'chart',
              'banner',
              'cta',
              'footer',
            ],
            description: '블록 종류',
          },
          title: str('블록 제목'),
          items: strArray('블록 안에 들어가는 항목 2~6개'),
          note: str('기획 메모. 없으면 빈 문자열.'),
        }),
      },
    }),
  },
});

export const ARTIFACT_SCHEMA: Record<ArtifactKey, ReturnType<typeof object>> = {
  prd: PRD_SCHEMA,
  fs: FS_SCHEMA,
  ia: IA_SCHEMA,
  flow: FLOW_SCHEMA,
  wireframe: WIREFRAME_SCHEMA,
};

/* ------------------------------------------------------------------ */
/* AI 에이전트 채팅 응답                                                 */
/* ------------------------------------------------------------------ */

export const CHAT_SCHEMA = object({
  reply: str('사용자에게 보여줄 답변. 한국어 2~5문장.'),
  changes: strArray(
    '실제로 문서를 수정했다면 변경 내용을 한 줄씩 적는다. 수정하지 않았다면 빈 배열.',
  ),
  patch: object(
    {
      artifact: {
        type: 'string',
        enum: ['none', 'prd', 'fs', 'ia', 'flow', 'wireframe'],
        description: '수정한 산출물. 수정하지 않았다면 none.',
      },
      payload: str(
        '수정 결과를 해당 산출물 스키마와 동일한 형태의 JSON 문자열로 담는다. none 이면 빈 문자열.',
      ),
    },
    '문서 변경 사항',
  ),
});

/* AI 생성 결과 타입 ------------------------------------------------- */

export interface PrdDraft {
  overview: string;
  background: string;
  goals: { text: string; metric: string }[];
  personas: { name: string; summary: string; needs: string[]; painPoints: string[] }[];
  roles: { name: string; description: string; permissions: string[] }[];
  environment: { platforms: string[]; devices: string[]; browsers: string[] };
  coreValues: string[];
  successMetrics: { name: string; target: string }[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
}

export interface FsDraft {
  requirements: { title: string; description: string; category: string; priority: string }[];
  features: {
    requirementIndex: number;
    name: string;
    description: string;
    priority: string;
  }[];
  specifications: {
    featureIndex: number;
    title: string;
    actor: string;
    precondition: string;
    mainFlow: string[];
    exceptions: string[];
    acceptanceCriteria: string[];
    priority: string;
  }[];
}

export interface IaDraft {
  pages: {
    name: string;
    path: string;
    description: string;
    type: string;
    parentIndex: number;
    roles: string[];
    featureIds: string[];
  }[];
}

export interface FlowDraft {
  flows: {
    name: string;
    description: string;
    actor: string;
    nodes: { key: string; type: string; label: string; description: string; pageId: string }[];
    edges: { from: string; to: string; label: string }[];
  }[];
}

export interface WireframeDraft {
  wireframes: {
    pageId: string;
    name: string;
    device: string;
    blocks: { type: string; title: string; items: string[]; note: string }[];
  }[];
}

export interface ArtifactDraftMap {
  prd: PrdDraft;
  fs: FsDraft;
  ia: IaDraft;
  flow: FlowDraft;
  wireframe: WireframeDraft;
}
