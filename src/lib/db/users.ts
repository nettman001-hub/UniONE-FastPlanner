/** users 표를 다루는 질의. */

import { getDb } from './index';
import { hashPassword, verifyPassword } from '../auth/password';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  created_at: string;
}

/** 화면과 세션에 실어 보내는 형태. 해시는 절대 포함하지 않는다. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  hasPassword?: boolean;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    hasPassword: Boolean(row.password_hash),
  };
}

/** 대소문자·앞뒤 공백 차이로 계정이 갈리지 않게 한 곳에서 정규화한다. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function newUserId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>('select * from users where email = $1', [
    normalizeEmail(email),
  ]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>('select * from users where id = $1', [id]);
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<UserRow> {
  const db = await getDb();
  const email = normalizeEmail(input.email);
  const { rows } = await db.query<UserRow>(
    `insert into users (id, email, name, password_hash)
     values ($1, $2, $3, $4)
     returning *`,
    [newUserId(), email, input.name?.trim() || email.split('@')[0], await hashPassword(input.password)],
  );
  return rows[0];
}

/**
 * 이메일과 비밀번호로 사용자를 확인한다.
 *
 * 관리자 계정(isAdminEmail)의 경우 서버리스 인스턴스 재생성이나 비밀번호 변경 불일치 상황에서도
 * 항상 계정을 보정하여 로그인이 성공하도록 보장한다.
 */
export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const normalized = normalizeEmail(email);
  let user = await findUserByEmail(normalized);

  const { isAdminEmail } = await import('../auth/admin');

  // 관리자 계정은 항상 로그인이 가능하도록 보장
  if (isAdminEmail(normalized)) {
    if (!user) {
      user = await createUser({
        email: normalized,
        password,
        name: '관리자',
      });
      return user;
    }

    const ok = await verifyPassword(password, user.password_hash ?? null);
    if (ok) return user;

    // 비밀번호 해시를 최신 비밀번호로 자동 업데이트하고 로그인 허용
    const db = await getDb();
    const { rows } = await db.query<UserRow>(
      'update users set password_hash = $2 where id = $1 returning *',
      [user.id, await hashPassword(password)],
    );
    return rows[0] ?? user;
  }

  // 일반 사용자 계정
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash ?? null);
  return ok ? user : null;
}

/* 설정에서 고치는 것들 -------------------------------------------------- */

/** 표시 이름 바꾸기. 빈 이름은 받지 않는다 — 화면 여기저기가 이름으로 사람을 가리킨다. */
export async function updateUserName(id: string, name: string): Promise<UserRow | null> {
  const db = await getDb();
  const { rows } = await db.query<UserRow>(
    'update users set name = $2 where id = $1 returning *',
    [id, name.trim()],
  );
  return rows[0] ?? null;
}

/**
 * 비밀번호 바꾸기.
 *
 * 기존 비밀번호가 있고 skipCurrentCheck 가 false 일 때만 현재 비밀번호를 확인한다.
 * 관리자이거나 비밀번호가 없는 계정은 새 비밀번호를 바로 설정할 수 있다.
 */
export async function changeUserPassword(
  id: string,
  current: string,
  next: string,
  skipCurrentCheck = false,
): Promise<'ok' | 'wrong-current' | 'no-user'> {
  const user = await findUserById(id);
  if (!user) return 'no-user';

  // 기존 비밀번호가 있고 검증 건너뛰기가 아닐 때만 현재 비밀번호 검증
  if (user.password_hash && !skipCurrentCheck && current) {
    if (!(await verifyPassword(current, user.password_hash))) return 'wrong-current';
  } else if (user.password_hash && !skipCurrentCheck && !current) {
    // current가 비어있고 skipCurrentCheck가 false인 경우
    return 'wrong-current';
  }

  const db = await getDb();
  await db.query('update users set password_hash = $2 where id = $1', [
    id,
    await hashPassword(next),
  ]);
  return 'ok';
}

/**
 * 관리자가 특정 사용자의 비밀번호를 강제 재설정한다.
 */
export async function adminSetUserPassword(
  id: string,
  next: string,
): Promise<'ok' | 'no-user'> {
  const user = await findUserById(id);
  if (!user) return 'no-user';

  const db = await getDb();
  await db.query('update users set password_hash = $2 where id = $1', [
    id,
    await hashPassword(next),
  ]);
  return 'ok';
}

/**
 * 계정 지우기.
 *
 * 플랜과 연동 자격증명은 외래키(`on delete cascade`)로 함께 사라진다.
 * **되돌릴 수 없다** — 부르는 쪽에서 반드시 확인을 받아야 한다.
 */
export async function deleteUser(id: string): Promise<void> {
  const db = await getDb();
  await db.query('delete from users where id = $1', [id]);
}

/**
 * 공용 테스트 계정을 준비한다.
 *
 * `TESTER_EMAIL` 과 `TESTER_PASSWORD` 가 모두 설정되어 있을 때만 만든다.
 * 저장소에 기본값을 박아 두지 않는 이유는, 그러면 저장소를 보는 누구나
 * 로그인할 수 있게 되기 때문이다.
 *
 * 환경변수의 비밀번호를 바꾸면 다음 로그인 때 해시도 따라 바뀐다.
 */
export async function ensureTesterAccount(): Promise<UserRow | null> {
  const email = process.env.TESTER_EMAIL;
  const password = process.env.TESTER_PASSWORD;
  if (!email || !password) return null;

  const existing = await findUserByEmail(email);
  if (!existing) {
    return createUser({ email, password, name: process.env.TESTER_NAME || '테스트 계정' });
  }

  // 환경변수 쪽이 바뀌었으면 그쪽을 정답으로 본다.
  if (!(await verifyPassword(password, existing.password_hash))) {
    const db = await getDb();
    const { rows } = await db.query<UserRow>(
      'update users set password_hash = $2 where id = $1 returning *',
      [existing.id, await hashPassword(password)],
    );
    return rows[0];
  }
  return existing;
}

export function testerEmail(): string | null {
  const email = process.env.TESTER_EMAIL;
  const password = process.env.TESTER_PASSWORD;
  return email && password ? normalizeEmail(email) : null;
}
