'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nextId, uid } from './ids';
import { normalizeUinAiScreens } from './design/uinai';
import type { ActiveRun, InterruptedRun } from './jobs/progress';
import {
  approveIn,
  isPending,
  rejectIn,
  removeFeatureFrom,
  removeRequirementFrom,
  removeSpecificationFrom,
  stripReview,
  type ReviewTarget,
} from './fs-review';
import {
  emptyDocuments,
  pickDocuments,
  type ArtifactKey,
  type ChatMessage,
  type CommentTarget,
  type Feature,
  type IaPage,
  type Plan,
  type PlanBrief,
  type PlanDocuments,
  type Prd,
  type Requirement,
  type Specification,
  type UserFlow,
  type UinAiScreen,
  type Wireframe,
} from './types';

/**
 * 브라우저 저장소 키.
 *
 * **서비스명이 UniBoard 로 바뀌어도 이 값은 그대로 둔다.** 사용자 브라우저에는
 * 이미 이 이름으로 플랜이 들어 있어서, 키를 바꾸면 앱이 그것을 찾지 못한다 —
 * 화면에서는 만들어 둔 플랜이 전부 사라진 것으로 보인다.
 *
 * 굳이 정리하고 싶다면 옛 키를 읽어 새 키로 옮기는 이사 코드를 먼저 넣어야 한다.
 */
const STORAGE_KEY = 'unione-fastplaner:v1';

/**
 * 크레딧은 **여기 없다.**
 *
 * 예전에는 잔량을 이 저장소에 두고 브라우저가 셌다. 개발자도구로 고칠 수 있었고,
 * 에이전트·기능 배치는 서버에서 아예 세지 않아 사실상 무제한이었다.
 * 지금은 서버가 유일한 근거다 — `lib/credits.ts`, `lib/useCredits.ts`.
 *
 * 저장소 판을 3 으로 올려, 브라우저에 남아 있던 옛 잔량을 버린다.
 */
const CREDIT_POLICY_VERSION = 3;

export interface PlannerState {
  plans: Plan[];
  hydrated: boolean;

  /**
   * 지금 브라우저에 있는 플랜이 **누구 것인가**.
   *
   * 로그인 전에 만든 것이면 null. 계정으로 들어오면 그 사용자 ID 가 박힌다.
   * 이 값이 없으면 한 컴퓨터를 여러 명이 쓸 때 앞사람의 플랜이 뒷사람 계정으로
   * 딸려 올라간다 — 실제로 일어나는 사고라 반드시 기록해 둔다.
   */
  owner: string | null;

  /**
   * 지금 도는 생성.
   *
   * 화면 컴포넌트가 아니라 스토어에 두어야 사이드바로 다른 메뉴에 넘어가도
   * 같은 진행 표시를 본다. **저장하지 않는다** — 페이지가 사라지면 그 생성도 끝난다.
   */
  activeRun: ActiveRun | null;

  /**
   * 다 만들지 못하고 끊긴 전체 자동 생성.
   *
   * **이건 저장한다.** 창을 닫았다 돌아와도 남은 단계부터 이어 갈 수 있어야 하기 때문이다.
   * 시작할 때 적어 두고 단계마다 갱신하므로, 탭이 갑자기 사라져도 기록이 남는다.
   */
  interrupted: InterruptedRun | null;

  /**
   * AI 에이전트 패널이 열려 있는가.
   *
   * **저장한다.** 화면 컴포넌트가 아니라 여기에 두어야 메뉴를 옮겨도, 새로고침해도
   * 열린 채로 남는다. 대화를 시켜 놓고 다른 문서를 보러 가는 것이 정상적인 사용
   * 방식이므로, 그때 패널이 닫히면 진행 상황을 볼 방법이 사라진다.
   */
  agentOpen: boolean;

