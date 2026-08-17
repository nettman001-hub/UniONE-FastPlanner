#!/usr/bin/env node
/**
 * AI 공급자 연결 점검.
 *
 *   npm run check:ai
 *
 * .env.local 을 읽어 실제로 한 번 호출해 보고, 무엇이 잘못됐는지 알려준다.
 * 앱을 띄우기 전에 키·모델·네트워크를 먼저 확인하는 용도.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* --- .env 로드 ----------------------------------------------------- */

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** 어느 파일에서 읽었는지 — 화면에 밝힌다. */
const loadedFrom = [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')].filter(
  (f) => existsSync(f),
);
loadEnv(resolve(process.cwd(), '.env.local'));
loadEnv(resolve(process.cwd(), '.env'));

/* --- 공급자 결정 (src/lib/ai/provider.ts 와 같은 규칙) --------------- */

const env = (name) => (process.env[name] ?? '').trim();
const forced = env('AI_PROVIDER').toLowerCase();
const deepseekKey = env('DEEPSEEK_API_KEY');
const anthropicKey = env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN');

let provider = 'local';
if (forced === 'local') provider = 'local';
else if (forced === 'deepseek') provider = deepseekKey ? 'deepseek' : 'local';
else if (forced === 'anthropic') provider = anthropicKey ? 'anthropic' : 'local';
else if (deepseekKey) provider = 'deepseek';
else if (anthropicKey) provider = 'anthropic';

const mask = (key) => (key ? `${key.slice(0, 6)}…${key.slice(-4)} (${key.length}자)` : '(없음)');

console.log('── AI 공급자 점검 ──────────────────────────────');
console.log(`AI_PROVIDER   : ${forced || '(미지정 — 자동 선택)'}`);
console.log(`선택된 공급자 : ${provider}`);

if (provider === 'local') {
  console.log('');
  console.log('내장 생성기로 동작합니다. 앱의 모든 기능은 그대로 쓸 수 있지만,');
  console.log('산출물은 규칙 기반 템플릿으로 만들어집니다.');
  console.log('DeepSeek 을 쓰려면 .env.local 에 DEEPSEEK_API_KEY 를 넣어 주세요.');
  process.exit(0);
}

if (provider === 'anthropic') {
  console.log(`모델          : ${env('ANTHROPIC_MODEL') || 'claude-opus-5'}`);
  console.log(`API 키        : ${mask(anthropicKey)}`);
  console.log('');
  console.log('Anthropic 경로는 이 스크립트에서 호출 검증하지 않습니다.');
  console.log('앱을 띄운 뒤 개요 화면에서 [AI로 생성] 을 눌러 확인해 주세요.');
  process.exit(0);
}

/* --- DeepSeek 실호출 ---------------------------------------------- */

const baseUrl = (env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '');
/*
 * 등급별 모델. 고르는 규칙은 `src/lib/ai/provider.ts` 와 **같아야 한다** —
 * 여기서 통과했는데 앱에서 다른 모델을 부르면 점검이 거짓말을 하는 셈이다.
 */
const models = {
  기본: env('DEEPSEEK_MODEL_BASIC') || 'deepseek-v4-flash',
  고급: env('DEEPSEEK_MODEL_ADVANCED') || env('DEEPSEEK_MODEL') || 'deepseek-v4-pro',
};
/** 실제로 부를 때 쓸 것 — 가벼운 쪽으로 검사한다. */
const model = models.기본;
const maxTokens = Number.parseInt(env('DEEPSEEK_MAX_TOKENS') || '8192', 10) || 8192;

console.log(`Base URL      : ${baseUrl}`);
console.log(`기본 엔진     : ${models.기본}`);
console.log(`고급 엔진     : ${models.고급}${models.기본 === models.고급 ? '  ⚠ 기본과 같습니다' : ''}`);
console.log(`출력 상한     : ${maxTokens} 토큰`);
console.log(`API 키        : ${mask(deepseekKey)}`);
console.log('');
/*
 * 이 스크립트는 **이 컴퓨터의 파일**만 읽는다. Vercel 환경변수를 바꾼 뒤 여기서
 * 확인하면 예전 값이 그대로 나와 "안 바뀌었다" 고 오해하게 된다. 실제로 그랬다.
 */
console.log(`설정을 읽은 곳: ${loadedFrom.length > 0 ? loadedFrom.join(', ') : '(파일 없음 — 셸 환경변수만)'}`);
console.log('배포된 사이트의 설정은 여기에 안 나옵니다.');
console.log('  → 배포본 확인: https://<배포주소>/api/status?check=1');
console.log('');

const auth = { Authorization: `Bearer ${deepseekKey}`, 'Content-Type': 'application/json' };
let failed = false;

