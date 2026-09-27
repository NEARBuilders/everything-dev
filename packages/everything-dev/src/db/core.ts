import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface MigrationStorage {
  schema: string;
  table: string;
  slug: string;
}

const DEFAULT_MIGRATION_JOURNAL = {
  schema: "drizzle",
  table: "__drizzle_migrations",
} as const;

const PER_PLUGIN_ISOLATION = false;

export function normalizeSlug(name: string): string {
  const basename = name.split("/").pop() ?? name;
  return basename
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/-plugin$/i, "")
    .replace(/-/g, "_")
    .toLowerCase();
}

export function getMigrationSlug(dir?: string): string {
  if (!dir) return normalizeSlug(process.env.npm_package_name ?? "unknown");
  let current = dir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
        return normalizeSlug(pkg.name ?? current);
      } catch {
        return normalizeSlug(current);
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return normalizeSlug(dir);
}

export function getMigrationStorage(
  slug?: string,
  options?: { isolated?: boolean },
): MigrationStorage {
  const s = normalizeSlug(slug ?? getMigrationSlug());
  const isolated = options?.isolated ?? PER_PLUGIN_ISOLATION;
  if (isolated) {
    return {
      schema: DEFAULT_MIGRATION_JOURNAL.schema,
      table: `__drizzle_migrations_${s}`,
      slug: s,
    };
  }
  return {
    schema: DEFAULT_MIGRATION_JOURNAL.schema,
    table: DEFAULT_MIGRATION_JOURNAL.table,
    slug: s,
  };
}

/**
 * Format a JavaScript string array as a PostgreSQL text array literal for use
 * with Drizzle's `sql` tag. Example return:
 *   `'{"h1","h2"}'::text[]`
 *
 * Usage: sql`WHERE col = ANY(${toSqlArray(values)})`
 *
 * Drizzle's default parameter binding does not handle array types correctly
 * with the pg driver (it emits `ANY(($1))` with a single string, which
 * Postgres rejects as a malformed array literal).
 */
export function toSqlArray(arr: string[]): string {
  if (arr.length === 0) return `'{}'::text[]`;
  const escaped = arr.map((v) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
  return `'{${escaped.map((v) => `"${v}"`).join(",")}}'::text[]`;
}

export function pluginMigrationSlug(key: string): string {
  return normalizeSlug(key);
}

export function getDatabaseUrlSecretName(slug: string): string {
  return `${slug.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
}

export const DUPLICATE_OBJECT_SQLSTATES: readonly string[] = ["42710", "42701", "42P07"];

/**
 * Walk `error` and its `cause` chain (bounded), invoking `visit` on each link.
 * Postgres driver errors arrive wrapped by drizzle/Effect at varying depths,
 * so every error-shape predicate below shares this traversal.
 */
export function visitCauses(
  error: unknown,
  depth: number,
  visit: (link: object) => boolean,
): boolean {
  let current: unknown = error;
  for (let i = 0; i < depth && current; i++) {
    if (typeof current === "object" && current !== null && visit(current)) return true;
    current = (current as { cause?: unknown })?.cause;
  }
  return false;
}

/**
 * pg_catalog unique indexes that can surface a concurrent-DDL race as SQLSTATE
 * 23505 instead of a duplicate-object class. When two connections run
 * `CREATE TABLE <name>` at the same time, the loser fails its insert into
 * `pg_type` ("duplicate key value violates unique constraint
 * `pg_type_typname_nsp_index`") rather than seeing 42P07, because the winner's
 * table is not yet committed. The same shape exists for schemas and other
 * relations.
 */
const CONCURRENT_DDL_CONSTRAINTS: ReadonlySet<string> = new Set([
  "pg_type_typname_nsp_index",
  "pg_namespace_nspname_index",
  "pg_class_relname_nsp_index",
]);

/**
 * Whether a SQLSTATE 23505 unique violation is the concurrent-DDL catalog
 * collision signature rather than a data-level constraint on a user table.
 * Data-level violations must keep failing loudly; only the pg_catalog indexes
 * above are treated as duplicate-DDL tolerance candidates.
 */
export function isConcurrentDdlUniqueViolation(error: unknown): boolean {
  return visitCauses(error, 6, (link) => {
    const { code, constraint, message } = link as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    if (code !== "23505") return false;
    if (typeof constraint === "string" && CONCURRENT_DDL_CONSTRAINTS.has(constraint)) return true;
    if (typeof message !== "string") return false;
    for (const name of CONCURRENT_DDL_CONSTRAINTS) {
      if (message.includes(name)) return true;
    }
    return false;
  });
}

const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set([
  "42P06",
  "42710",
  "42701",
  "42P07",
  "23505",
  "40001",
  "40P01",
  "55P03",
]);

const RETRYABLE_DRIVER_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function matchesRetryableStates(error: unknown, states: ReadonlySet<string>): boolean {
  return visitCauses(error, 6, (link) => {
    const code = (link as { code?: unknown }).code;
    if (typeof code !== "string") return false;
    return states.has(code) || code.startsWith("08") || RETRYABLE_DRIVER_CODES.has(code);
  });
}

/**
 * Decide whether a failed migration-init statement (schema/journal creation)
 * is worth retrying. Covers the concurrent `CREATE SCHEMA IF NOT EXISTS`
 * race (unique violation on `pg_namespace`, duplicate-object errors),
 * serialization/deadlock errors, and transient connection failures.
 */
export function isRetryableMigrationError(error: unknown): boolean {
  return matchesRetryableStates(error, RETRYABLE_SQLSTATES);
}

const RETRYABLE_STATEMENT_SQLSTATES: ReadonlySet<string> = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
]);

/**
 * Decide whether a failed migration *statement* (inside its transaction) is
 * worth retrying. Deliberately narrower than `isRetryableMigrationError`:
 * duplicate-object classes are tolerated at the SAVEPOINT level, and a 23505
 * is either the concurrent-DDL catalog collision (also tolerated) or a
 * deterministic data-level violation (retrying is pointless) — so only
 * lock/serialization/transient-connection states justify re-running the
 * transaction.
 */
export function isRetryableMigrationExecutionError(error: unknown): boolean {
  return matchesRetryableStates(error, RETRYABLE_STATEMENT_SQLSTATES);
}

const PG_QUERY_QUEUE_DEPRECATION = "client.query() when the client is already executing a query";

let pgWarningFilterInstalled = false;

/**
 * Silence pg's query-queue deprecation warning (fires once per process from
 * pg-pool's internal dispatch under concurrent boot load — node-postgres#3612,
 * #3617). Node's default warning handler prints even when user listeners are
 * attached, so it is removed first; every other warning is re-printed here.
 */
export function suppressPgQueryQueueDeprecation(): void {
  if (pgWarningFilterInstalled) return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  pgWarningFilterInstalled = true;
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if (
      warning.name === "DeprecationWarning" &&
      warning.message.includes(PG_QUERY_QUEUE_DEPRECATION)
    ) {
      return;
    }
    console.error(warning.stack || `${warning.name}: ${warning.message}`);
  });
}

export function extractExpectedTables(migrations: { sql: string[] }[]): string[] {
  const tables = new Set<string>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"\.)?"([^"]+)"/gi;
  for (const migration of migrations) {
    for (const stmt of migration.sql) {
      for (const match of stmt.matchAll(re)) {
        const tableName = match[2];
        if (tableName) {
          tables.add(tableName);
        }
      }
    }
  }
  return [...tables];
}
