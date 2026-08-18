import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { generateJson, isAiEnabled } from '@/lib/ai/client';
import { userAgentEngine } from '@/lib/db/user-settings';
import { readAiRuntime } from '@/lib/db/ai-config';
import { aiErrorMessage } from '@/lib/ai/errors';
import { PLACEMENT_SCHEMA } from '@/lib/ai/schemas';
import { buildPlacementPrompt } from '@/lib/ai/prompts';
import { unplacedFeatures, type Placement } from '@/lib/ia/placement';
import { canAfford, spendCredits } from '@/lib/db/credits';
import { PLACEMENT_CREDIT_COST } from '@/lib/types';
import { costWithEngine } from '@/lib/credits';
import type { IaPageType, Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** 모델이 돌려주는 한 줄. 전부 문자열이라 여기서 걸러 낸다. */
interface RawPlacement {
  featureId?: string;
  target?: string;
  pageId?: string;
  name?: string;
  path?: string;
  description?: string;
  pageType?: string;
  parentPageId?: string;
  reason?: string;
}

const PAGE_TYPES: IaPageType[] = ['page', 'modal', 'tab', 'section'];

function slugPath(name: string): string {
  const slug = name.trim().replace(/\s+/g, '-').toLowerCase();
  return `/${slug || 'new-page'}`;
}

/**
 * 새 기능을 어디에 둘지 **제안만** 만든다. 문서는 고치지 않는다.
 *
 * 반영은 사용자가 화면에서 고른 것만, 브라우저에서 덧붙이는 방식으로 이루어진다.
 * 서버가 곧바로 정보구조도를 바꾸지 않는 이유는 — 무엇이 어디로 가는지 사람이 보고
 * 정해야 하는 일이기 때문이다.
 */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: { plan?: Plan };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan?.id) return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });

  const targets = unplacedFeatures(plan);
  if (targets.length === 0) {
    return NextResponse.json({ placements: [], message: '배치할 새 기능이 없습니다.' });
  }
  const runtime = await readAiRuntime();
  const engine = await userAgentEngine(user.id);
  const cost = costWithEngine(PLACEMENT_CREDIT_COST, engine);

  if (!isAiEnabled(runtime.config, runtime.apiKey)) {
    return NextResponse.json(
      { error: '지금은 자동 배치를 쓸 수 없습니다. 정보구조도 화면에서 직접 연결해 주세요.' },
      { status: 503 },
    );
  }

  // 낼 수 있는지 서버가 본다. 예전에는 브라우저만 셌다.
  if (!(await canAfford(user.id, cost))) {
    return NextResponse.json(
      { error: '크레딧이 부족합니다. 내일 다시 충전됩니다.' },
      { status: 402 },
    );
  }

  try {
    const result = await generateJson<{ placements: RawPlacement[] }>({
      engine,
      config: runtime.config,
      apiKey: runtime.apiKey,
      prompt: buildPlacementPrompt(
        plan,
        targets.map((f) => ({ id: f.id, name: f.name, description: f.description })),
      ),
      schema: PLACEMENT_SCHEMA,
      maxTokens: 16000,
    });

    const wanted = new Set(targets.map((f) => f.id));
    const pageIds = new Set(plan.iaPages.map((p) => p.id));
    const seen = new Set<string>();
    const placements: Placement[] = [];

    for (const raw of result.placements ?? []) {
      const featureId = raw.featureId?.trim() ?? '';
      // 준 기능만, 한 번씩만 다룬다. 모델이 지어냈거나 중복이면 버린다.
      if (!wanted.has(featureId) || seen.has(featureId)) continue;

      if (raw.target === 'existing' && raw.pageId && pageIds.has(raw.pageId.trim())) {
        seen.add(featureId);
        placements.push({
          kind: 'existing',
          featureId,
          pageId: raw.pageId.trim(),
          reason: raw.reason?.trim() || '',
        });
        continue;
      }

      const name = raw.name?.trim();
      // 새 화면인데 이름조차 없으면 쓸 수 없다.
      if (!name) continue;
      seen.add(featureId);
      const parent = raw.parentPageId?.trim();
      placements.push({
        kind: 'new',
        featureId,
        name,
        path: raw.path?.trim() || slugPath(name),
        description: raw.description?.trim() || '',
        type: PAGE_TYPES.includes(raw.pageType as IaPageType) ? (raw.pageType as IaPageType) : 'page',
        parentId: parent && pageIds.has(parent) ? parent : null,
        reason: raw.reason?.trim() || '',
      });
    }

    // 제안이 안 온 기능이 있으면 알려 준다. 조용히 빠뜨리면 사용자가 모른다.
    const missed = targets.filter((f) => !seen.has(f.id)).map((f) => `${f.id} ${f.name}`);
    // 값은 받았을 때 치른다. 아래 catch 로 빠지면 아무것도 못 받았으므로 안 받는다.
    await spendCredits(user.id, 'place', cost);
    return NextResponse.json({ placements, missed });
  } catch (error) {
    return NextResponse.json({ error: aiErrorMessage(error) }, { status: 502 });
  }
}
