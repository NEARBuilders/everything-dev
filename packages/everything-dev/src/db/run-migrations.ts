import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { Effect, Option, Schedule } from "effect";
import {
  DUPLICATE_OBJECT_SQLSTATES,
  extractExpectedTables,
  getMigrationStorage,
  isConcurrentDdlUniqueViolation,
  isRetryableMigrationExecutionError,
  type MigrationStorage,
  toSqlArray,
  visitCauses,
} from "./core";
import { DatabaseError } from "./errors";

export interface Migration {
  idx: number;
  when: number;
  tag: string;
  hash: string;
  sql: string[];
}

/**
 * Minimal structural view of a drizzle PgDatabase — the concrete per-workspace
 * `PgDatabase<PgQueryResultHKT, TSchema>` values satisfy this.
 */
export interface MigrationDatabase {
  execute(query: unknown): Promise<unknown>;
  transaction<T>(fn: (tx: { execute(query: unknown): Promise<unknown> }) => Promise<T>): Promise<T>;
}

export interface LoadedMigrations {
  migrations: Migration[];
  source: "virtual" | "disk";
}

export interface DriftReport {
  status: "healthy" | "empty" | "untracked-existing-schema" | "drift-safe-repair" | "drift-manual";
  expectedTables: string[];
  missingTables: string[];
  appliedHashes: number;
  localHashes: number;
  storage: MigrationStorage;
}

export interface MigrationReport {
  applied: number;
  total: number;
  storage: MigrationStorage;
  schema: string | undefined;
}

export interface RunMigrationsOptions {
  schemaName?: string;
  journal?: MigrationStorage;
  duplicateSqlStates?: readonly string[];
}

const DEFAULT_DUPLICATE_SQLSTATES: readonly string[] = DUPLICATE_OBJECT_SQLSTATES;

function normalizeRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

type QueryExecutor = { execute(query: unknown): Promise<unknown> };

function isDuplicateObjectError(error: unknown, codes: readonly string[]): boolean {
  return visitCauses(error, 6, (link) => {
    const code = (link as { code?: unknown }).code;
    return typeof code === "string" && codes.includes(code);
  });
}

/**
 * Whether a failed migration statement should be treated as duplicate-DDL
 * tolerance: either an explicit duplicate-object class, or the concurrent-DDL
 * catalog collision (SQLSTATE 23505 on a pg_catalog unique index) that two
 * booting processes can produce when they run the same `CREATE TABLE` against
 * a fresh database at the same time.
 */
function isTolerableDuplicateDdl(error: unknown, codes: readonly string[]): boolean {
  return isDuplicateObjectError(error, codes) || isConcurrentDdlUniqueViolation(error);
}

/**
 * Check which of the given expected tables already exist in the target schema.
 * The schema name is bound as a query parameter.
 */
