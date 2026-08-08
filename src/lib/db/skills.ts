/** skills 표를 다루는 질의. */

import { getDb } from './index';
import {
  ACCOUNT_SCOPE,
  SKILL_ARTIFACTS,
  SKILL_MAX_CHARS,
  isSkillArtifact,
  resolveSkill,
  type Skill,
  type SkillMap,
} from '../skills';
import type { ArtifactKey } from '../types';

interface SkillRow {
  plan_id: string;
  artifact: string;
  body: string;
  enabled: boolean;
  updated_at: string;
}

function toSkill(row: SkillRow): Skill {
  return {
    artifact: row.artifact as ArtifactKey,
    body: row.body,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}

/**
 * 한 자리(계정 기본 또는 어떤 플랜)에 적어 둔 지침.
 *
 * `planId` 를 비우면 계정 기본이다.
 */
export async function listSkills(userId: string, planId = ACCOUNT_SCOPE): Promise<Skill[]> {
  const db = await getDb();
  const { rows } = await db.query<SkillRow>(
    `select plan_id, artifact, body, enabled, updated_at
       from skills where user_id = $1 and plan_id = $2`,
    [userId, planId],
  );
  return rows.filter((row) => isSkillArtifact(row.artifact)).map(toSkill);
}

export async function saveSkill(
  userId: string,
  planId: string,
  artifact: ArtifactKey,
  body: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into skills (user_id, plan_id, artifact, body, enabled, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id, plan_id, artifact)
     do update set body = excluded.body, enabled = excluded.enabled, updated_at = now()`,
    [userId, planId, artifact, body.slice(0, SKILL_MAX_CHARS), enabled],
  );
}

/**
 * 플랜에 적어 둔 것을 지운다 — 다시 계정 기본을 따르게 하는 것.
 *
 * 계정 기본(`plan_id = ''`)은 이 길로 지우지 못하게 막는다. 설정 화면에는
 * `기본을 따름` 이라는 선택지가 없어서, 거기서 이 호출이 나오면 사용자가
 * 의도한 적 없는 삭제다.
 */
export async function clearSkill(
  userId: string,
  planId: string,
  artifact: ArtifactKey,
): Promise<void> {
  if (planId === ACCOUNT_SCOPE) return;
  const db = await getDb();
  await db.query('delete from skills where user_id = $1 and plan_id = $2 and artifact = $3', [
    userId,
    planId,
    artifact,
  ]);
}

/** 플랜을 지울 때 그 플랜에 붙어 있던 지침도 함께 치운다. */
export async function clearPlanSkills(userId: string, planId: string): Promise<void> {
  if (planId === ACCOUNT_SCOPE) return;
  const db = await getDb();
  await db.query('delete from skills where user_id = $1 and plan_id = $2', [userId, planId]);
}

/**
 * 생성에 실제로 쓸 지침만.
 *
 * **켜져 있고 내용이 있는 것만** 준다. 꺼 둔 것을 넘기면 사용자가 껐다고 믿는
 * 것이 계속 적용된다 — 껐다는 사실을 못 믿게 되면 스위치가 있으나 마나다.
 *
 * 플랜을 함께 주면 **그 플랜에 적어 둔 것이 계정 기본을 이긴다.** 기본과
 * 플랜별을 한 번에 읽어 와 고른다(`plan_id in ('', $2)`).
 *
 * 어떤 이유로든 못 읽으면 **빈 것으로 본다.** 지침 때문에 생성 자체가 막히면
 * 안 된다 — 지침은 거들 뿐이고 문서를 만드는 일이 본론이다.
 */
export async function activeSkills(userId: string, planId?: string): Promise<SkillMap> {
  try {
    const scope = planId?.trim() ?? ACCOUNT_SCOPE;
    const db = await getDb();
    // 플랜을 안 줬으면 $2 도 빈 문자열이라 계정 기본만 걸린다.
    const { rows } = await db.query<SkillRow>(
      `select plan_id, artifact, body, enabled, updated_at
         from skills where user_id = $1 and (plan_id = '' or plan_id = $2)`,
      [userId, scope],
    );

    const account = new Map<ArtifactKey, Skill>();
    const plan = new Map<ArtifactKey, Skill>();
    for (const row of rows) {
      if (!isSkillArtifact(row.artifact)) continue;
      (row.plan_id === ACCOUNT_SCOPE ? account : plan).set(row.artifact as ArtifactKey, toSkill(row));
    }

    const out: SkillMap = {};
    for (const artifact of SKILL_ARTIFACTS) {
      const body = resolveSkill(account.get(artifact), plan.get(artifact));
      if (body) out[artifact] = body;
    }
    return out;
  } catch (error) {
    console.error('[skills] 지침을 읽지 못했습니다:', error);
    return {};
  }
}
