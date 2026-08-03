/**
 * 데이터베이스 연결.
 *
 * 두 가지 백엔드를 같은 인터페이스로 쓴다.
 *
 * | 환경 | 백엔드 | 조건 |
 * | --- | --- | --- |
 * | 배포(Vercel) | Supabase 등 Postgres | `DATABASE_URL` 있음 |
 * | 로컬 개발·테스트 | PGlite (Postgres 를 WASM 으로 빌드한 것) | `DATABASE_URL` 없음 |
 *
 * 둘 다 진짜 Postgres 이므로 **같은 SQL 이 양쪽에서 그대로 돈다.** 덕분에
 * Postgres 서버를 띄울 수 없는 환경에서도 쿼리를 실제로 실행해 검증할 수 있다.
 * Supabase 전용 SDK 를 쓰지 않으므로 나중에 Neon·RDS 로 옮겨도 코드가 그대로다.
 */

export interface Sql {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  /** 여러 문장을 한 번에 실행한다. 파라미터는 쓸 수 없다 — 스키마 준비용. */
  exec(text: string): Promise<void>;
  /**
   * 한 연결 위에서 트랜잭션을 돈다.
   *
   * 풀에 `begin` 과 `commit` 을 따로 던지면 서로 다른 연결로 나갈 수 있다.
   * 트랜잭션 풀러(pgbouncer) 뒤에서는 더더욱 그렇다. 그래서 연결을 하나 붙잡는다.
   */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

import { MIGRATION_LOCK_ID, SCHEMA_SQL } from './schema';

let connecting: Promise<Sql> | null = null;

/** 연결(+스키마 준비)을 한 번만 하고 재사용한다. */
export function getDb(): Promise<Sql> {
  connecting ??= connect().catch((error) => {
    // 실패한 약속을 캐시에 남기면 영원히 같은 오류만 돌려준다.
    connecting = null;
    throw error;
  });
  return connecting;
}

/** 테스트에서 연결을 갈아 끼울 때 쓴다. */
export function resetDb(): void {
  connecting = null;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function connect(): Promise<Sql> {
  const url = process.env.DATABASE_URL;
  const db = url ? await connectPostgres(url) : await connectPglite();
  await migrate(db);
  return db;
}

async function connectPostgres(url: string): Promise<Sql> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: url,
    // 서버리스는 인스턴스가 계속 새로 뜬다. 인스턴스당 연결을 적게 잡아야
    // Supabase 의 연결 수 한도에 부딪히지 않는다. 풀러(6543 포트)를 쓰면 더 안전하다.
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslOption(url),
  });
  const wrap = (run: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Sql => ({
    query: run as Sql['query'],
    // 파라미터 없는 질의는 여러 문장을 한 번에 받는다.
    exec: async (text) => {
      await run(text);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      const tx = wrap((text, params) => client.query(text, params as never[]));
      try {
        await client.query('begin');
        const result = await fn(tx);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  });

  return wrap((text, params) => pool.query(text, params as never[]));
}

/**
 * SSL 설정.
 *
 * Supabase 는 SSL 을 요구한다. 기본은 암호화는 하되 인증서 검증은 건너뛴다 —
 * 관리형 Postgres 의 중간 인증서가 컨테이너 신뢰 저장소에 없는 경우가 흔해서다.
 * 인증서까지 검증하려면 `DATABASE_SSL_CA` 에 CA 인증서(PEM)를 넣으면 된다.
 */
function sslOption(url: string): false | { rejectUnauthorized: boolean; ca?: string } {
  if (/[?&]sslmode=disable/.test(url)) return false;
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;
  const ca = process.env.DATABASE_SSL_CA;
  if (ca) return { rejectUnauthorized: true, ca };
  return { rejectUnauthorized: false };
}

async function connectPglite(): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  // 경로를 주면 파일로 남아 서버를 다시 시작해도 데이터가 유지된다.
  const dir = process.env.PGLITE_DIR ?? '.pglite';
  const pglite = await PGlite.create(dir);
  // 연결이 하나뿐이라 트랜잭션이 다른 연결로 새어 나갈 걱정이 없다.
  const db: Sql = {
    query: async (text, params) => {
      const result = await pglite.query(text, params as never[]);
      return { rows: result.rows as never[] };
    },
    exec: async (text) => {
      await pglite.exec(text);
    },
    transaction: async (fn) => {
      await pglite.exec('begin');
      try {
        const result = await fn(db);
        await pglite.exec('commit');
        return result;
      } catch (error) {
        await pglite.exec('rollback').catch(() => {});
        throw error;
      }
    },
  };
  return db;
}

async function migrate(db: Sql): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await tx.exec(SCHEMA_SQL);
  });
}