async function existingTablesIn(
  executor: QueryExecutor,
  tables: string[],
  schemaName?: string,
): Promise<Set<string>> {
  if (tables.length === 0) return new Set<string>();
  const schema = schemaName ?? "public";
  const result = await executor.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = ${schema}
      AND table_name = ANY(${sql.raw(toSqlArray(tables))})
  `);
  return new Set(normalizeRows<{ table_name: string }>(result).map((r) => r.table_name));
}

/** Read applied hashes from the migration journal. */
async function readAppliedHashesIn(
  executor: QueryExecutor,
  ref: ReturnType<typeof sql.raw>,
): Promise<Set<string>> {
  const result = await executor.execute(sql`SELECT hash FROM ${ref}`);
  return new Set(normalizeRows<{ hash: string }>(result).map((r) => r.hash));
}

export interface LoadMigrationsOptions {
  /** Directory containing the workspace's drizzle `migrations/` folder for the disk fallback. */
  fromDir?: string;
  /**
   * Bundler-provided virtual-module loader (e.g. `virtual:drizzle-migrations.sql`
   * registered by rspack). Lives at the call site — the shared package must not
   * name the virtual module, which only exists inside plugin bundles.
   */
  virtual?: () => Promise<{ default?: Migration[] }>;
}

export function loadMigrations(
  opts: LoadMigrationsOptions = {},
): Effect.Effect<LoadedMigrations, DatabaseError> {
  return Effect.gen(function* () {
    if (opts.virtual) {
      const mod = yield* Effect.tryPromise({
        try: () => opts.virtual!(),
        catch: (cause) => new DatabaseError({ stage: "load", cause }),
      }).pipe(Effect.option);
      const migrations = Option.getOrUndefined(mod)?.default;
      if (migrations?.length) {
        yield* Effect.logInfo(
          `[Database] Loaded ${migrations.length} migration(s) from virtual module`,
        );
        return { migrations, source: "virtual" as const };
      }
      yield* Effect.logDebug("[Database] Virtual migrations unavailable, loading from disk");
    }

    const diskMigrations = Option.getOrUndefined(
      yield* loadMigrationsFromDisk(opts.fromDir).pipe(Effect.option),
    );
    if (diskMigrations) {
      yield* Effect.logInfo(`[Database] Loaded ${diskMigrations.length} migration(s) from disk`);
      return { migrations: diskMigrations, source: "disk" as const };
    }

    yield* Effect.logWarning("[Database] No migrations found from virtual or disk");
    return { migrations: [], source: "disk" as const };
  });
}

function loadMigrationsFromDisk(fromDir?: string): Effect.Effect<Migration[], DatabaseError> {
  return Effect.try({
    try: () => {
      const migrationsDir = resolve(fromDir ?? import.meta.dirname, "migrations");
      const metaDir = join(migrationsDir, "meta");
      const journalPath = join(metaDir, "_journal.json");

      if (!existsSync(journalPath)) {
        throw new Error(
          `Migrations journal not found at ${journalPath}. Run \`db:generate\` first.`,
        );
      }

      const journal = JSON.parse(readFileSync(journalPath, "utf8"));

      return journal.entries.map((entry: { idx: number; when: number; tag: string }) => {
        const sqlPath = join(migrationsDir, `${entry.tag}.sql`);
        if (!existsSync(sqlPath)) {
          throw new Error(`Migration SQL file not found: ${sqlPath}`);
        }
        const raw = readFileSync(sqlPath, "utf8");
        const sqlStatements = raw.split("--> statement-breakpoint").map((s: string) => s.trim());
        const hash = createHash("sha256").update(raw).digest("hex");

        return {
          idx: entry.idx,
          when: entry.when,
          tag: entry.tag,
          hash,
          sql: sqlStatements,
        };
      });
    },
    catch: (cause) => new DatabaseError({ stage: "load", cause }),
  });
}

function journalRef(s: MigrationStorage): ReturnType<typeof sql> {
  return sql.raw(`"${s.schema}"."${s.table}"`);
}

/**
 * Apply one statement under a savepoint, tolerating duplicate DDL: either an
 * explicit duplicate-object class or the concurrent-DDL catalog collision a
 * non-participant migrator (drizzle-kit) can still produce.
 */
async function applyWithSavepoint(
  tx: QueryExecutor,
  query: ReturnType<typeof sql>,
  migrationTag: string,
  savepoint: string,
  duplicateSqlStates: readonly string[],
): Promise<void> {
  await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));
  try {
    await tx.execute(query);
  } catch (cause) {
    if (isTolerableDuplicateDdl(cause, duplicateSqlStates)) {
      await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
      return;
    }
    throw new DatabaseError({ stage: "migration", migrationTag, cause });
  }
  await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
}

interface LockedRunArgs {
  sorted: Migration[];
  journal: MigrationStorage;
  ref: ReturnType<typeof sql.raw>;
  schemaName: string | undefined;
  duplicateSqlStates: readonly string[];
}

/**
 * The whole migration run inside ONE transaction that opens with a
 * journal-scoped `pg_advisory_xact_lock`. Drizzle's `db.transaction` pins a
 * single pooled client for the callback, so the lock, the journal read, the
 * DDL, and the journal inserts all share one session; the lock releases at
 * COMMIT/ROLLBACK or on connection death — a crashed migrator can never
 * orphan it. A concurrent migrator blocks (bounded by the driver's
 * `lock_timeout`), then reads the winner's committed journal rows and applies
 * nothing.
 */
