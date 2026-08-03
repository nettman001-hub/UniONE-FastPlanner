'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nextId, uid } from './ids';
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
  ARTIFACT_CREDIT_COST,
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
  type Wireframe,
} from './types';

const STORAGE_KEY = 'unione-fastplaner:v1';

/**
 * 일일 무료 크레딧.
 *
 * 임시로 넉넉하게 열어 둔 값이다. 정식 요금제를 붙일 때 플랜별 한도로 바꾼다.
 * 화면에는 "(임시)" 표기를 함께 노출한다.
 */
export const DAILY_CREDIT_LIMIT = 200;

/** 한도가 바뀌면 이 값을 올린다 — 저장된 잔량이 옛 한도에 묶이지 않도록. */
const CREDIT_POLICY_VERSION = 2;

export interface PlannerState {
  plans: Plan[];
  credits: number;
  creditResetAt: string;
  hydrated: boolean;

  /* 플랜 */
  createPlan: (brief: PlanBrief) => string;
  importPlan: (plan: Plan) => string;
  deletePlan: (planId: string) => void;
  renamePlan: (planId: string, title: string) => void;
  getPlan: (planId: string) => Plan | undefined;

  /* 크레딧 */
  spendCredits: (amount: number) => boolean;
  refillCredits: () => void;
  costOf: (artifact: ArtifactKey) => number;

  /* 산출물 일괄 반영 */
  applyDocuments: (planId: string, patch: Partial<PlanDocuments>, generated?: ArtifactKey[]) => void;

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
        credits: DAILY_CREDIT_LIMIT,
        creditResetAt: todayKey(),
        hydrated: false,

        createPlan: (brief) => {
          const plan = createEmptyPlan(brief);
          set((state) => ({ plans: [plan, ...state.plans] }));
          return plan.id;
        },

        importPlan: (plan) => {
          const copy: Plan = { ...plan, id: uid('plan'), updatedAt: now() };
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

        spendCredits: (amount) => {
          const state = get();
          // 날짜가 바뀌었으면 먼저 충전한다 (STARTER 플랜 정책).
          const today = todayKey();
          const available =
            state.creditResetAt === today ? state.credits : DAILY_CREDIT_LIMIT;
          if (available < amount) return false;
          set({ credits: available - amount, creditResetAt: today });
          return true;
        },

        refillCredits: () => set({ credits: DAILY_CREDIT_LIMIT, creditResetAt: todayKey() }),

        costOf: (artifact) => ARTIFACT_CREDIT_COST[artifact],

        applyDocuments: (planId, patch, generated) =>
          mutate(planId, (plan) => {
            Object.assign(plan, patch);
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
        credits: state.credits,
        creditResetAt: state.creditResetAt,
      }),
      /**
       * 한도가 바뀌면 저장된 잔량은 옛 한도 기준이라 그대로 쓸 수 없다.
       * 플랜은 그대로 두고 크레딧만 새 한도로 채운다.
       */
      migrate: (persisted) => {
        const previous = (persisted ?? {}) as Partial<PlannerState>;
        return {
          ...previous,
          credits: DAILY_CREDIT_LIMIT,
          creditResetAt: todayKey(),
        } as PlannerState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 날짜가 지났으면 재충전한다.
        if (state.creditResetAt !== todayKey()) {
          state.credits = DAILY_CREDIT_LIMIT;
          state.creditResetAt = todayKey();
        }
        // 한도를 낮춘 경우 잔량이 한도를 넘지 않게 맞춘다.
        if (state.credits > DAILY_CREDIT_LIMIT) state.credits = DAILY_CREDIT_LIMIT;
        state.hydrated = true;
      },
    },
  ),
);

/** SSR 과 클라이언트 첫 렌더의 불일치를 막기 위한 헬퍼. */
export function usePlan(planId: string): Plan | undefined {
  return usePlannerStore((s) => s.plans.find((p) => p.id === planId));
}