async function step(name, fn) {
  process.stdout.write(`▶ ${name} … `);
  try {
    const detail = await fn();
    console.log(`ok${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (error) {
    failed = true;
    console.log(`실패\n  ${error.message}`);
    return false;
  }
}

async function readError(response) {
  const body = await response.text().catch(() => '');
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message ?? message;
  } catch {
    /* 본문이 JSON 이 아니면 원문을 그대로 쓴다 */
  }
  return `HTTP ${response.status} — ${message}`;
}

const reachable = await step('엔드포인트 연결 및 모델 목록', async () => {
  const response = await fetch(`${baseUrl}/models`, { headers: auth });
  if (response.status === 401) throw new Error('API 키가 거부되었습니다 (401). 키를 다시 확인해 주세요.');
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  const ids = (data?.data ?? []).map((m) => m.id);
  if (ids.length === 0) return '모델 목록 비어 있음(건너뜀)';

  // 두 등급을 **모두** 본다. 하나만 보면 고급만 틀린 경우를 놓친다.
  const missing = Object.entries(models).filter(([, id]) => !ids.includes(id));
  if (missing.length > 0) {
    const envName = { 기본: 'DEEPSEEK_MODEL_BASIC', 고급: 'DEEPSEEK_MODEL_ADVANCED' };
    throw new Error(
      missing.map(([tier, id]) => `${tier} 엔진 '${id}' 이(가) 목록에 없습니다.`).join('\n  ') +
        `\n  사용 가능: ${ids.join(', ')}` +
        `\n  .env.local 의 ${missing.map(([tier]) => envName[tier]).join(' · ')} 을(를) 위 목록 중 하나로 바꿔 주세요.`,
    );
  }
  return `사용 가능 모델 ${ids.length}개 · 두 등급 모두 있음`;
});

if (reachable) {
  await step('JSON 모드 생성 (response_format)', async () => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        model,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '너는 JSON 만 출력하는 도우미다.' },
          {
            role: 'user',
            content:
              '아래 스키마를 만족하는 JSON 하나만 출력해라. ' +
              '{"type":"object","properties":{"ok":{"type":"boolean"},"note":{"type":"string"}},"required":["ok","note"]}',
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text);
    if (typeof parsed.ok !== 'boolean') throw new Error(`예상과 다른 응답: ${text.slice(0, 120)}`);
    const usage = data?.usage;
    return usage ? `토큰 ${usage.prompt_tokens}→${usage.completion_tokens}` : 'JSON 파싱 성공';
  });

  /*
   * 추론 강도를 **어느 단계까지 받는지** 확인한다.
   *
   * 앱은 `max → xhigh → high` 순으로 시도하다가 거부당하면 한 칸 내려오고,
   * 다 떨어지면 파라미터를 빼고 부른다. 생성이 멈추지 않으니 조용히 넘어가는데,
   * **조용하면 낮은 값으로 도는 줄도 모른다.** 여기서 한 번 드러내 준다.
   */
  await step('추론 강도 (reasoning_effort)', async () => {
    const ladder = env('DEEPSEEK_REASONING_EFFORT')
      ? [env('DEEPSEEK_REASONING_EFFORT')]
      : ['max', 'xhigh', 'high'];
    const rejected = [];
    for (const level of ladder) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          model,
          max_tokens: 16,
          reasoning_effort: level,
          messages: [{ role: 'user', content: '1+1 은? 숫자만.' }],
        }),
      });
      if (response.ok) {
        return rejected.length === 0
          ? `'${level}' 로 동작합니다 (가장 높은 단계)`
          : `'${level}' 로 동작합니다 — ${rejected.join(', ')} 은(는) 거부됨`;
      }
      const detail = await readError(response);
      if (!/reasoning[_ ]?effort/i.test(detail)) throw new Error(detail);
      rejected.push(`'${level}'`);
    }
    // 전부 거부당하는 것도 정상 동작이다 — 앱이 파라미터를 빼고 부른다.
    return `이 엔드포인트는 안 받습니다 (${rejected.join(', ')}). 파라미터 없이 만듭니다.`;
  });

  await step('잔액 조회', async () => {
    const response = await fetch(`${baseUrl}/user/balance`, { headers: auth });
    if (response.status === 404) return '이 엔드포인트는 잔액 조회를 지원하지 않음(건너뜀)';
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    const info = data?.balance_infos?.[0];
    return info ? `${info.total_balance} ${info.currency}` : JSON.stringify(data).slice(0, 120);
  });
}

console.log('');
if (failed) {
  console.log('일부 점검이 실패했습니다. 위 메시지를 확인해 주세요.');
  console.log('연결 자체가 안 되면 사내 프록시·방화벽이 api.deepseek.com 을 막고 있는지 확인하세요.');
  process.exit(1);
}
console.log('모두 통과했습니다. npm run dev 로 앱을 띄우면 DeepSeek 으로 산출물을 생성합니다.');