async function runLockedTransaction(
  db: MigrationDatabase,
  args: LockedRunArgs,
): Promise<{ appliedTags: string[]; logs: string[] }> {
  const { sorted, journal, ref, schemaName, duplicateSqlStates } = args;
  const appliedTags: string[] = [];
  const logs: string[] = [];

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${journal.schema}.${journal.table}`}, 0))`,
    );

    await applyWithSavepoint(
      tx,
      sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(`"${journal.schema}"`)}`,
      "init-schema",
      "sp_init_schema",
      duplicateSqlStates,
    );
    await applyWithSavepoint(
      tx,
      sql`
        CREATE TABLE IF NOT EXISTS ${ref} (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `,
      "init-table",
      "sp_init_table",
      duplicateSqlStates,
    );
    if (schemaName) {
      await applyWithSavepoint(
        tx,
        sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(`"${schemaName}"`)}`,
        "init-data-schema",
        "sp_init_data_schema",
        duplicateSqlStates,
      );
    }

    const appliedHashes = await readAppliedHashesIn(tx, ref);

    for (const migration of sorted) {
      const isApplied =
        appliedHashes.has(migration.hash) || appliedHashes.has(migration.hash.slice(0, 12));
      if (isApplied) continue;

      // Preflight: if this migration's expected tables already exist, record it
      // as applied rather than crashing on a duplicate DDL error.
      const expectedTables = extractExpectedTables([migration]);
      if (expectedTables.length > 0) {
        const existing = await existingTablesIn(tx, expectedTables, schemaName);
        const missingTables = expectedTables.filter((t) => !existing.has(t));
        if (missingTables.length === 0) {
          logs.push(
            `[Database] All tables for migration ${migration.tag} already exist — ` +
              `recording as applied without replaying DDL`,
          );
          await tx.execute(
            sql`INSERT INTO ${ref} (hash, created_at) VALUES (${migration.hash}, ${migration.when})`,
          );
          appliedHashes.add(migration.hash);
          appliedTags.push(migration.tag);
          continue;
        }
        if (missingTables.length < expectedTables.length) {
          logs.push(
            `[Database] Partial table overlap for migration ${migration.tag}: ` +
              `${expectedTables.length - missingTables.length} table(s) exist but not all. ` +
              `Applying migration — existing tables: ${expectedTables.filter((t) => existing.has(t)).join(", ")}`,
          );
        }
      }

      logs.push(`[Database] Applying migration: ${migration.tag}`);

      for (const [i, statement] of migration.sql.entries()) {
        const stmt = schemaName ? statement.replace(/"public"\./g, "") : statement;
        await applyWithSavepoint(tx, sql.raw(stmt), migration.tag, `stmt_${i}`, duplicateSqlStates);
      }
      await tx.execute(
        sql`INSERT INTO ${ref} (hash, created_at) VALUES (${migration.hash}, ${migration.when})`,
      );
      appliedTags.push(migration.tag);
    }
  });

  return { appliedTags, logs };
}

/**
 * Apply pending migrations to the target database.
 *
 * Namespace model: `opts.schemaName` (`plugin_<slug>`) scopes data tables; the
 * journal lives in `opts.journal` (default the shared `drizzle.__drizzle_migrations`).
 * Undefined `schemaName` means public-schema (api) or dedicated-DB (auth) topology.
 *
 * Concurrency: the run serializes on a journal-scoped Postgres advisory
 * transaction lock, so the dev double-boot (plugin dev-server + the host's
 * in-process load), parallel test files, and overlapping production replicas
 * converge instead of colliding in pg_catalog. SAVEPOINT-based duplicate-DDL
 * tolerance stays as defense-in-depth for non-participants (drizzle-kit).
 *
 * Reliability floor: hash-tracked idempotence with a preflight that records
 * fully-overlapped migrations as applied, everything in one locked
 * transaction, retried on deadlock/serialization/lock-timeout/connection
 * states — a failed attempt rolls back cleanly and re-runs.
 */
