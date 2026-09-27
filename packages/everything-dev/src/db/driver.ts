import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { pluginMigrationSlug } from "./core";

export interface DatabaseDriver<TSchema extends Record<string, unknown>> {
  readonly db: PgDatabase<PgQueryResultHKT, TSchema>;
  close(): Promise<void>;
}

/**
 * Resolve a plugin id to its data-schema name on a shared database.
 *
 * Schema names are unconditional `plugin_<slug>` for every workspace on the
 * shared API database. The `pluginId === "api" ? undefined` special case found
 * in older plugin copies is dead code (a plugin is never `api`); api's own
 * tables already live in `plugin_api`.
 */
export function pluginSchemaName(pluginId: string): string {
  return `plugin_${pluginMigrationSlug(pluginId)}`;
}

interface PoolLike {
  on(event: "error", listener: (err: Error) => void): unknown;
  connect(): Promise<{
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
    release: () => void;
  }>;
  removeAllListeners(event?: string | symbol): unknown;
  end(): Promise<void>;
}

/**
 * Connection-level guardrails. `ALTER DATABASE ... SET` only reaches sessions
 * opened after it runs — pooled connections that already exist never inherit
 * it, so any bound must ride on every connection's startup options. Defaults:
 * a lock wait fails after 10s (unbounded waits wedge the whole pool silently),
 * a session idle inside a transaction is reaped after 30s, and statement
 * timeout stays off unless DB_STATEMENT_TIMEOUT_MS is set (long migrations and
 * analytical queries must not break).
 */
/**
 * Parses a millisecond env value for a Postgres `-c` timeout setting.
 * A explicit `0` disables the timeout (Postgres semantics); garbage throws —
 * a typo must fail the boot loudly, never silently become the default.
 */
function timeoutMsEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallbackMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `[db] Invalid ${name}="${raw}" — must be a non-negative number of milliseconds (0 disables the timeout).`,
    );
  }
  return parsed;
}

function connectionOptions(namespace: string | undefined): string {
  const settings = [
    ...(namespace ? [`-c search_path="${namespace}",public`] : []),
    `-c lock_timeout=${timeoutMsEnv("DB_LOCK_TIMEOUT_MS", 10_000)}`,
    `-c idle_in_transaction_session_timeout=${timeoutMsEnv("DB_IDLE_TX_TIMEOUT_MS", 30_000)}`,
    ...(process.env.DB_STATEMENT_TIMEOUT_MS
      ? [`-c statement_timeout=${timeoutMsEnv("DB_STATEMENT_TIMEOUT_MS", 0)}`]
      : []),
  ];
  return settings.join(" ");
}

// host.docker.internal is docker-local development networking — the test
// databases a container reaches through the host gateway, which do not
// terminate TLS. `*.railway.internal` is Railway private-network traffic
// (VPC-scoped, no public egress) whose Postgres presents a self-signed
// certificate chain no client CA bundle can verify.
const isLocalDbUrl = (url: string): boolean =>
  url.includes("localhost") ||
  url.includes("127.0.0.1") ||
  url.includes("host.docker.internal") ||
  url.includes(".railway.internal");

/**
 * TLS behavior for a non-local Postgres URL, following libpq `sslmode`
 * semantics from the connection string itself:
 *
 * - `disable`            → no TLS
 * - `prefer`/`allow`/`require` → TLS, but the server's certificate is NOT
 *   verified (libpq: `require` encrypts, it does not trust). Managed
 *   providers (Railway, Neon, Supabase poolers…) hand out `sslmode=require`
 *   URLs backed by certificates no client CA bundle can verify.
 * - `verify-ca`/`verify-full` → TLS + certificate verification.
 * - absent → verification ON (secure default for bare URLs).
 *
 * `DB_SSL_REJECT_UNAUTHORIZED` stays as an explicit operator override: it
 * wins over whatever the URL says (`"false"` disables verification, `"true"`
 * forces it).
 */
export function resolvePoolSsl(url: string): false | { rejectUnauthorized: boolean } {
  if (isLocalDbUrl(url)) return false;

  let mode: string | null = null;
  try {
    mode = new URL(url).searchParams.get("sslmode");
  } catch {
    mode = null;
  }

  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === "false") return { rejectUnauthorized: false };
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === "true") return { rejectUnauthorized: true };

  switch (mode) {
    case "disable":
      return false;
    case "verify-ca":
    case "verify-full":
      return { rejectUnauthorized: true };
    case "prefer":
    case "allow":
    case "require":
      return { rejectUnauthorized: false };
    default:
      return { rejectUnauthorized: true };
  }
}

function buildPoolConfig(url: string, namespace: string | undefined) {
  return {
    connectionString: url,
    ssl: resolvePoolSsl(url),
    max: Number(process.env.DB_POOL_MAX) || 10,
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 30_000,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30_000,
    options: connectionOptions(namespace),
  };
}

async function ensureNamespaceExists(pool: PoolLike, namespace: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      // Same journal-scoped advisory lock the migration runner holds, so this
      // CREATE SCHEMA cannot race a concurrent migration run (the runner also
      // creates the schema inside its locked transaction). Xact-scoped: the
      // lock releases at COMMIT/ROLLBACK or on connection death.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "drizzle.__drizzle_migrations",
      ]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

function createCloseHandler(pool: PoolLike): () => Promise<void> {
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    pool.removeAllListeners("error");
    pool.removeAllListeners("connect");
    await pool.end();
  };
}

/**
 * Create a drizzle database driver for a plugin, choosing the engine by URL
 * scheme: `pglite:` / `:memory:` → embedded PGlite, anything else → postgres
 * (`pg.Pool`).
 *
 * Drivers stay externalized (never statically imported, never in the Module
 * Federation singleton share set) — they are loaded here via dynamic `import()`
 * only, and `drizzle-orm` appears as a runtime import for the `drizzle` entry
 * points. The `namespace` option expresses every topology the platform needs:
 * `plugin_<slug>` on a shared database, undefined for public-schema (api) or
 * dedicated-database (auth) workloads.
 */
export async function createDatabaseDriver<TSchema extends Record<string, unknown>>(
  url: string,
  schema: TSchema,
  namespace?: string,
): Promise<DatabaseDriver<TSchema>> {
  if (url.startsWith("pglite:") || url === ":memory:") {
    const { drizzle } = await import("drizzle-orm/pglite");
    const { PGlite } = await import("@electric-sql/pglite");
    const rawDir = url === ":memory:" ? ":memory:" : url.replace("pglite:", "");
    const dataDir = rawDir.endsWith("/:memory:") || rawDir === ":memory:" ? "memory://" : rawDir;
    if (dataDir !== "memory://") {
      mkdirSync(dirname(dataDir), { recursive: true });
    }
    const pglite = new PGlite(dataDir);
    if (namespace) {
      await pglite.exec(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`);
      await pglite.exec(`SET search_path TO "${namespace}", public`);
    }
    const db = drizzle(pglite, { schema: schema as never }) as unknown as PgDatabase<
      PgQueryResultHKT,
      TSchema
    >;
    return {
      db,
      close: async () => {
        await pglite.close();
      },
    };
  }

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool(buildPoolConfig(url, namespace) as never) as unknown as PoolLike;
  pool.on("error", (err: Error) => {
    console.error("[Database] Unexpected pool error:", err.message);
  });

  if (namespace) {
    await ensureNamespaceExists(pool, namespace);
  }

  const db = drizzle(pool as never, { schema: schema as never }) as unknown as PgDatabase<
    PgQueryResultHKT,
    TSchema
  >;

  return {
    db,
    close: createCloseHandler(pool),
  };
}
