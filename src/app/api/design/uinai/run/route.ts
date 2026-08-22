import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { generateJson } from '@/lib/ai/client';
import { isEngineTier, type EngineTier } from '@/lib/ai/engines';
import { AiError, aiErrorMessage } from '@/lib/ai/errors';
import { resolveProvider } from '@/lib/ai/provider';
import { maxTokensFor } from '@/lib/jobs/queue';
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
import {
  composeScreenCss,
  stripRootBlocks,
  stripStyleTags,
} from '@/lib/design/uniai-tokens';
import { UINAI_HARD_RULES, UINAI_SOFT_RULES } from '@/lib/design/uniai-style';
import {
  normalizeUinAiJavaScript,
  sanitizeUinAiCss,
  sanitizeUinAiHtml,
  UINAI_FILE_CHAR_LIMIT,
  uinAiSourceSignature,
} from '@/lib/design/uinai';
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
const FAILURE_COOLDOWN_MS = 30_000;
const failureCooldowns = new Map<string, number>();

interface RunBody {
  plan?: Plan;
  pageId?: string;
  requestId?: unknown;
  engine?: unknown;
  emphasis?: unknown;
  skill?: unknown;
  device?: unknown;
}

interface UinAiDraft {
  html?: unknown;
  css?: unknown;
  javascript?: unknown;
  summary?: unknown;
  implementationNotes?: unknown;
}

function draftOf(value: unknown): UinAiDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiError('format', 'UniAI 응답이 JSON 객체가 아님');
  }
  const draft = value as UinAiDraft;
  if (
    typeof draft.html !== 'string' ||
    typeof draft.css !== 'string' ||
    !draft.css.trim() ||
    typeof draft.javascript !== 'string'
  ) {
    throw new AiError('format', 'UniAI HTML·CSS·JavaScript 필드가 올바르지 않음');
  }
  return draft;
}

function deviceOf(plan: Plan, page: IaPage, requested?: unknown): 'mobile' | 'desktop' {
  if (requested === 'mobile' || requested === 'desktop') return requested;
  const wireframe = plan.wireframes.find((item) => item.pageId === page.id);
  if (wireframe?.device === 'mobile') return 'mobile';
  if (wireframe?.device === 'desktop') return 'desktop';
  return plan.brief.platform === 'app' ? 'mobile' : 'desktop';
}

function normalizedHtml(value: unknown): string {
  if (typeof value !== 'string') throw new AiError('format', 'UniAI HTML이 문자열이 아님');
  let html = value.trim();
  const fenced = /^```(?:html)?\s*([\s\S]*?)```$/i.exec(html);
  if (fenced) html = fenced[1].trim();
  // 스타일은 css 필드의 몫이다. body 안의 <style> 이 남으면 미리보기에서
  // 토큰 CSS 보다 뒤에 읽혀 값을 덮어 쓰므로, 여기서 구조만 남긴다.
  html = stripStyleTags(html);
  try {
    return sanitizeUinAiHtml(html);
  } catch (error) {
    throw new AiError('format', error instanceof Error ? error.message : 'HTML 안전화 실패');
  }
}

function normalizedCss(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    // 토큰 블록은 서버가 CSS 앞에 심는다. 모델이 :root 를 다시 선언하면
    // 뒤에 와서 서버 값을 덮어 쓰므로, 모델 산출물의 :root 는 무조건 제거.
    return stripRootBlocks(sanitizeUinAiCss(value));
  } catch (error) {
    throw new AiError('format', error instanceof Error ? error.message : 'CSS 안전화 실패');
  }
}

