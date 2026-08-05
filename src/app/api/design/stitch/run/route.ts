/**
 * 화면 **하나**를 스티치에 만든다.
 *
 * ## 왜 하나씩인가
 *
 * 처음에는 고른 화면 전부를 한 요청 안에서 만들고 진행 상황을 흘려보냈다.
 * 그런데 화면 하나에 1분 가까이 걸려서, 8개를 걸면 서버 함수 제한시간(5분)에
 * 걸려 **통째로 끊겼다.** 끊기면 진행 중이던 화면은 화면에 `만드는 중` 인 채로
 * 영원히 남고, 뒤 화면들은 시작조차 못 했다. 정작 스티치에는 만들다 만 것이
 * 남아 있으니 사용자는 무엇이 됐는지 알 수 없었다.
 *
 * 그래서 **요청 하나에 화면 하나**만 만든다. 반복은 브라우저가 한다. 제한시간에
 * 걸릴 일이 없고, 한 화면이 실패해도 그 화면만 실패하며, 멈추기도 즉시 듣는다.
 *
 * 프로젝트는 첫 요청에서 만들고, 이후로는 받은 `projectId` 를 그대로 쓴다.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { readIntegrationSecret } from '@/lib/db/integrations';
import { screenPrompt, systemPrompt, type PromptEmphasis } from '@/lib/design-handoff';
import {
  createDesignSystem,
  createProject,
  detectCredential,
  generateScreen,
  projectUrl,
  resolveModel,
  StitchError,
  type StitchCredential,
  type StitchCredentialKind,
  type StitchDevice,
} from '@/lib/design/stitch';
import { findSkill } from '@/lib/design/skills';
import type { IaPage, Plan } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 거절당한 뒤 다시 걸기까지 — **점점 길게 기다린다.**
 *
 * 스무 개를 연달아 만들면 두어 개가 `invalid argument` 로 떨어졌다. 처음에는
 * 요청문이 길어서라고 봤는데, **같은 화면을 따로 하나만 만들면 잘 된다.**
 * 그러니 내용 문제가 아니라 연달아 몰아칠 때 생기는 일시적인 거절이다.
 * 잠깐 쉬었다 다시 걸면 풀린다.
 */
const RETRY_WAITS_MS = (process.env.STITCH_RETRY_WAITS_MS ?? '3000,8000')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v >= 0);

interface RunBody {
  plan?: Plan;
  /** 만들 화면 하나. */
  pageId?: string;
  /** 이미 만들어 둔 프로젝트. 없으면 새로 만든다. */
  projectId?: string;
  /** 첫 화면인가 — 톤 잡는 문장을 함께 보낼지 정한다. */
  first?: boolean;
  /** 스티치 모델 id. 고를 수 있는 값은 /api/design/stitch/models 가 준다. */
  modelId?: string;
  /** 와이어프레임을 얼마나 그대로 지킬지. */
  emphasis?: string;
  /** 고른 디자인 스킬. 첫 요청에서 스티치 디자인 시스템으로 만든다. */
  skill?: string;
  /** 이미 만들어 둔 디자인 시스템. 없으면 첫 요청에서 만든다. */
  designSystemId?: string;
}

