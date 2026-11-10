/** 실행: npx tsx scripts/qa/qa-admin-plan-api.ts — 임시 프로젝트·PGlite로 실제 Next API를 검증한다. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { signSession } from '../../src/lib/auth/session';
import { SCHEMA_SQL } from '../../src/lib/db/schema';
import { emptyDocuments, type Plan, type PlanVersion } from '../../src/lib/types';

const ADMIN = { id: 'qa-admin', email: 'admin@qa.invalid', name: 'QA 관리자' };
const TARGET = { id: 'qa-target', email: 'target@qa.invalid', name: 'QA 사용자' };
const ORDINARY = { id: 'qa-ordinary', email: 'ordinary@qa.invalid', name: 'QA 일반 사용자' };
const PLAN_ID = 'qa-shared-plan';
const QA_SECRET = 'isolated-admin-plan-api-qa-secret-only';

function fixture(title: string): Plan {
  return {
    ...emptyDocuments(), id: PLAN_ID,
    brief: { title, oneLiner: 'API 회귀 검증', idea: '격리된 검증 데이터', targetUser: '검증 사용자', purpose: '접근 제어 검증', platform: 'web' },
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    generated: { prd: true, fs: false, ia: false, flow: false, wireframe: false },
    chat: [], comments: [], versions: [],
  };
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || !child.pid) return;
  const exited = once(child, 'exit').then(() => undefined);
  if (process.platform === 'win32') {
    // PID는 이 스크립트가 직접 생성한 Next 프로세스만 사용한다.
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    await once(killer, 'exit');
  } else {
    // detached로 만든 이 작업의 프로세스 그룹만 종료한다.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  await Promise.race([exited, delay(10_000)]);
}

async function run() {
  const workspace = process.cwd();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'uniboard-admin-api-qa-'));
  const project = path.join(temporary, 'app');
  const dbDir = path.join(temporary, 'database');
  let next: ChildProcess | undefined;
  let seed: PGlite | undefined;
  const previousSecret = process.env.AUTH_SECRET;
  let passed = 0;
  const check = (name: string, assertion: () => void) => {
    assertion();
    passed += 1;
    console.log(`PASS ${name}`);
  };
  try {
    await mkdir(project);
    for (const name of ['src', 'package.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts']) {
      await cp(path.join(workspace, name), path.join(project, name), { recursive: name === 'src' });
    }
    await symlink(path.join(workspace, 'node_modules'), path.join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    seed = await PGlite.create(dbDir);
    await seed.exec(SCHEMA_SQL);
    for (const user of [ADMIN, TARGET, ORDINARY]) {
      await seed.query('insert into users (id,email,name) values ($1,$2,$3)', [user.id, user.email, user.name]);
    }
    const targetPlan = fixture('사용자 원본');
    targetPlan.versions = Array.from({ length: 12 }, (_, index) => ({
      id: `legacy-large-${index}`, label: `기존 큰 버전 ${index}`, createdAt: targetPlan.createdAt,
      snapshot: { ...emptyDocuments(), prd: { ...emptyDocuments().prd, overview: `legacy-${index}:` + 'L'.repeat(512 * 1024) }, futureOptional: { preserved: true } },
    }));
    assert.ok(Buffer.byteLength(JSON.stringify(targetPlan)) > 5 * 1024 * 1024, '이관 전 실제 플랜 본문이 5MiB보다 커야 합니다.');
    const adminPlan = fixture('관리자 별도 원본');
    for (const [user, plan] of [[ADMIN, adminPlan], [TARGET, targetPlan]] as const) {
      await seed.query('insert into plans (id,user_id,title,data,updated_at) values ($1,$2,$3,$4,$5)',
        [plan.id, user.id, plan.brief.title, JSON.stringify(plan), plan.updatedAt]);
    }
    await seed.query('insert into credit_usage (user_id,kind,amount) values ($1,$2,$3),($4,$5,$6)', [TARGET.id, 'chat', 7, ADMIN.id, 'chat', 2]);
    await seed.query('insert into skills (user_id,plan_id,artifact,body) values ($1,$2,$3,$4),($5,$6,$7,$8)',
      [TARGET.id, PLAN_ID, 'fs', '사용자 기존 지침', ADMIN.id, PLAN_ID, 'fs', '관리자 기존 지침']);
    await seed.close();
    seed = undefined;

    process.env.AUTH_SECRET = QA_SECRET;
    const tokens = new Map<string, string>();
    for (const user of [ADMIN, TARGET, ORDINARY]) {
      tokens.set(user.id, await signSession({ uid: user.id, email: user.email, name: user.name }));
    }
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'development', DATABASE_URL: '', PGLITE_DIR: dbDir,
      AUTH_SECRET: QA_SECRET, ADMIN_EMAILS: ADMIN.email, AI_PROVIDER: 'local',
      DEEPSEEK_API_KEY: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', OPENAI_API_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1',
    };
    delete env.VERCEL;
    next = spawn(process.execPath, [path.join(workspace, 'node_modules/next/dist/bin/next'), 'dev', project, '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: project, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 본문·쿠키·키를 출력하지 않는다. 서버 준비 여부만 메모리에 보관한다.
    let startupError = false;
    next.once('error', () => { startupError = true; });
    next.stdout?.on('data', () => {});
    next.stderr?.on('data', () => {});
    const readyDeadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < readyDeadline && !startupError && next.exitCode === null) {
      try {
        const response = await fetch(`${origin}/api/credits`, { signal: AbortSignal.timeout(15_000) });
        if (response.status === 401) { ready = true; break; }
      } catch { /* 최초 컴파일·서버 기동을 기다린다. */ }
      await delay(300);
    }
    assert.ok(ready, '격리된 Next 서버가 준비되지 않았습니다.');

    const call = async (endpoint: string, options: {
      actor?: typeof ADMIN; scoped?: boolean; body?: unknown; method?: string;
      selectedPlanId?: string; ownerId?: string;
    } = {}) => {
      const headers = new Headers({ 'content-type': 'application/json' });
      if (options.actor) headers.set('cookie', `fp_session=${tokens.get(options.actor.id)}`);
      if (options.scoped) {
        headers.set('x-admin-user-id', options.ownerId ?? TARGET.id);
        headers.set('x-admin-plan-id', options.selectedPlanId ?? PLAN_ID);
      }
      const response = await fetch(`${origin}${endpoint}`, {
        method: options.method ?? 'GET', headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(90_000),
      });
      const contentType = response.headers.get('content-type') ?? '';
      assert.ok(contentType.includes('application/json'), `${endpoint}: JSON 응답이어야 합니다 (상태 ${response.status}).`);
      return { status: response.status, body: await response.json() };
    };
    const scoped = { actor: ADMIN, scoped: true };
    const endpoint = `/api/plans/${PLAN_ID}`;

    const opened = await call(endpoint, scoped);
    check('관리자는 복사본 없이 사용자의 원본 플랜을 연다', () => {
      assert.equal(opened.status, 200);
      assert.equal(opened.body.plan.brief.title, '사용자 원본');
      assert.deepEqual(opened.body.owner, TARGET);
      assert.equal(opened.body.plan.versions.length, 12);
      assert.ok(opened.body.plan.versions.every((version: PlanVersion) => !Object.hasOwn(version, 'snapshot')));
      assert.ok(Buffer.byteLength(JSON.stringify(opened.body)) < 512 * 1024, '6MiB 이상의 내장 이력을 작은 현재 플랜 응답으로 분리한다.');
    });
    const changed = structuredClone(opened.body.plan) as Plan;
    changed.brief.title = '관리자가 사용자 원본을 수정함';
    changed.prd.overview = '표준 편집기의 저장 왕복 검증';
    changed.updatedAt = new Date().toISOString();
    const saved = await call(endpoint, { ...scoped, method: 'PUT', body: { plan: changed } });
    check('관리자 지원 편집 저장 성공', () => {
      assert.equal(saved.status, 200);
      assert.equal(saved.body.applied, true);
    });
    const targetOwn = await call(endpoint, { actor: TARGET });
    const adminOwn = await call(endpoint, { actor: ADMIN });
    check('사용자 본인 재조회에 수정이 보이고 관리자 동명 플랜은 유지된다', () => {
      assert.equal(targetOwn.body.plan.brief.title, changed.brief.title);
      assert.equal(targetOwn.body.plan.prd.overview, changed.prd.overview);
      assert.equal(adminOwn.body.plan.brief.title, '관리자 별도 원본');
      assert.equal(adminOwn.body.plan.prd.overview, '');
      assert.equal(targetOwn.body.owner, undefined);
      assert.equal(adminOwn.body.owner, undefined);
    });

    const spoof = await call(endpoint, { actor: ORDINARY, scoped: true });
    const routeMismatch = await call('/api/plans/another-plan', scoped);
    const bodyMismatch = await call('/api/chat', { ...scoped, method: 'POST', body: { plan: { ...changed, id: 'another-plan' }, message: '검증' } });
    const saveBodyMismatch = await call(endpoint, { ...scoped, method: 'PUT', body: { plan: { ...changed, id: 'another-plan' } } });
    check('일반 계정 위조와 범위·라우트·본문 ID 불일치를 거절한다', () => {
      assert.equal(spoof.status, 404);
      assert.equal(routeMismatch.status, 404);
      assert.equal(bodyMismatch.status, 404);
      assert.equal(saveBodyMismatch.status, 404);
    });

    const scopedCredits = await call('/api/credits', scoped);
    const adminCredits = await call('/api/credits', { actor: ADMIN });
    check('지원 탭 크레딧은 사용자의 잔량이고 관리자 잔량과 분리된다', () => {
      assert.equal(scopedCredits.body.used, 7);
      assert.equal(scopedCredits.body.remaining, 193);
      assert.equal(adminCredits.body.used, 2);
      assert.equal(adminCredits.body.remaining, 198);
    });
    const settingsSaved = await call('/api/settings', { ...scoped, method: 'PATCH', body: { agentEngine: 'advanced', engines: { fs: 'advanced' } } });
    const targetSettings = await call('/api/settings', { actor: TARGET });
    const adminSettings = await call('/api/settings', { actor: ADMIN });
    check('지원 탭 엔진 설정 변경은 사용자 계정에만 반영된다', () => {
      assert.equal(settingsSaved.status, 200);
      assert.equal(targetSettings.body.settings.agentEngine, 'advanced');
      assert.equal(targetSettings.body.settings.engines.fs, 'advanced');
      assert.equal(adminSettings.body.settings.agentEngine, 'basic');
      assert.equal(adminSettings.body.settings.engines.fs, 'basic');
    });

    const skillSaved = await call('/api/skills', { ...scoped, method: 'PUT', body: { planId: PLAN_ID, artifact: 'fs', body: '지원 편집 지침', enabled: true } });
    const targetSkills = await call(`/api/skills?planId=${PLAN_ID}`, { actor: TARGET });
    const adminSkills = await call(`/api/skills?planId=${PLAN_ID}`, { actor: ADMIN });
    check('플랜별 기획 스킬을 원본 사용자 범위에만 저장한다', () => {
      assert.equal(skillSaved.status, 200);
      assert.equal(targetSkills.body.skills[0].body, '지원 편집 지침');
      assert.equal(adminSkills.body.skills[0].body, '관리자 기존 지침');
    });
    const localChat = await call('/api/chat', { ...scoped, method: 'POST', body: { plan: changed, message: '살아있니?' } });
    check('지원 탭 채팅 인증은 통과하고 외부 AI 없이 로컬 응답을 받는다', () => {
      assert.equal(localChat.status, 200);
      assert.equal(localChat.body.source, 'local');
      assert.equal(localChat.body.credits, 0);
      assert.ok(localChat.body.reply.includes(changed.brief.title));
    });

    const history = await call(`${endpoint}/versions`, scoped);
    const legacyDetail = await call(`${endpoint}/versions/legacy-large-0`, scoped);
    check('기존 6MiB 내장 이력은 목록·개별 스냅샷으로 나눠 원형 보존한다', () => {
      assert.equal(history.status, 200);
      assert.equal(history.body.versions.length, 12);
      assert.ok(history.body.versions.every((version: PlanVersion) => !Object.hasOwn(version, 'snapshot')));
      assert.equal(legacyDetail.status, 200);
      assert.deepEqual(legacyDetail.body.version.snapshot, targetPlan.versions[0].snapshot);
    });
    const uploaded: PlanVersion = { id: 'new-api-version', label: '개별 업로드', createdAt: new Date().toISOString(), snapshot: { ...emptyDocuments(), prd: { ...emptyDocuments().prd, overview: '개별 원본' } } };
    const versionPosted = await call(`${endpoint}/versions`, { ...scoped, method: 'POST', body: { version: uploaded } });
    const versionRetried = await call(`${endpoint}/versions/${uploaded.id}`, { ...scoped, method: 'PUT', body: { version: uploaded } });
    const afterVersion = await call(`${endpoint}/versions`, { actor: TARGET });
    const wrongOwnerVersion = await call(`${endpoint}/versions/${uploaded.id}`, { actor: ADMIN });
    check('개별 버전 업로드 재시도는 한 원본만 만들고 소유자를 분리한다', () => {
      assert.equal(versionPosted.status, 200);
      assert.equal(versionRetried.status, 200);
      assert.equal(afterVersion.body.versions.length, 13);
      assert.equal(afterVersion.body.versions.filter((version: PlanVersion) => version.id === uploaded.id).length, 1);
      assert.equal(wrongOwnerVersion.status, 404);
    });
    const conflicting = { ...uploaded, snapshot: { ...emptyDocuments(), prd: { ...emptyDocuments().prd, overview: '다른 본문' } } };
    const conflictingResult = await call(`${endpoint}/versions/${uploaded.id}`, { ...scoped, method: 'PUT', body: { version: conflicting } });
    const explicitDelete = await call(`${endpoint}/versions/${uploaded.id}`, { ...scoped, method: 'DELETE' });
    const deletedDetail = await call(`${endpoint}/versions/${uploaded.id}`, { actor: TARGET });
    const resurrect = await call(`${endpoint}/versions/${uploaded.id}`, { ...scoped, method: 'PUT', body: { version: uploaded } });
    check('다른 스냅샷 덮어쓰기와 명시적 삭제 후 재업로드를 거절한다', () => {
      assert.equal(conflictingResult.status, 409);
      assert.equal(explicitDelete.status, 200);
      assert.equal(explicitDelete.body.deleted, true);
      assert.equal(deletedDetail.status, 404);
      assert.equal(resurrect.status, 404);
    });
    const missingDelete = await call(`${endpoint}/versions/not-uploaded-yet`, { ...scoped, method: 'DELETE' });
    const missingLateUpload = await call(`${endpoint}/versions`, { ...scoped, method: 'POST', body: { version: { ...uploaded, id: 'not-uploaded-yet' } } });
    check('미전송 버전의 삭제가 늦게 도착한 업로드보다 우선한다', () => {
      assert.equal(missingDelete.status, 200);
      assert.equal(missingDelete.body.deleted, true);
      assert.equal(missingLateUpload.status, 404);
    });
    const page = await call('/api/plans?pageSize=1', { actor: TARGET });
    check('초기 플랜 동기화는 현재 문서를 한 플랜씩 읽고 이력 본문을 제외한다', () => {
      assert.equal(page.status, 200);
      assert.equal(page.body.plans.length, 1);
      assert.equal(page.body.nextCursor, null);
      assert.ok(page.body.plans[0].versions.every((version: PlanVersion) => !Object.hasOwn(version, 'snapshot')));
      assert.ok(Buffer.byteLength(JSON.stringify(page.body)) < 512 * 1024);
    });

    const rejectedRoutes: Array<[string, string, unknown?]> = [
      [endpoint, 'PUT', { plan: changed }], [endpoint, 'DELETE'],
      [`${endpoint}/versions`, 'GET'], [`${endpoint}/versions`, 'POST', { version: uploaded }],
      [`${endpoint}/versions/legacy-large-0`, 'GET'], [`${endpoint}/versions/legacy-large-0`, 'PUT', { version: { ...uploaded, id: 'legacy-large-0' } }],
      [`${endpoint}/versions/legacy-large-0`, 'DELETE'],
      ['/api/credits', 'GET'], ['/api/settings', 'GET'], ['/api/settings', 'PATCH', { agentEngine: 'basic' }],
      [`/api/skills?planId=${PLAN_ID}`, 'GET'], ['/api/skills', 'PUT', { planId: PLAN_ID, artifact: 'fs', body: '위조' }],
      [`/api/skills?planId=${PLAN_ID}&artifact=fs`, 'DELETE'],
      ['/api/chat', 'POST', { plan: changed, message: '위조' }],
      ['/api/generate', 'POST', { plan: changed, artifact: 'prd' }],
      ['/api/place', 'POST', { plan: changed }],
      ['/api/design/stitch', 'GET'], ['/api/design/stitch', 'PUT', { secret: 'qa-non-secret-placeholder-only' }], ['/api/design/stitch', 'DELETE'],
      ['/api/design/stitch/models', 'GET'],
      ['/api/design/stitch/run', 'POST', { plan: changed, pageId: 'PG-001' }],
      ['/api/design/uinai/run', 'POST', { plan: changed, pageId: 'PG-001', requestId: '00000000-0000-4000-8000-000000000001', engine: 'basic', emphasis: 'strict' }],
    ];
    for (const [url, method, body] of rejectedRoutes) {
      const response = await call(url, { actor: ORDINARY, scoped: true, method, body });
      check(`일반 계정 위조 거절 ${method} ${url}`, () => assert.equal(response.status, 404));
    }
    const afterTarget = await call('/api/credits', { actor: TARGET });
    const afterAdmin = await call('/api/credits', { actor: ADMIN });
    check('로컬 채팅·거절된 요청은 사용자와 관리자 크레딧을 소모하지 않는다', () => {
      assert.equal(afterTarget.body.used, 7);
      assert.equal(afterAdmin.body.used, 2);
    });
    console.log(`완료: ${passed}개 HTTP 통합 검증 통과 (외부 AI·운영 데이터 사용 없음).`);
  } finally {
    if (next) await stopServer(next);
    if (seed) await seed.close();
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    const resolvedTemporary = path.resolve(temporary);
    const resolvedRoot = path.resolve(os.tmpdir());
    assert.ok(resolvedTemporary.startsWith(`${resolvedRoot}${path.sep}`) && path.basename(resolvedTemporary).startsWith('uniboard-admin-api-qa-'), '검증용 임시 폴더 밖은 삭제하지 않습니다.');
    await rm(resolvedTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'HTTP 통합 검증 실패');
  process.exitCode = 1;
});
