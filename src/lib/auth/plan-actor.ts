import { NextResponse } from 'next/server';
import { currentUser } from './server';
import { isAdminEmail } from './admin';
import { findUserById, toPublicUser, type PublicUser } from '../db/users';
import { planExists } from '../db/plans';
import { resolvePlanActor } from './plan-actor-policy';
import { serverErrorMessage } from '../api-error';

/** 로그인 세션은 유지하고, 검증된 관리자 작업의 데이터 소유자만 선택한다. */
export async function requirePlanActor(request: Request, planId?: string): Promise<
  { user: PublicUser; response: null } | { user: null; response: NextResponse }
> {
  try {
    const decision = await resolvePlanActor(request, planId, await currentUser(), {
      isAdmin: isAdminEmail,
      findOwner: async (id) => {
        const found = await findUserById(id);
        return found ? toPublicUser(found) : null;
      },
      ownsPlan: planExists,
    });
    if (!decision.access) {
      return {
        user: null,
        response: NextResponse.json(
          { error: decision.status === 401 ? '로그인이 필요합니다.' : '플랜을 찾을 수 없습니다.' },
          { status: decision.status },
        ),
      };
    }
    if (decision.access.delegated) {
      const { actor, user } = decision.access;
      console.info('[admin-plan]', actor.id, request.method, new URL(request.url).pathname,
        'owner', user.id, 'plan', request.headers.get('x-admin-plan-id'));
    }
    return { user: decision.access.user, response: null };
  } catch (error) {
    return { user: null, response: NextResponse.json({ error: serverErrorMessage('plan-access', error) }, { status: 500 }) };
  }
}