  /**
   * 지금 에이전트 답변을 기다리는 플랜.
   *
   * **저장하지 않는다** — 창이 사라지면 그 요청도 함께 끝나므로, 남겨 두면
   * 영원히 "생각하는 중" 인 화면이 된다. 대신 답을 못 받은 대화는 화면에서
   * 다시 보낼 수 있게 한다.
   */
  agentBusy: string | null;

  /* 플랜 */
  /** 서버에서 받아 온 목록으로 통째로 바꾼다. 동기화가 쓴다. */
  setPlans: (plans: Plan[], owner: string | null) => void;
  createPlan: (brief: PlanBrief) => string;
  importPlan: (plan: Plan) => string;
  deletePlan: (planId: string) => void;
  renamePlan: (planId: string, title: string) => void;
  getPlan: (planId: string) => Plan | undefined;

  /* 산출물 일괄 반영 */
  applyDocuments: (planId: string, patch: Partial<PlanDocuments>, generated?: ArtifactKey[]) => void;

  /* 생성 진행 */
  setActiveRun: (run: ActiveRun | null) => void;
  setInterrupted: (run: InterruptedRun | null) => void;

  /* AI 에이전트 패널 */
  setAgentOpen: (open: boolean) => void;
  setAgentBusy: (planId: string | null) => void;

  /* PRD */
  updatePrd: (planId: string, patch: Partial<Prd>) => void;

  /* 기능명세서 */
  addRequirement: (planId: string, value?: Partial<Requirement>) => string;
  updateRequirement: (planId: string, id: string, patch: Partial<Requirement>) => void;
  removeRequirement: (planId: string, id: string) => void;
  addFeature: (planId: string, requirementId: string, value?: Partial<Feature>) => string;
  updateFeature: (planId: string, id: string, patch: Partial<Feature>) => void;
  removeFeature: (planId: string, id: string) => void;
  addSpecification: (planId: string, featureId: string, value?: Partial<Specification>) => string;
  updateSpecification: (planId: string, id: string, patch: Partial<Specification>) => void;
  removeSpecification: (planId: string, id: string) => void;

  /* 기능명세서 — AI 제안 검토 */
  approveReview: (planId: string, target: ReviewTarget) => void;
  rejectReview: (planId: string, target: ReviewTarget) => void;
  approveAllReview: (planId: string) => void;
  rejectAllReview: (planId: string) => void;

  /* 정보구조도 */
  addIaPage: (planId: string, parentId: string | null, value?: Partial<IaPage>) => string;
  updateIaPage: (planId: string, id: string, patch: Partial<IaPage>) => void;
  removeIaPage: (planId: string, id: string) => void;
  moveIaPage: (planId: string, id: string, direction: -1 | 1) => void;

  /* 유저 플로우 */
  addFlow: (planId: string, value?: Partial<UserFlow>) => string;
  updateFlow: (planId: string, id: string, patch: Partial<UserFlow>) => void;
  removeFlow: (planId: string, id: string) => void;

  /* 와이어프레임 */
  addWireframe: (planId: string, pageId: string, value?: Partial<Wireframe>) => string;
  updateWireframe: (planId: string, id: string, patch: Partial<Wireframe>) => void;
  removeWireframe: (planId: string, id: string) => void;

  /* UniAI */
  upsertUinAiScreen: (planId: string, screen: UinAiScreen) => void;

  /* AI 에이전트 */
  appendChat: (planId: string, message: Omit<ChatMessage, 'id' | 'createdAt'>) => void;
  clearChat: (planId: string) => void;

  /* 협업 */
  addComment: (
    planId: string,
    targetType: CommentTarget,
    targetId: string,
    body: string,
    author?: string,
  ) => void;
  toggleComment: (planId: string, commentId: string) => void;
  removeComment: (planId: string, commentId: string) => void;

  /* 버전 */
  saveVersion: (planId: string, label: string) => void;
  restoreVersion: (planId: string, versionId: string) => void;
  removeVersion: (planId: string, versionId: string) => void;
}

