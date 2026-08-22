import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { generateJson } from '@/lib/ai/client';
import { isEngineTier, type EngineTier } from '@/lib/ai/engines';
import { AiError, aiErrorMessage } from '@/lib/ai/errors';
import { resolveProvider } from '@/lib/ai/provider';
import { costWithEngine } from '@/lib/credits';
import { releaseCreditReservation, reserveCredits } from '@/lib/db/credits';
import { readAiRuntime } from '@/lib/db/ai-config';
import { getPlan, savePlan, saveUinAiScreen } from '@/lib/db/plans';
import { findUserById } from '@/lib/db/users';
import {
  buildUinAiPrompt,
  UINAI_SCREEN_SCHEMA,
  UINAI_SYSTEM_PROMPT,
} from '@/lib/design/uinai-prompt';
import { findSkill } from '@/lib/design/skills';
import { sanitizeUinAiHtml, uinAiSourceSignature } from '@/lib/design/uinai';
import {
  UINAI_CREDIT_COST,
  type IaPage,
  type Plan,
  type UinAiScreen,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BODY_CHARS = 750_000;
const MAX_PROMPT_CHARS = 220_000;

interface RunBody {
  plan?: Plan;
  pageId?: string;
  requestId?: unknown;
  engine?: unknown;
  emphasis?: unknown;
  skill?: unknown;
}

interface UinAiDraft {
  html?: unknown;
  summary?: unknown;
  implementationNotes?: unknown;
}

function deviceOf(plan: Plan, page: IaPage): 'mobile' | 'desktop' {
  const wireframe = plan.wireframes.find((item) => item.pageId === page.id);
  if (wireframe?.device === 'mobile') return 'mobile';
  if (wireframe?.device === 'desktop') return 'desktop';
  return plan.brief.platform === 'app' ? 'mobile' : 'desktop';
}

function normalizedHtml(value: unknown): string {
  if (typeof value !== 'string') throw new AiError('format', 'UinAI HTML이 문자열이 아님');
  let html = value.trim();
  const fenced = /^```(?:html)?\s*([\s\S]*?)```$/i.exec(html);
  if (fenced) html = fenced[1].trim();
  try {
    return sanitizeUinAiHtml(html);
  } catch (error) {
    throw new AiError('format', error instanceof Error ? error.message : 'HTML 안전화 실패');
  }
}

function notesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 1_000))
    .filter(Boolean)
    .slice(0, 8);
}

function emphasisOf(value: unknown): UinAiScreen['emphasis'] {
  return value === 'balanced' || value === 'free' ? value : 'strict';
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'screen';
}

