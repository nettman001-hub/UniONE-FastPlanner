import type { PublicUser } from '../db/users';

export interface PlanActorAccess {
  user: PublicUser;
  actor: PublicUser;
  delegated: boolean;
}

export type PlanActorDecision =
  | { access: PlanActorAccess; status?: never }
  | { access?: never; status: 401 | 404 };

/** 대상 헤더는 권한이 아니다. 실제 관리자와 사용자·플랜의 소유 관계를 확인한다. */
export async function resolvePlanActor(
  request: Request,
  planId: string | undefined,
  actor: PublicUser | null,
  dependencies: {
    isAdmin: (email: string) => boolean;
    findOwner: (userId: string) => Promise<PublicUser | null>;
    ownsPlan: (userId: string, planId: string) => Promise<boolean>;
  },
): Promise<PlanActorDecision> {
  if (!actor) return { status: 401 };
  const userId = request.headers.get('x-admin-user-id');
  const selectedId = request.headers.get('x-admin-plan-id');
  if (userId === null && selectedId === null) {
    return { access: { user: actor, actor, delegated: false } };
  }
  if (!userId?.trim() || !selectedId?.trim() || userId.length > 128 || selectedId.length > 128 ||
    !dependencies.isAdmin(actor.email) || (planId !== undefined && selectedId !== planId)) {
    return { status: 404 };
  }
  const owner = await dependencies.findOwner(userId);
  if (!owner || !(await dependencies.ownsPlan(userId, selectedId))) return { status: 404 };
  return { access: { user: owner, actor, delegated: true } };
}