function now(): string {
  return new Date().toISOString();
}

function normalizePlanScreens(plan: Plan): Plan {
  const pageIds = (Array.isArray(plan.iaPages) ? plan.iaPages : [])
    .filter((page) => page?.type === 'page')
    .map((page) => page.id);
  return { ...plan, uinAiScreens: normalizeUinAiScreens(plan.uinAiScreens, pageIds) };
}

export function createEmptyPlan(brief: PlanBrief): Plan {
  const timestamp = now();
  return {
    id: uid('plan'),
    brief,
    createdAt: timestamp,
    updatedAt: timestamp,
    generated: { prd: false, fs: false, ia: false, flow: false, wireframe: false },
    chat: [],
    comments: [],
    versions: [],
    ...emptyDocuments(),
  };
}

export const usePlannerStore = create<PlannerState>()(
  persist(
    (set, get) => {
      /** 플랜 하나를 갱신하는 공통 헬퍼. updatedAt 을 자동으로 찍는다. */
      const mutate = (planId: string, fn: (plan: Plan) => Plan | void) => {
        set((state) => ({
          plans: state.plans.map((plan) => {
            if (plan.id !== planId) return plan;
            const draft: Plan = {
              ...plan,
              prd: { ...plan.prd },
              requirements: [...plan.requirements],
              features: [...plan.features],
              specifications: [...plan.specifications],
              iaPages: [...plan.iaPages],
              flows: [...plan.flows],
              wireframes: [...plan.wireframes],
              chat: [...plan.chat],
              comments: [...plan.comments],
              versions: [...plan.versions],
              uinAiScreens: [...(plan.uinAiScreens ?? [])],
              generated: { ...plan.generated },
            };
            const result = fn(draft) ?? draft;
            result.updatedAt = now();
            return result;
          }),
        }));
      };

      return {
        plans: [],
        hydrated: false,
        activeRun: null,
        interrupted: null,
        owner: null,
        agentOpen: false,
        agentBusy: null,

        setAgentOpen: (open) => set({ agentOpen: open }),

        setAgentBusy: (planId) => set({ agentBusy: planId }),

        setPlans: (plans, owner) => set({ plans: plans.map(normalizePlanScreens), owner }),

        createPlan: (brief) => {
          const plan = createEmptyPlan(brief);
          set((state) => ({ plans: [plan, ...state.plans] }));
          return plan.id;
        },

        importPlan: (plan) => {
          const copy: Plan = normalizePlanScreens({ ...plan, id: uid('plan'), updatedAt: now() });
          set((state) => ({ plans: [copy, ...state.plans] }));
          return copy.id;
        },

        deletePlan: (planId) =>
          set((state) => ({ plans: state.plans.filter((p) => p.id !== planId) })),

        renamePlan: (planId, title) =>
          mutate(planId, (plan) => {
            plan.brief = { ...plan.brief, title };
          }),

        getPlan: (planId) => get().plans.find((p) => p.id === planId),

        setActiveRun: (run) => set({ activeRun: run }),

        setInterrupted: (run) => set({ interrupted: run }),

        applyDocuments: (planId, patch, generated) =>
          mutate(planId, (plan) => {
            Object.assign(plan, patch);
            // IA 전체 생성은 PG ID를 처음부터 다시 쓰므로 예전 화면을 같은 ID의
            // 다른 페이지에 잘못 연결하지 않는다.
            if (patch.iaPages !== undefined) plan.uinAiScreens = [];
            for (const key of generated ?? []) plan.generated[key] = true;
          }),

        updatePrd: (planId, patch) =>
          mutate(planId, (plan) => {
            plan.prd = { ...plan.prd, ...patch };
            plan.generated.prd = true;
          }),

        addRequirement: (planId, value) => {
          const plan = get().getPlan(planId);
          const id = nextId('REQ', plan?.requirements ?? []);
          mutate(planId, (draft) => {
            draft.requirements.push({
              id,
              title: '새 요구사항',
              description: '',
              category: '공통',
              priority: 'P1',
              order: draft.requirements.length,
              ...value,
            });
          });
          return id;
        },

        updateRequirement: (planId, id, patch) =>
          mutate(planId, (plan) => {
            plan.requirements = plan.requirements.map((r) =>
              r.id === id ? { ...r, ...patch } : r,
            );
          }),

        removeRequirement: (planId, id) =>
          mutate(planId, (plan) => {
            removeRequirementFrom(plan, id);
          }),

        addFeature: (planId, requirementId, value) => {
          const plan = get().getPlan(planId);
          const id = nextId('FN', plan?.features ?? []);
          mutate(planId, (draft) => {
            draft.features.push({
              id,
              requirementId,
              name: '새 기능',
              description: '',
              priority: 'P1',
              status: '작성중',
              order: draft.features.filter((f) => f.requirementId === requirementId).length,
              ...value,
            });
          });
          return id;
        },

        updateFeature: (planId, id, patch) =>
          mutate(planId, (plan) => {
            plan.features = plan.features.map((f) => (f.id === id ? { ...f, ...patch } : f));
          }),

        removeFeature: (planId, id) =>
          mutate(planId, (plan) => {
            removeFeatureFrom(plan, id);
          }),

        addSpecification: (planId, featureId, value) => {
          const plan = get().getPlan(planId);
          const id = nextId('SP', plan?.specifications ?? []);
          mutate(planId, (draft) => {
            draft.specifications.push({
              id,
              featureId,
              title: '새 상세 명세',
              actor: '사용자',
              precondition: '',
              mainFlow: [],
              exceptions: [],
              acceptanceCriteria: [],
              pageIds: [],
              priority: 'P1',
              status: '작성중',
              order: draft.specifications.filter((s) => s.featureId === featureId).length,
              ...value,
            });
          });
          return id;
        },

        updateSpecification: (planId, id, patch) =>
          mutate(planId, (plan) => {
            plan.specifications = plan.specifications.map((s) =>
              s.id === id ? { ...s, ...patch } : s,
            );
          }),

        removeSpecification: (planId, id) =>
          mutate(planId, (plan) => {
            removeSpecificationFrom(plan, id);
          }),

        /* AI 제안 검토 -------------------------------------------------- */

        approveReview: (planId, target) =>
          mutate(planId, (plan) => {
            approveIn(plan, target);
          }),

        /**
         * 거절은 그 항목을 지운다 — 제안을 받지 않겠다는 뜻이므로.
         * 하위 항목도 함께 사라지는 규칙은 일반 삭제와 같다.
         */
        rejectReview: (planId, target) =>
          mutate(planId, (plan) => {
            rejectIn(plan, target);
          }),

        approveAllReview: (planId) =>
          mutate(planId, (plan) => {
            plan.requirements = plan.requirements.map(stripReview);
            plan.features = plan.features.map(stripReview);
            plan.specifications = plan.specifications.map(stripReview);
          }),

        /**
         * 전부 거절. 위에서부터 지우면 하위가 따라 사라지므로 요구사항 → 기능 → 명세 순으로 훑는다.
         * 승인된 부모 아래에 있던 검토 대기 자식만 남기고 정리된다.
         */
        rejectAllReview: (planId) =>
          mutate(planId, (plan) => {
            for (const req of plan.requirements.filter(isPending))
              rejectIn(plan, { kind: 'requirement', id: req.id });
            for (const feature of plan.features.filter(isPending))
              rejectIn(plan, { kind: 'feature', id: feature.id });
            for (const spec of plan.specifications.filter(isPending))
              rejectIn(plan, { kind: 'specification', id: spec.id });
          }),

        addIaPage: (planId, parentId, value) => {
          const plan = get().getPlan(planId);
          const id = nextId('PG', plan?.iaPages ?? []);
          mutate(planId, (draft) => {
            draft.iaPages.push({
              id,
              parentId,
              name: '새 페이지',
              path: '/new',
              description: '',
              type: 'page',
              roles: [],
              featureIds: [],
              order: draft.iaPages.filter((p) => p.parentId === parentId).length,
              ...value,
            });
          });
          return id;
        },

        updateIaPage: (planId, id, patch) =>
          mutate(planId, (plan) => {
            plan.iaPages = plan.iaPages.map((p) => (p.id === id ? { ...p, ...patch } : p));
          }),

        removeIaPage: (planId, id) =>
          mutate(planId, (plan) => {
            // 하위 페이지까지 함께 제거한다.
            const doomed = new Set<string>([id]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const page of plan.iaPages) {
                if (page.parentId && doomed.has(page.parentId) && !doomed.has(page.id)) {
                  doomed.add(page.id);
                  changed = true;
                }
              }
            }
            plan.iaPages = plan.iaPages.filter((p) => !doomed.has(p.id));
            plan.wireframes = plan.wireframes.filter((w) => !doomed.has(w.pageId));
            plan.specifications = plan.specifications.map((s) => ({
              ...s,
              pageIds: s.pageIds.filter((pid) => !doomed.has(pid)),
            }));
            plan.flows = plan.flows.map((flow) => ({
              ...flow,
              nodes: flow.nodes.map((n) =>
                n.pageId && doomed.has(n.pageId) ? { ...n, pageId: null } : n,
              ),
            }));
            plan.uinAiScreens = (plan.uinAiScreens ?? []).filter((screen) => !doomed.has(screen.pageId));
          }),

        moveIaPage: (planId, id, direction) =>
          mutate(planId, (plan) => {
            const target = plan.iaPages.find((p) => p.id === id);
            if (!target) return;
            const siblings = plan.iaPages
              .filter((p) => p.parentId === target.parentId)
              .sort((a, b) => a.order - b.order);
            const index = siblings.findIndex((p) => p.id === id);
            const swapWith = siblings[index + direction];
            if (!swapWith) return;
            const orderA = target.order;
            const orderB = swapWith.order;
            plan.iaPages = plan.iaPages.map((p) => {
              if (p.id === target.id) return { ...p, order: orderB };
              if (p.id === swapWith.id) return { ...p, order: orderA };
              return p;
            });
          }),

        addFlow: (planId, value) => {
          const plan = get().getPlan(planId);
          const id = nextId('FL', plan?.flows ?? []);
          mutate(planId, (draft) => {
            draft.flows.push({
              id,
              name: '새 플로우',
              description: '',
              actor: '사용자',
              nodes: [],
              edges: [],
              order: draft.flows.length,
              ...value,
            });
          });
          return id;
        },

        updateFlow: (planId, id, patch) =>
          mutate(planId, (plan) => {
            plan.flows = plan.flows.map((f) => (f.id === id ? { ...f, ...patch } : f));
          }),

        removeFlow: (planId, id) =>
          mutate(planId, (plan) => {
            plan.flows = plan.flows.filter((f) => f.id !== id);
          }),

        addWireframe: (planId, pageId, value) => {
          const plan = get().getPlan(planId);
          const id = nextId('WF', plan?.wireframes ?? []);
          const page = plan?.iaPages.find((p) => p.id === pageId);
          mutate(planId, (draft) => {
            draft.wireframes.push({
              id,
              pageId,
              name: page?.name ?? '새 화면',
              device: draft.brief.platform === 'app' ? 'mobile' : 'desktop',
              blocks: [],
              order: draft.wireframes.length,
              ...value,
            });
          });
          return id;
        },

        updateWireframe: (planId, id, patch) =>
          mutate(planId, (plan) => {
            plan.wireframes = plan.wireframes.map((w) => (w.id === id ? { ...w, ...patch } : w));
          }),

        removeWireframe: (planId, id) =>
          mutate(planId, (plan) => {
            plan.wireframes = plan.wireframes.filter((w) => w.id !== id);
          }),

        upsertUinAiScreen: (planId, screen) =>
          mutate(planId, (plan) => {
            const pageIds = plan.iaPages
              .filter((page) => page.type === 'page')
              .map((page) => page.id);
            if (!pageIds.includes(screen.pageId)) return;
            plan.uinAiScreens = normalizeUinAiScreens(
              [...(plan.uinAiScreens ?? []), screen],
              pageIds,
            );
          }),

        appendChat: (planId, message) =>
          mutate(planId, (plan) => {
            plan.chat.push({ ...message, id: uid('msg'), createdAt: now() });
          }),

        clearChat: (planId) =>
          mutate(planId, (plan) => {
            plan.chat = [];
          }),

        addComment: (planId, targetType, targetId, body, author = '나') =>
          mutate(planId, (plan) => {
            plan.comments.push({
              id: uid('cmt'),
              targetType,
              targetId,
              author,
              body,
              resolved: false,
              createdAt: now(),
            });
          }),

        toggleComment: (planId, commentId) =>
          mutate(planId, (plan) => {
            plan.comments = plan.comments.map((c) =>
              c.id === commentId ? { ...c, resolved: !c.resolved } : c,
            );
          }),

        removeComment: (planId, commentId) =>
          mutate(planId, (plan) => {
            plan.comments = plan.comments.filter((c) => c.id !== commentId);
          }),

        saveVersion: (planId, label) =>
          mutate(planId, (plan) => {
            plan.versions.unshift({
              id: uid('ver'),
              label: label || `버전 ${plan.versions.length + 1}`,
              createdAt: now(),
              snapshot: structuredClone(pickDocuments(plan)),
            });
            // 저장 용량을 감안해 최근 20개만 유지한다.
            plan.versions = plan.versions.slice(0, 20);
          }),

        restoreVersion: (planId, versionId) =>
          mutate(planId, (plan) => {
            const version = plan.versions.find((v) => v.id === versionId);
            if (!version) return;
            Object.assign(plan, structuredClone(version.snapshot));
            // 복원된 IA가 같은 PG ID를 다른 화면에 쓸 수 있어 결과도 함께 비운다.
            plan.uinAiScreens = [];
          }),

        removeVersion: (planId, versionId) =>
          mutate(planId, (plan) => {
            plan.versions = plan.versions.filter((v) => v.id !== versionId);
          }),
      };
    },
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: CREDIT_POLICY_VERSION,
      partialize: (state) => ({
        plans: state.plans,
        // 끊긴 생성은 저장한다 — 돌아왔을 때 이어서 만들 수 있어야 한다.
        interrupted: state.interrupted,
        // 이 플랜들이 누구 것인지도 함께 남긴다.
        owner: state.owner,
        // 에이전트 패널을 열어 뒀다면 다음에도 열린 채로 시작한다.
        agentOpen: state.agentOpen,
      }),
      /**
       * 한도가 바뀌면 저장된 잔량은 옛 한도 기준이라 그대로 쓸 수 없다.
       * 플랜은 그대로 두고 크레딧만 새 한도로 채운다.
       */
      migrate: (persisted) => {
        const previous = (persisted ?? {}) as Partial<PlannerState>;
        // 옛 판에 남아 있던 잔량·충전일은 버린다. 이제 서버가 센다.
        const { ...rest } = previous as Record<string, unknown>;
        delete rest.credits;
        delete rest.creditResetAt;
        return rest as unknown as PlannerState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.hydrated = true;
      },
    },
  ),
);

/** SSR 과 클라이언트 첫 렌더의 불일치를 막기 위한 헬퍼. */
export function usePlan(planId: string): Plan | undefined {
  return usePlannerStore((s) => s.plans.find((p) => p.id === planId));
}
