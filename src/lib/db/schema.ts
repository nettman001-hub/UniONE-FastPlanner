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