function normalizedJavaScript(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return normalizeUinAiJavaScript(value);
  } catch (error) {
    throw new AiError('format', error instanceof Error ? error.message : 'JavaScript 정규화 실패');
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

/** 토큰 사용 품질 측정 — var() 참조 수와 하드코딩 색 수. */
function tokenUsageQuality(css: string): { varUses: number; hardcoded: number } {
  return {
    varUses: (css.match(/var\(--/g) ?? []).length,
    hardcoded: (css.match(/#[0-9a-fA-F]{3,6}\b|rgb\(/g) ?? []).length,
  };
}

/**
 * 토큰을 거의 쓰지 않은 결과를 **한 번만** 고쳐 본다.
 *
 * 형식은 맞는데 디자인 토큰이 안 지켜진 경우다. 구조(HTML)는 유지하고
 * 스타일만 var(--*) 로 다시 쓰게 한다. 실패하면 원본을 쓴다 — 토큰 블록은
 * 어차피 서버가 심으므로 하한선은 보장된다.
 */
async function correctWithTokens(options: {
  prompt: string;
  aiRuntime: Awaited<ReturnType<typeof readAiRuntime>>;
  engine: EngineTier;
  signal: AbortSignal;
}): Promise<string | null> {
  const provider = resolveProvider(options.engine, options.aiRuntime.config, options.aiRuntime.apiKey);
  const correctivePrompt = [
    options.prompt,
    '',
    '## 토큰 사용 수정 재시도',
    '앞선 결과의 CSS가 디자인 토큰(var(--*))을 거의 사용하지 않았습니다.',
    'HTML 구조는 그대로 두고, css의 모든 색·간격·모서리·글자 크기·그림자를 var(--*) 참조로 다시 작성하세요. :root는 선언하지 마세요.',
  ].join('\n');
  const draft = draftOf(
    await generateJson<unknown>({
      system: UINAI_SYSTEM_PROMPT,
      prompt: correctivePrompt,
      schema: UINAI_SCREEN_SCHEMA,
      maxTokens: maxTokensFor('wireframe', provider.maxOutputTokens),
      engine: options.engine,
      effort: options.engine === 'advanced' ? 'high' : 'medium',
      config: options.aiRuntime.config,
      apiKey: options.aiRuntime.apiKey,
      signal: options.signal,
      retryFormat: false,
    }),
  );
  try {
    return normalizedCss(draft.css) || null;
  } catch {
    return null;
  }
}

/**
 * 고급 엔진 정제 패스 — "비평 → 재작성".
 *
 * 비평 없이 "더 예쁘게"만 시키면 거의 달라지지 않는다(무방향 재시도는 효과가
 * 1.5% 수준). 그래서 디자인 리뷰어 역할로 먼저 비평 기준을 주고, 그 기준으로
 * 개선한 CSS 전문만 받는다. 실패해도 1차 결과를 쓴다 — 정제는 베스트에포트.
 */
const UINAI_REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    css: {
      type: 'string',
      description: '비평을 반영해 개선한 CSS 전문. 기존 선택자를 보존한다.',
    },
  },
  required: ['css'],
} as const;

async function refineCss(options: {
  html: string;
  css: string;
  aiRuntime: Awaited<ReturnType<typeof readAiRuntime>>;
  engine: EngineTier;
  signal: AbortSignal;
}): Promise<string | null> {
  const provider = resolveProvider(options.engine, options.aiRuntime.config, options.aiRuntime.apiKey);
  const prompt = [
    '당신은 시니어 디자인 리뷰어입니다. 아래 HTML과 CSS를 비평하고, 비평을 반영해 개선한 CSS 전문만 반환하세요.',
    '',
    UINAI_HARD_RULES,
    '',
    UINAI_SOFT_RULES,
    '',
    '비평 항목: 색 일관성 · 타입 위계 · 간격 리듬 · hover/focus/disabled/empty 상태 커버리지 · 모바일/데스크톱 반응형.',
    '기존 CSS의 모든 선택자를 보존하되 문제가 있는 규칙만 고치거나 덧붙입니다. var(--*) 참조는 그대로 유지합니다.',
    '',
    '## HTML',
    options.html,
    '',
    '## CSS',
    options.css,
    '',
    '응답: {"css": "개선한 CSS 전문"}',
  ].join('\n');

  const raw = await generateJson<{ css?: unknown }>({
    system: '당신은 디자인 토큰 시스템을 정확히 지키는 프론트엔드 디자인 리뷰어입니다.',
    prompt,
    schema: UINAI_REFINE_SCHEMA,
    maxTokens: maxTokensFor('wireframe', provider.maxOutputTokens),
    engine: options.engine,
    effort: 'high',
    config: options.aiRuntime.config,
    apiKey: options.aiRuntime.apiKey,
    signal: options.signal,
    retryFormat: false,
  });
  if (typeof raw.css !== 'string' || !raw.css.trim()) return null;
  try {
    return normalizedCss(raw.css) || null;
  } catch {
    return null;
  }
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
      { error: '지금은 UniAI를 쓸 수 없습니다. AI 설정을 확인해 주세요.' },
      { status: 503 },
    );
  }

  const retryAt = failureCooldowns.get(user.id) ?? 0;
  if (retryAt > Date.now()) {
    return NextResponse.json(
      { error: '방금 생성 실패를 확인했습니다. 잠시 후 다시 시도해 주세요.', code: 'cooldown' },
      { status: 429 },
    );
  }
  failureCooldowns.delete(user.id);

  const targetDevice = deviceOf(plan, page, body.device);
  const prompt = buildUinAiPrompt(plan, page, emphasis, skill, targetDevice);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: '화면 기획이 너무 길어 UniAI에 보낼 수 없습니다.' }, { status: 413 });
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
    // Vercel 함수가 강제로 끝나기 전에 오류 응답과 크레딧 반환을 마칠 시간을 남긴다.
    const generationSignal = AbortSignal.any([request.signal, AbortSignal.timeout(235_000)]);
    let draft: UinAiDraft | null = null;
    let html = '';
    let css = '';
    let javascript = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        draft = draftOf(
          await generateJson<unknown>({
            system: UINAI_SYSTEM_PROMPT,
            prompt:
              attempt === 0
                ? prompt
                : `${prompt}\n\n## 형식 수정 재시도\n앞선 결과의 형식이나 안전 규칙이 맞지 않았습니다. html, css, javascript 키를 정확히 쓰고 외부 자원 없이 더 간결하게 다시 작성하세요.`,
            schema: UINAI_SCREEN_SCHEMA,
            // UniAI도 다른 생성 경로와 같이 DeepSeek 384K를 요청한다. 코드 프롬프트의
            // 분량 지침은 결과 품질을 위한 것이며, 출력 상한을 낮추는 용도가 아니다.
            maxTokens: maxTokensFor('wireframe', provider.maxOutputTokens),
            engine,
            effort: engine === 'advanced' ? 'high' : 'medium',
            config: aiRuntime.config,
            apiKey: aiRuntime.apiKey,
            signal: generationSignal,
            // 이 라우트가 스키마·안전화까지 포함해 총 두 번만 시도한다.
            retryFormat: false,
          }),
        );
        html = normalizedHtml(draft.html);
        css = normalizedCss(draft.css);
        javascript = normalizedJavaScript(draft.javascript);
        break;
      } catch (error) {
        if (attempt === 0 && error instanceof AiError && error.kind === 'format') continue;
        throw error;
      }
    }
    if (!draft || !html) throw new AiError('format', 'UniAI 코드가 비어 있음');

    // 고급 엔진은 만든 뒤 디자인 리뷰어가 한 번 더 다듬는다. 실패해도 1차 결과 유지.
    if (engine === 'advanced') {
      try {
        const refined = await refineCss({
          html,
          css,
          aiRuntime,
          engine,
          signal: generationSignal,
        });
        if (refined) css = refined;
      } catch (error) {
        console.warn(
          '[uinai] 정제 패스를 건너뛰고 1차 결과를 유지합니다:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    // 토큰 사용 품질 게이트 — var() 를 거의 안 쓴 결과는 한 번만 고쳐 본다.
    {
      const quality = tokenUsageQuality(css);
      if (quality.varUses < 8 || quality.hardcoded > quality.varUses) {
        try {
          const corrected = await correctWithTokens({
            prompt,
            aiRuntime,
            engine,
            signal: generationSignal,
          });
          if (corrected) {
            const after = tokenUsageQuality(corrected);
            if (after.varUses > quality.varUses) {
              console.warn(
                `[uinai] 토큰 사용이 낮아 교정했습니다 (var ${quality.varUses}→${after.varUses}).`,
              );
              css = corrected;
            }
          }
        } catch (error) {
          console.warn(
            '[uinai] 토큰 교정 재시도를 건너뜁니다:',
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    // 토큰 블록은 서버가 직접 심는다 — 모델 CSS 는 var() 참조만 하면 된다.
    // 정제를 거친 CSS 도 반드시 이 출구를 지나야 토큰 블록이 유지된다.
    const composedCss = css ? composeScreenCss(skill, css) : '';
    if (composedCss.length > UINAI_FILE_CHAR_LIMIT) {
      throw new AiError('too-long', '토큰을 포함한 CSS가 길이 한도를 넘습니다.');
    }

    const filePart = safeFilePart(page.id);
    const basePath = `screens/${filePart}`;
    const wireframe = plan.wireframes.find((item) => item.pageId === page.id);
    const files: UinAiScreen['files'] = [
      { path: `${basePath}/index.html`, language: 'html', content: html },
    ];
    if (composedCss) {
      files.push({ path: `${basePath}/styles.css`, language: 'css', content: composedCss });
    }
    if (javascript) files.push({ path: `${basePath}/app.js`, language: 'js', content: javascript });
    const screen: UinAiScreen = {
      id: `uinai-${requestId}`,
      pageId: page.id,
      wireframeId: wireframe?.id ?? null,
      name: page.name,
      route: page.path,
      device: targetDevice,
      engine,
      emphasis,
      skill,
      generatedAt: new Date().toISOString(),
      entryFile: `${basePath}/index.html`,
      files,
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
            ? '이 플랜에 저장된 UniAI 화면 용량이 가득 찼습니다.'
            : '만드는 동안 플랜이 삭제되었습니다.';
      return NextResponse.json({ error: message }, { status: 409 });
    }

    failureCooldowns.delete(user.id);
    return NextResponse.json({ screen, cost, savedAt: saved.updatedAt });
  } catch (error) {
    await releaseCreditReservation(user.id, reservation.id).catch((releaseError) => {
      console.error('[uinai] 실패한 요청의 크레딧 예약을 되돌리지 못했습니다:', releaseError);
    });
    const code = error instanceof AiError ? error.kind : 'unknown';
    if (code === 'format' || code === 'too-long' || code === 'unknown') {
      failureCooldowns.set(user.id, Date.now() + FAILURE_COOLDOWN_MS);
    }
    const message =
      code === 'too-long'
        ? '화면 코드가 길어 완성되지 않았습니다. 코드 길이를 줄여 다시 시도해 주세요.'
        : aiErrorMessage(error);
    const status =
      code === 'config'
        ? 503
        : code === 'busy'
          ? 429
          : code === 'too-long' || code === 'format' || code === 'refused'
            ? 422
            : 502;
    console.error('[uinai] 화면 생성 실패', { requestId, pageId: page.id, engine, code });
    return NextResponse.json({ error: message, code, requestId }, { status });
  }
}
