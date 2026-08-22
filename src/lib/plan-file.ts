/**
 * 플랜을 **파일로 내보내고 파일에서 되돌리는** 규칙.
 *
 * 홈의 `가져오기` 와 설정의 `전체 백업` 이 같은 것을 쓴다. 두 벌로 적어 두면
 * 한쪽만 고치는 날이 오고, 그날 백업 파일이 안 열린다.
 *
 * 되돌릴 때는 **믿지 않는다.** 사용자가 손으로 고친 파일, 옛 판으로 내보낸 파일,
 * 아예 다른 서비스의 JSON 이 들어올 수 있다. 형식이 아니면 `null` 을 주고,
 * 모자란 자리는 빈 플랜의 값으로 채운다.
 */

import { createEmptyPlan } from './store';
import { normalizeUinAiScreens } from './design/uinai';
import { type ArtifactKey, type Plan, type Platform } from './types';

const ARTIFACT_KEYS: ArtifactKey[] = ['prd', 'fs', 'ia', 'flow', 'wireframe'];
const PLATFORM_KEYS: Platform[] = ['web', 'app', 'both', 'admin'];

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 셀렉트에서 온 값도 여기를 지난다 — 아는 플랫폼이 아니면 웹으로 본다. */
export function asPlatform(value: unknown): Platform {
  return PLATFORM_KEYS.includes(value as Platform) ? (value as Platform) : 'web';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** 이미 해석해 둔 값 하나를 플랜으로. 형식이 아니면 null. */
export function planFromValue(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Partial<Plan>;
  const brief = value.brief;
  if (!brief || typeof brief !== 'object' || typeof brief.title !== 'string') return null;

  const base = createEmptyPlan({
    title: brief.title,
    oneLiner: asString(brief.oneLiner),
    idea: asString(brief.idea),
    targetUser: asString(brief.targetUser),
    purpose: asString(brief.purpose),
    platform: asPlatform(brief.platform),
    reference: asString(brief.reference),
    mustHave: asString(brief.mustHave),
  });
  // 요구분석 답은 문서를 만드는 근거다. 가져오기에서 흘리면 다시 만들 때 달라진다.
  if (brief.answers && typeof brief.answers === 'object') base.brief.answers = brief.answers;
  if (Array.isArray(brief.followups)) base.brief.followups = brief.followups;

  const generated = { ...base.generated };
  if (value.generated && typeof value.generated === 'object') {
    for (const key of ARTIFACT_KEYS) generated[key] = Boolean(value.generated[key]);
  }

  return {
    ...base,
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
    generated,
    prd: value.prd && typeof value.prd === 'object' ? { ...base.prd, ...value.prd } : base.prd,
    requirements: asArray(value.requirements),
    features: asArray(value.features),
    specifications: asArray(value.specifications),
    iaPages: asArray(value.iaPages),
    flows: asArray(value.flows),
    wireframes: asArray(value.wireframes),
    chat: asArray(value.chat),
    comments: asArray(value.comments),
    versions: asArray(value.versions),
    uinAiScreens: normalizeUinAiScreens(
      value.uinAiScreens,
      asArray<{ id?: unknown; type?: unknown }>(value.iaPages)
        .filter((page) => page.type === 'page' && typeof page.id === 'string')
        .map((page) => page.id as string),
    ),
  };
}

/** 내보낸 JSON 한 개를 안전하게 Plan 으로 되돌린다. 형식이 아니면 null. */
export function parsePlan(text: string): Plan | null {
  try {
    return planFromValue(JSON.parse(text));
  } catch {
    return null;
  }
}

/* 전체 백업 ----------------------------------------------------------- */

/** 백업 파일임을 알아볼 표식. 남의 JSON 을 실수로 여는 것을 막는다. */
const BACKUP_KIND = 'unione-fastplaner/backup';

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: 1;
  exportedAt: string;
  plans: Plan[];
}

export function toBackup(plans: Plan[]): string {
  const file: BackupFile = {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    plans,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * 파일 하나에서 플랜들을 꺼낸다.
 *
 * **전체 백업과 플랜 한 개를 둘 다 받는다.** 사용자는 둘을 구분하지 않는다 —
 * 내려받은 JSON 을 그냥 끌어다 놓는다. 여기서 갈라 주면 "이 파일은 여기 넣는
 * 게 아닙니다" 라는 안내를 만들 일이 없다.
 */
export function parsePlanFile(text: string): Plan[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }

  if (raw && typeof raw === 'object' && Array.isArray((raw as BackupFile).plans)) {
    return (raw as BackupFile).plans
      .map((value) => planFromValue(value))
      .filter((plan): plan is Plan => plan !== null);
  }

  const one = planFromValue(raw);
  return one ? [one] : [];
}