function deviceOf(plan: Plan, page: IaPage): StitchDevice {
  const wireframe = plan.wireframes?.find((w) => w.pageId === page.id);
  if (wireframe?.device === 'desktop') return 'DESKTOP';
  if (wireframe?.device === 'mobile') return 'MOBILE';
  return plan.brief?.platform === 'app' ? 'MOBILE' : 'DESKTOP';
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: RunBody;
  try {
    body = (await request.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan?.id) return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });

  const page = (plan.iaPages ?? []).find((p) => p.type === 'page' && p.id === body.pageId);
  if (!page) return NextResponse.json({ error: '만들 화면을 찾지 못했습니다.' }, { status: 400 });

  let stored: { secret: string; kind: string } | null = null;
  try {
    stored = await readIntegrationSecret(user.id, 'stitch');
  } catch {
    stored = null;
  }
  if (!stored) {
    return NextResponse.json(
      { error: '스티치가 연결돼 있지 않습니다. 먼저 연결해 주세요.' },
      { status: 409 },
    );
  }

  const quotaProject = process.env.STITCH_QUOTA_PROJECT || undefined;

  /*
   * 어느 헤더로 보낼지는 연결할 때 실제로 찔러 보고 정해 둔 값을 쓴다.
   * 비어 있으면 그 확인이 생기기 전에 저장된 것이므로 지금 알아낸다.
   */
  let kind: StitchCredentialKind | null =
    stored.kind === 'apikey' || stored.kind === 'oauth' ? stored.kind : null;
  if (!kind) {
    try {
      kind = await detectCredential(stored.secret, quotaProject, request.signal);
    } catch (error) {
      const message =
        error instanceof StitchError ? error.message : '스티치에 연결하지 못했습니다.';
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  const cred: StitchCredential = { kind, secret: stored.secret, quotaProject };

  // 사용자가 보낸 모델이 실제로 고를 수 있는 것인지 확인한다. 모르는 값이면 가벼운 쪽.
  const modelId = await resolveModel(body.modelId);
  const emphasis: PromptEmphasis =
    body.emphasis === 'balanced' || body.emphasis === 'free' ? body.emphasis : 'strict';

  try {
    let projectId = body.projectId?.trim() || '';
    if (!projectId) {
      projectId = await createProject(plan.brief?.title?.trim() || '무제 플랜', cred, request.signal);
    }

    /*
     * 고른 스킬을 스티치 디자인 시스템으로 만들어 둔다. 한 번만 만들고 이후
     * 화면들은 브라우저가 돌려준 id 를 그대로 쓴다.
     *
     * 실패해도 멈추지 않는다 — 색·글꼴이 조금 제각각인 것과 화면이 아예 안
     * 만들어지는 것 중에는 앞이 낫다. 대신 지침을 요청문에 실어 보낸다.
     */
    const skill = findSkill(body.skill);
    let designSystemId = body.designSystemId?.trim() || null;
    /*
     * **첫 화면에서만 만든다.**
     *
     * 실패했을 때 화면마다 다시 시도하면, 안 될 일을 스무 번 되풀이하며 그만큼
     * 느려진다. 디자인 시스템은 한 번 하는 준비 작업이지 화면마다 할 일이 아니다.
     */
    if (skill && !designSystemId && body.first) {
      designSystemId = await createDesignSystem(
        projectId,
        {
          displayName: skill.name,
          colorMode: skill.colorMode,
          headlineFont: skill.headlineFont,
          bodyFont: skill.bodyFont,
          roundness: skill.roundness,
          customColor: skill.color,
          designMd: skill.designMd,
        },
        cred,
        request.signal,
      );
    }

    /*
     * 톤 잡는 문장은 첫 화면 요청 앞에만 붙인다. 스티치에는 "이전 대화" 개념이
     * 없어서 따로 부르면 다음 화면이 그걸 모르는데, 매번 붙이면 요청문이 길어져
     * 정작 이 화면 이야기가 묻힌다.
     */
    /*
     * 디자인 시스템을 못 만들었으면 지침을 글로라도 실어 보낸다. 첫 화면에만
     * 붙이는 톤 문장 자리가 그 자리다.
     */
    const guide = skill && !designSystemId ? `\n\n${skill.designMd}` : '';
    const build = (compact: boolean) => {
      const one = screenPrompt(plan, page, 'stitch', emphasis, compact);
      // 짧게 다시 만들 때는 톤 문장도 뺀다 — 이 화면 이야기를 남기는 것이 먼저다.
      return body.first && !compact
        ? `${systemPrompt(plan, 'stitch')}${guide}\n\n---\n\n${one}`
        : one;
    };

    const device = deviceOf(plan, page);
    const make = (compact: boolean) =>
      generateScreen(projectId, build(compact), device, modelId, designSystemId, cred, request.signal);

    /*
     * 거절당하면 쉬었다 다시 건다. 사용자가 따로 하나씩 만들면 잘 되는 것을
     * 확인했으므로, 실패는 이 화면의 문제가 아니라 몰아친 탓이다.
     *
     * 마지막 시도는 요청문을 짧게 줄여 본다 — 길이가 원인인 경우까지 덮는다.
     * 공짜로 얻는 보험이고, 짧아도 블록의 구성 항목은 그대로 간다.
     */
    let screen;
    let attempt = 0;
    for (;;) {
      const last = attempt >= RETRY_WAITS_MS.length;
      try {
        screen = await make(last && attempt > 0);
        break;
      } catch (error) {
        const worthRetry =
          error instanceof StitchError && (error.kind === 'input' || error.kind === 'server');
        if (!worthRetry || last || request.signal.aborted) throw error;
        await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]));
        attempt += 1;
      }
    }

    return NextResponse.json({
      projectId,
      designSystemId,
      url: projectUrl(projectId),
      screenId: screen.screenId,
      imageUrl: screen.imageUrl,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: '멈췄습니다.' }, { status: 499 });
    }
    let message =
      error instanceof StitchError ? error.message : '스티치에 화면을 만들지 못했습니다.';
    /*
     * 실험 모드는 월 사용 횟수가 적어 한도에 먼저 걸린다. 그때 "한도에 걸렸다" 고만
     * 하면 기다리는 수밖에 없어 보이지만, 실은 기본으로 바꾸면 바로 된다.
     */
    if (/pro/i.test(modelId) && error instanceof StitchError && error.kind === 'quota') {
      message += ' 무거운 모델은 월 사용 횟수가 적습니다. 가벼운 모델로 바꿔 보세요.';
    }
    // 자격증명 문제면 남은 화면도 같은 이유로 실패한다. 브라우저가 알아볼 수 있게 갈라 준다.
    const status = error instanceof StitchError && error.kind === 'auth' ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