function planProblem(plan: Plan): string | null {
  if (typeof plan.id !== 'string' || plan.id.length === 0 || plan.id.length > 128) {
    return '플랜 ID가 올바르지 않습니다.';
  }
  if (!plan.brief || typeof plan.brief !== 'object' || !plan.prd || typeof plan.prd !== 'object') {
    return '플랜 기본 정보가 올바르지 않습니다.';
  }
  const limits: Array<[unknown, number]> = [
    [plan.requirements, 1_000],
    [plan.features, 1_000],
    [plan.specifications, 1_000],
    [plan.iaPages, 300],
    [plan.flows, 200],
    [plan.wireframes, 300],
  ];
  if (limits.some(([value, limit]) => !Array.isArray(value) || value.length > limit)) {
    return '플랜 항목 수가 허용 범위를 벗어났습니다.';
  }
  if (
    !Array.isArray(plan.prd.coreValues) ||
    !Array.isArray(plan.prd.roles) ||
    plan.prd.roles.some((role) => !role || typeof role.name !== 'string') ||
    plan.iaPages.some(
      (page) =>
        !page ||
        typeof page.id !== 'string' ||
        typeof page.name !== 'string' ||
        !Array.isArray(page.roles) ||
        !Array.isArray(page.featureIds),
    ) ||
    plan.features.some(
      (feature) => !feature || typeof feature.id !== 'string' || typeof feature.name !== 'string',
    ) ||
    plan.flows.some(
      (flow) =>
        !flow ||
        typeof flow.name !== 'string' ||
        !Array.isArray(flow.nodes) ||
        flow.nodes.some((node) => !node || typeof node.id !== 'string'),
    ) ||
    plan.wireframes.some(
      (wireframe) =>
        !wireframe ||
        typeof wireframe.pageId !== 'string' ||
        !Array.isArray(wireframe.blocks) ||
        wireframe.blocks.some(
          (block) =>
            !block ||
            typeof block.title !== 'string' ||
            !Array.isArray(block.items) ||
            block.items.some((item) => typeof item !== 'string'),
        ),
    )
  ) {
    return '플랜 내부 형식이 올바르지 않습니다.';
  }
  return null;
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  let body: RunBody;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: '플랜이 너무 커서 화면을 만들 수 없습니다.' }, { status: 413 });
    }
    body = JSON.parse(text) as RunBody;
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan) return NextResponse.json({ error: '플랜 정보가 없습니다.' }, { status: 400 });
  const invalidPlan = planProblem(plan);
  if (invalidPlan) return NextResponse.json({ error: invalidPlan }, { status: 400 });
  const page = plan.iaPages.find((item) => item.type === 'page' && item.id === body.pageId);
  if (!page) return NextResponse.json({ error: '만들 화면을 찾지 못했습니다.' }, { status: 400 });
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: '요청 ID가 올바르지 않습니다.' }, { status: 400 });
  }

  // 브라우저는 등급 이름만 고른다. 실제 모델 이름과 키는 서버에서만 결정한다.
  if (!isEngineTier(body.engine)) {
    return NextResponse.json({ error: '엔진 선택이 올바르지 않습니다.' }, { status: 400 });
  }
  const engine: EngineTier = body.engine;
  if (body.emphasis !== 'strict' && body.emphasis !== 'balanced' && body.emphasis !== 'free') {
    return NextResponse.json({ error: '와이어프레임 옵션이 올바르지 않습니다.' }, { status: 400 });
  }
  const emphasis = emphasisOf(body.emphasis);
  const skill = typeof body.skill === 'string' ? body.skill : '';
  if (skill !== 'none' && !findSkill(skill)) {
    return NextResponse.json({ error: '디자인 선택이 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    // 오래된 서명 쿠키만 남은 삭제 계정은 공급자 호출 전에 막는다.
    if (!(await findUserById(user.id))) {
      return NextResponse.json(
        { error: '로그인이 풀렸습니다. 다시 로그인해 주세요.' },
        { status: 401 },
      );
    }

    // 생성에 쓸 문서를 먼저 서버에 맞춘다. 러너가 요청 크기를 줄이려고 뺀 대화·버전은
    // 기존 서버본을 보존하고, 더 최신 서버본이 있으면 덮지 않고 409로 알려 준다.
    const owned = await getPlan(user.id, plan.id);
    const repeated = owned?.uinAiScreens?.find((screen) => screen.id === `uinai-${requestId}`);
    if (repeated && owned) {
      return NextResponse.json({ screen: repeated, cost: 0, savedAt: owned.updatedAt });
    }
    const planToSave: Plan = owned
      ? {
          ...plan,
          chat: owned.chat,
          comments: owned.comments,
          versions: owned.versions,
          uinAiScreens: owned.uinAiScreens,
        }
      : plan;
    const sourceAlreadyMatches =
      owned &&
      uinAiSourceSignature(owned, page.id) === uinAiSourceSignature(plan, page.id);
    if (!sourceAlreadyMatches && !(await savePlan(user.id, planToSave))) {
      return NextResponse.json(
        { error: '다른 곳에서 더 새롭게 수정된 플랜이 있습니다. 동기화 후 다시 시도해 주세요.' },
        { status: 409 },
      );
    }
  } catch (error) {
    console.error('[uinai] 플랜 소유권·동기화 확인 실패:', error);
    return NextResponse.json({ error: '플랜을 확인하지 못했습니다.' }, { status: 503 });
  }

  const aiRuntime = await readAiRuntime();
  const cost = costWithEngine(UINAI_CREDIT_COST, engine);
  const provider = resolveProvider(engine, aiRuntime.config, aiRuntime.apiKey);
  if (provider.id === 'local') {
    return NextResponse.json(
      { error: '지금은 UinAI를 쓸 수 없습니다. AI 설정을 확인해 주세요.' },
      { status: 503 },
    );
  }

  const prompt = buildUinAiPrompt(plan, page, emphasis, skill);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: '화면 기획이 너무 길어 UinAI에 보낼 수 없습니다.' }, { status: 413 });
  }

  let reservation;
  try {
    reservation = await reserveCredits(user.id, 'uinai', cost);
  } catch (error) {
    console.error('[uinai] 크레딧 예약 실패:', error);
    return NextResponse.json({ error: '크레딧을 확인하지 못했습니다.' }, { status: 503 });
  }
  if (!reservation.ok && reservation.reason === 'missing-user') {
    return NextResponse.json({ error: '로그인이 풀렸습니다. 다시 로그인해 주세요.' }, { status: 401 });
  }
  if (!reservation.ok) {
    return NextResponse.json(
      { error: '크레딧이 부족합니다. 내일 다시 충전됩니다.' },
      { status: 402 },
    );
  }

  try {
    const draft = await generateJson<UinAiDraft>({
      system: UINAI_SYSTEM_PROMPT,
      prompt,
      schema: UINAI_SCREEN_SCHEMA,
      maxTokens: Math.min(10_000, provider.maxOutputTokens),
      engine,
      config: aiRuntime.config,
      apiKey: aiRuntime.apiKey,
      signal: request.signal,
    });

    const html = normalizedHtml(draft.html);
    const filePart = safeFilePart(page.id);
    const wireframe = plan.wireframes.find((item) => item.pageId === page.id);
    const screen: UinAiScreen = {
      id: `uinai-${requestId}`,
      pageId: page.id,
      wireframeId: wireframe?.id ?? null,
      name: page.name,
      route: page.path,
      device: deviceOf(plan, page),
      engine,
      emphasis,
      skill,
      generatedAt: new Date().toISOString(),
      entryFile: `screens/${filePart}.html`,
      files: [{ path: `screens/${filePart}.html`, language: 'html', content: html }],
      summary: typeof draft.summary === 'string' ? draft.summary.trim().slice(0, 1_000) : '',
      implementationNotes: notesOf(draft.implementationNotes),
      sourceSignature: uinAiSourceSignature(plan, page.id),
    };

    const saved = await saveUinAiScreen(user.id, plan.id, screen);
    if (!saved.ok) {
      await releaseCreditReservation(user.id, reservation.id);
      const message =
        saved.reason === 'missing-page'
          ? '만드는 동안 화면이 삭제되었습니다. 다시 선택해 주세요.'
          : saved.reason === 'too-large'
            ? '이 플랜에 저장된 UinAI 화면 용량이 가득 찼습니다.'
            : '만드는 동안 플랜이 삭제되었습니다.';
      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json({ screen, cost, savedAt: saved.updatedAt });
  } catch (error) {
    await releaseCreditReservation(user.id, reservation.id).catch((releaseError) => {
      console.error('[uinai] 실패한 요청의 크레딧 예약을 되돌리지 못했습니다:', releaseError);
    });
    return NextResponse.json({ error: aiErrorMessage(error) }, { status: 502 });
  }
}
