/** skills 표를 다루는 질의. */

import { getDb } from './index';
import { SKILL_MAX_CHARS, isSkillArtifact, type Skill, type SkillMap } from '../skills';
import type { ArtifactKey } from '../types';

interface SkillRow {
  artifact: string;
  body: string;
  enabled: boolean;
  updated_at: string;
}

export async function listSkills(userId: string): Promise<Skill[]> {
  const db = await getDb();
  const { rows } = await db.query<SkillRow>(
    'select artifact, body, enabled, updated_at from skills where user_id = $1',
    [userId],
  );
  return rows.filter((row) => isSkillArtifact(row.artifact)).map((row) => ({
    artifact: row.artifact as ArtifactKey,
    body: row.body,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }));
}

export async function saveSkill(
  userId: string,
  artifact: ArtifactKey,
  body: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into skills (user_id, artifact, body, enabled, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (user_id, artifact)
     do update set body = excluded.body, enabled = excluded.enabled, updated_at = now()`,
    [userId, artifact, body.slice(0, SKILL_MAX_CHARS), enabled],
  );
}

/**
 * 생성에 실제로 쓸 지침만.
 *
 * **켜져 있고 내용이 있는 것만** 준다. 꺼 둔 것을 넘기면 사용자가 껐다고 믿는
 * 것이 계속 적용된다 — 껐다는 사실을 못 믿게 되면 스위치가 있으나 마나다.
 *
 * 어떤 이유로든 못 읽으면 **빈 것으로 본다.** 지침 때문에 생성 자체가 막히면
 * 안 된다 — 지침은 거들 뿐이고 문서를 만드는 일이 본론이다.
 */
export async function activeSkills(userId: string): Promise<SkillMap> {
  try {
    const out: SkillMap = {};
    for (const skill of await listSkills(userId)) {
      if (!skill.enabled) continue;
      const body = skill.body.trim();
      if (body) out[skill.artifact] = body;
    }
    return out;
  } catch (error) {
    console.error('[skills] 지침을 읽지 못했습니다:', error);
    return {};
  }
}
