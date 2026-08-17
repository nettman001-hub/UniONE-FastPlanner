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

-- 계정마다 고른 것들. 지금은 만들기 엔진 하나뿐이다.
--
-- 칸을 하나씩 늘리지 않고 jsonb 한 칸에 담는다. 앞으로 들어올 것들(알림, 테마)이
-- 전부 "고른 값 하나" 라서, 그때마다 alter table 을 하느니 여기에 키를 더한다.
-- 읽는 쪽(lib/db/user-settings.ts)에서 모르는 값은 기본으로 되돌리므로,
-- 옛 배포가 남긴 키가 섞여 있어도 문제가 되지 않는다.
alter table users add column if not exists settings jsonb not null default '{}'::jsonb;

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

-- 배포 전체에 걸리는 설정. 관리자 화면에서 고친다.
--
-- 줄이 하나뿐인 표다. only_row 를 true 로 못 박아 두 줄이 될 수 없게 한다 —
-- 여러 줄이 생기면 어느 것이 진짜인지 알 수 없고, 인스턴스마다 다른 줄을 읽는
-- 일이 생긴다.
--
-- **API 키는 여기 넣지 않는다.** 환경변수에만 둔다. 데이터베이스가 통째로 새도
-- 키까지 함께 새지는 않게 하려는 것이다.
create table if not exists app_settings (
  only_row   boolean primary key default true check (only_row),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- 크레딧을 무엇에 얼마나 썼는지.
--
-- **잔량이 아니라 쓴 내역을 적는다.** 잔량 하나만 들고 있으면 무엇에 썼는지가
-- 남지 않아 사용 내역을 따로 만들어야 한다. 빼서 세면 둘 다 된다.
--
-- 브라우저에 두던 것을 옮겨 온 것이다. 예전에는 개발자도구로 고칠 수 있었고,
-- 에이전트·기능 배치는 서버에서 아예 세지 않아 사실상 무제한이었다.
create table if not exists credit_usage (
  id         bigserial primary key,
  user_id    text not null references users(id) on delete cascade,
  -- 산출물 다섯 가지 + chat + place
  kind       text not null,
  amount     integer not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_usage_user_time_idx on credit_usage (user_id, created_at desc);

-- 기획 스킬 — 단계마다 "이런 식으로 써 달라" 를 적어 둔 것.
--
-- 비밀이 아니라 암호화하지 않는다. 다만 **사용자가 쓴 글이 AI 요청문에 그대로
-- 들어가므로**, 읽어 쓰는 쪽(lib/skills.ts)에서 울타리에 가둔 뒤에 넣는다.
create table if not exists skills (
  user_id    text not null references users(id) on delete cascade,
  artifact   text not null,
  body       text not null default '',
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, artifact)
);

-- 플랜별 덮어쓰기 — "이 프로젝트만 다르게".
--
-- 빈 문자열이 **계정 기본**이라는 뜻이다. 따로 scope 칸을 두는 대신 이렇게 한
-- 이유는, 기본과 플랜별을 한 질의로 같이 읽어 올 수 있어서다
-- (where user_id = $1 and (plan_id = '' or plan_id = $2)).
--
-- plans 표를 참조하지 **않는다.** 플랜은 브라우저에서 먼저 만들어지고 조금 뒤에
-- 서버로 올라가는데, 외래키를 걸면 아직 안 올라간 플랜에는 지침을 못 적는다.
alter table skills add column if not exists plan_id text not null default '';

-- 기본키가 (user_id, artifact) 라 한 단계에 한 줄뿐이다. 플랜별로 여러 줄을
-- 두려면 키를 넓혀야 하는데, "alter table ... add primary key" 는 여러 번 돌릴
-- 수 없다(이 파일은 서버가 뜰 때마다 통째로 다시 돈다).
--
-- 그래서 유일 색인으로 옮긴다 — "create unique index if not exists" 는 몇 번을
-- 돌려도 같은 결과다. on conflict 는 색인으로도 그대로 걸린다.
alter table skills drop constraint if exists skills_pkey;
create unique index if not exists skills_scope_idx on skills (user_id, plan_id, artifact);
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
