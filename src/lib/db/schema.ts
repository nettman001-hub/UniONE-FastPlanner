/**
 * 데이터베이스 스키마.
 *
 * 여러 번 실행해도 같은 결과가 되도록 전부 `if not exists` 로 적었다.
 * 서버가 뜰 때마다 한 번씩 돌리므로 별도 마이그레이션 도구가 필요 없다.
 *
 * 표준 Postgres 문법만 쓴다 — 배포는 Supabase, 로컬 검증은 PGlite 로 하는데
 * 둘 다 진짜 Postgres 라서 같은 SQL 이 그대로 돈다.
 */
export const SCHEMA_SQL = `
create table if not exists users (
  id            text primary key,
  email         text not null unique,
  name          text not null default '',
  password_hash text,
  created_at    timestamptz not null default now()
);

create table if not exists plans (
  id         text not null,
  user_id    text not null references users(id) on delete cascade,
  title      text not null default '',
  data       jsonb not null,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- 플랜 ID 는 브라우저가 만든다. 전역 고유가 아니므로 사용자별로만 고유하면 된다.
  -- id 하나만 기본키로 두면 다른 사람의 플랜과 번호가 겹칠 때 저장이 조용히 실패한다.
  primary key (user_id, id)
);

create index if not exists plans_user_updated_idx on plans (user_id, updated_at desc);

-- 바깥 서비스에 접속할 자격증명. 지금은 스티치 하나뿐이다.
--
-- **암호문만 들어온다.** 이 값은 사용자의 스티치 계정을 그대로 여는 열쇠라,
-- 데이터베이스가 통째로 새어도 열쇠까지 함께 새지는 않도록 AUTH_SECRET 으로
-- 암호화해 넣는다(자세한 것은 lib/integrations.ts).
create table if not exists integrations (
  user_id    text not null references users(id) on delete cascade,
  provider   text not null,
  secret     text not null,
  -- 화면에 보여 줄 꼬리표(예: 키 끝 네 자리). 비밀이 아니다.
  label      text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- 어떤 헤더로 보내야 하는 값인지. 값 모양만 보고 짐작하면 틀린다 —
-- 연결할 때 실제로 찔러 보고 되는 쪽을 여기 적어 둔다.
alter table integrations add column if not exists kind text not null default '';
`;

/**
 * 스키마를 만드는 동안 잡는 잠금 번호.
 *
 * 서버리스에서는 인스턴스가 여러 개 동시에 뜨고, 그 전부가 같은 `create table`
 * 을 던진다. `if not exists` 만으로는 이 경쟁을 막지 못해
 * "duplicate key value violates unique constraint pg_type_..." 가 난다.
 * 트랜잭션 잠금이라 pgbouncer 트랜잭션 모드에서도 안전하다.
 */
export const MIGRATION_LOCK_ID = 62730011;