export function runMigrations(
  db: MigrationDatabase,
  migrations: Migration[],
  opts: RunMigrationsOptions = {},
): Effect.Effect<MigrationReport, DatabaseError> {
  return Effect.gen(function* () {
    const sorted = [...migrations].sort((a, b) => a.idx - b.idx);
    const journal = opts.journal ?? getMigrationStorage();
    const schemaName = opts.schemaName;
    const duplicateSqlStates = opts.duplicateSqlStates ?? DEFAULT_DUPLICATE_SQLSTATES;

    const { appliedTags, logs } = yield* Effect.retry(
      Effect.tryPromise({
        try: () =>
          runLockedTransaction(db, {
            sorted,
            journal,
            ref: journalRef(journal),
            schemaName,
            duplicateSqlStates,
          }),
        catch: (cause) =>
          cause instanceof DatabaseError
            ? cause
            : new DatabaseError({ stage: "migration", migrationTag: "run", cause }),
      }),
      {
        schedule: Schedule.spaced("500 millis"),
        times: 3,
        while: isRetryableMigrationExecutionError,
      },
    );

    for (const line of logs) yield* Effect.logInfo(line);

    return {
      applied: appliedTags.length,
      total: sorted.length,
      storage: journal,
      schema: schemaName,
    };
  });
}

/**
 * Detect drift between the local migration set and the database journal.
 *
 * Pass an explicit `journal` resolved from the caller's workspace for reliable
 * slug derivation; the default relies on `process.env.npm_package_name`, which is
 * unreliable under bundlers and Module Federation remotes.
 */
export function detectDrift(
  db: MigrationDatabase,
  migrations: Migration[],
  journal?: MigrationStorage,
  schemaName?: string,
): Effect.Effect<DriftReport, DatabaseError> {
  return Effect.gen(function* () {
    const storage = journal ?? getMigrationStorage();
    const expectedTables = extractExpectedTables(migrations);
    const ref = journalRef(storage);

    // Lenient by design: drift detection reports on whatever it can read —
    // a failed journal read just means "nothing tracked yet".
    const appliedHashes = yield* Effect.tryPromise({
      try: () => readAppliedHashesIn(db, ref),
      catch: (cause) =>
        new DatabaseError({ stage: "migration", migrationTag: "read-applied", cause }),
    }).pipe(Effect.catch(() => Effect.succeed(new Set<string>())));
    const appliedCount = appliedHashes.size;

    if (expectedTables.length === 0) {
      return {
        status: "empty",
        expectedTables: [],
        missingTables: [],
        appliedHashes: appliedCount,
        localHashes: migrations.length,
        storage,
      };
    }

    const existing = yield* Effect.tryPromise({
      try: () => existingTablesIn(db, expectedTables, schemaName),
      catch: (cause) =>
        new DatabaseError({ stage: "migration", migrationTag: "preflight-table-check", cause }),
    }).pipe(Effect.catch(() => Effect.succeed(new Set<string>())));
    const missingTables = expectedTables.filter((t) => !existing.has(t));

    if (appliedCount === 0 && missingTables.length === 0) {
      // Journal is empty but all expected tables already exist.
      return {
        status: "untracked-existing-schema",
        expectedTables,
        missingTables: [],
        appliedHashes: 0,
        localHashes: migrations.length,
        storage,
      };
    }

    if (missingTables.length === 0) {
      return {
        status: "healthy",
        expectedTables,
        missingTables: [],
        appliedHashes: appliedCount,
        localHashes: migrations.length,
        storage,
      };
    }

    if (missingTables.length === expectedTables.length) {
      return {
        status: "drift-safe-repair",
        expectedTables,
        missingTables,
        appliedHashes: appliedCount,
        localHashes: migrations.length,
        storage,
      };
    }

    return {
      status: "drift-manual",
      expectedTables,
      missingTables,
      appliedHashes: appliedCount,
      localHashes: migrations.length,
      storage,
    };
  });
}
