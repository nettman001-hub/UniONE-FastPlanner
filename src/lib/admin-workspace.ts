'use client';

/** 한 탭에서 선택한 사용자 플랜만 지원한다. 로그인 세션은 관리자 그대로다. */
export interface AdminWorkspaceContext {
  actorId: string;
  userId: string;
  planId: string;
}

const SESSION_KEY = 'uniboard:admin-workspace:v1';
let context: AdminWorkspaceContext | null | undefined;
let invalidRequest = false;
let closedSupportContext: AdminWorkspaceContext | null = null;
let verifiedOwner: { id: string; name: string; email: string } | null = null;
const ownerListeners = new Set<() => void>();

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
}

function valid(value: unknown): value is AdminWorkspaceContext {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AdminWorkspaceContext>;
  return identifier(row.actorId) && identifier(row.userId) && identifier(row.planId);
}

/** 처음 연 주소에서 문맥을 만들고, 이후 사이드바 이동·새로고침은 탭 저장소를 따른다. */
export function adminWorkspace(): AdminWorkspaceContext | null {
  if (typeof window === 'undefined') return null;
  if (context !== undefined) return context;
  const url = new URL(window.location.href);
  const match = url.pathname.match(/^\/plans\/([^/]+)(?:\/|$)/);
  const requested = url.searchParams.has('adminUserId') || url.searchParams.has('adminActorId');
  if (requested) {
    let planId = '';
    try { planId = match ? decodeURIComponent(match[1]) : ''; } catch { /* 잘못된 주소는 지원 문맥으로 열지 않는다. */ }
    const next = {
      actorId: url.searchParams.get('adminActorId'),
      userId: url.searchParams.get('adminUserId'),
      planId,
    };
    context = valid(next) ? Object.freeze(next) : null;
    invalidRequest = context === null;
    try {
      if (context) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(context));
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch { /* 현재 탭의 메모리 문맥은 유지한다. */ }
    return context;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    context = valid(saved) ? Object.freeze(saved) : null;
  } catch {
    context = null;
  }
  return context;
}

/** 일반 계정 저장소와 사용자 지원 탭의 작업본·동기화 기록을 분리한다. */
export function workspaceStorageKey(base: string): string {
  const scope = adminWorkspace();
  return scope
    ? `${base}:admin:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.planId)}`
    : base;
}

export function clearAdminWorkspace(): void {
  closedSupportContext = adminWorkspace() ?? closedSupportContext;
  context = null;
  invalidRequest = false;
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* 전체 페이지 이동으로 메모리도 비운다. */ }
}

export function invalidAdminWorkspace(): boolean {
  adminWorkspace();
  return invalidRequest;
}

/** 소유권 검사를 통과한 플랜 응답에서만 받은 표시 이름. 문맥·권한 판정에는 쓰지 않는다. */
export function setAdminWorkspaceOwner(owner: { id: string; name?: string; email?: string }): void {
  const scope = adminWorkspace();
  if (!scope || owner.id !== scope.userId) return;
  const next = { id: owner.id, name: owner.name ?? '', email: owner.email ?? '' };
  if (JSON.stringify(next) === JSON.stringify(verifiedOwner)) return;
  verifiedOwner = next;
  ownerListeners.forEach((listener) => listener());
}

export const adminWorkspaceOwner = () => verifiedOwner;
export const adminWorkspaceOwnerOnServer = () => null;
export function subscribeAdminWorkspaceOwner(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => { ownerListeners.delete(listener); };
}

const EDITOR_APIS = new Set([
  '/api/chat', '/api/generate', '/api/place', '/api/credits', '/api/settings', '/api/skills',
  '/api/design/stitch', '/api/design/stitch/models', '/api/design/stitch/run', '/api/design/uinai/run',
]);

/** 허용된 편집 API에만 지원 문맥을 보낸다. 서버가 실제 관리자·소유권을 다시 확인한다. */
export function workspaceFetch(input: string, init?: RequestInit): Promise<Response> {
  const scope = adminWorkspace();
  if (typeof window === 'undefined') return fetch(input, init);
  const url = new URL(input, window.location.origin);
  const planApi = /^\/api\/plans(?:\/|$)/.test(url.pathname);
  const editorApi = EDITOR_APIS.has(url.pathname) || planApi;
  if (url.origin !== window.location.origin || !editorApi) return fetch(input, init);
  if (invalidRequest) return Promise.reject(new Error('사용자 플랜 지원 주소가 올바르지 않습니다. 관리자 메뉴에서 다시 열어 주세요.'));
  // 종료 직후에도 여러 단계 생성 루프가 남아 있을 수 있다. 개인 계정 요청으로 바꾸지 않는다.
  if (!scope && closedSupportContext) return Promise.reject(new Error('사용자 플랜 지원 작업이 종료되었습니다. 플랜을 다시 열어 주세요.'));
  if (!scope) return fetch(input, init);
  const selectedPlanPath = `/api/plans/${encodeURIComponent(scope.planId)}`;
  const selectedPath = url.pathname === selectedPlanPath || url.pathname === `${selectedPlanPath}/versions` || url.pathname.startsWith(`${selectedPlanPath}/versions/`);
  if (planApi && !selectedPath) return Promise.reject(new Error('지원 작업에서는 선택한 사용자 플랜만 요청할 수 있습니다.'));
  const headers = new Headers(init?.headers);
  headers.set('x-admin-user-id', scope.userId);
  headers.set('x-admin-plan-id', scope.planId);
  return fetch(input, { ...init, headers });
}
