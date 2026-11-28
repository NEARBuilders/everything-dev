import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type DatabaseBinding, workspaceDataSchema } from "../../db/bindings";
import { extractExpectedTables } from "../../db/core";

export interface DoctorReport {
  plugin: string;
  slug: string;
  journalTable: string;
  journalSchema: string;
  /** The schema the expected tables were checked in (`plugin_<slug>` or `public`). */
  dataSchema: string;
  dbSecret: string;
  dbUrl: string;
  workspaceDir: string | undefined;
  localMigrationCount: number;
  appliedHashCount: number;
  expectedTables: string[];
  missingTables: string[];
  migrationHashes: string[];
  diagnosis: string;
  error?: string;
}

/**
 * Minimal query surface the diagnosis runs against — a pg.Pool satisfies it;
 * tests inject an in-memory engine instead.
 */
export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PoolExecutor extends SqlExecutor {
  end: () => Promise<void>;
}

/**
 * The executor `diagnosePlugin`/`repairPlugin` use when none is injected:
 * a single-connection pg.Pool on the binding's URL. The ad-hoc local/TLS
 * split predates `resolvePoolSsl` — kept so tooling behavior doesn't shift
 * under this fix.
 */
export async function pgPoolExecutor(url: string): Promise<PoolExecutor> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    ssl:
      url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  return {
    query: (text, params) => pool.query(text, params as never[]),
    end: () => pool.end(),
  };
}

function hashFile(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

interface LocalMigration {
  tag: string;
  hash: string;
  sql: string[];
}

function readLocalMigrations(workspaceDir: string): LocalMigration[] {
  const migrationsDir = resolve(workspaceDir, "src/db/migrations");
  const metaDir = join(migrationsDir, "meta");
  const journalPath = join(metaDir, "_journal.json");
  if (!existsSync(journalPath)) return [];

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };

  return journal.entries.map((entry) => {
    const sqlPath = join(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) {
      return { tag: entry.tag, hash: "", sql: [] };
    }
    const raw = readFileSync(sqlPath, "utf8");
    const sql = raw.split("--> statement-breakpoint").map((s) => s.trim());
    return { tag: entry.tag, hash: hashFile(raw), sql };
  });
}

export async function diagnosePlugin(
  binding: DatabaseBinding,
  executor?: SqlExecutor,
): Promise<DoctorReport> {
  if (executor) return diagnoseWith(binding, executor);

  const pool = await pgPoolExecutor(binding.url);
  try {
    return await diagnoseWith(binding, pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function diagnoseWith(
  binding: DatabaseBinding,
  executor: SqlExecutor,
): Promise<DoctorReport> {
  const slug = binding.identity.slug;
  const journalTable = binding.identity.journal.table;
  const journalSchema = binding.identity.journal.schema;
  const journalRef = `"${journalSchema}"."${journalTable}"`;
  // The same seam `detectDrift`'s schemaName resolves for the runtime: the
  // missing-tables check must look where boot looks, not in `public`.
  const dataSchema = workspaceDataSchema(binding) ?? "public";

  const localMigrations = binding.identity.workspaceDir
    ? readLocalMigrations(binding.identity.workspaceDir)
    : [];

  const expectedTables = extractExpectedTables(localMigrations);
  const localHashes = localMigrations.map((m) => m.hash).filter(Boolean);
  const migrationHashes = localHashes;

  try {
    const journalExists = await executor.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = '${journalSchema}' AND table_name = '${journalTable}'
      ) AS exists
    `);

    let appliedHashCount = 0;
    if (journalExists.rows[0]?.exists) {
      const result = await executor.query(`SELECT hash FROM ${journalRef}`);
      appliedHashCount = result.rows.length;
    }

    let missingTables: string[] = [];
    if (expectedTables.length > 0) {
      const tableResult = await executor.query(
        `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = $2
          AND table_name = ANY($1)
      `,
        [expectedTables, dataSchema],
      );
      const existing = new Set(tableResult.rows.map((r) => r.table_name as string));
      missingTables = expectedTables.filter((t) => !existing.has(t));
    }

    let diagnosis: string;
    if (localMigrations.length === 0) {
      diagnosis = "no-local-migrations";
    } else if (appliedHashCount === 0 && missingTables.length === 0 && localHashes.length > 0) {
      // Journal is empty but all expected tables exist.
      diagnosis = "untracked-existing-schema";
    } else if (appliedHashCount === 0 && localHashes.length > 0) {
      diagnosis = "unapplied";
    } else if (missingTables.length === 0) {
      diagnosis = "healthy";
    } else if (missingTables.length === expectedTables.length) {
      diagnosis = "drift-safe-repair";
    } else {
      diagnosis = "drift-manual";
    }

    const masked = binding.url.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");

    return {
      plugin: binding.key,
      slug,
      journalTable,
      journalSchema,
      dataSchema,
      dbSecret: binding.identity.secretName,
      dbUrl: masked,
      workspaceDir: binding.identity.workspaceDir,
      localMigrationCount: localMigrations.length,
      appliedHashCount,
      expectedTables,
      missingTables,
      migrationHashes,
      diagnosis,
    };
  } catch (error) {
    return {
      plugin: binding.key,
      slug,
      journalTable,
      journalSchema,
      dataSchema,
      dbSecret: binding.identity.secretName,
      dbUrl: binding.url.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
      workspaceDir: binding.identity.workspaceDir,
      localMigrationCount: localMigrations.length,
      appliedHashCount: 0,
      expectedTables,
      missingTables: [],
      migrationHashes: [],
      diagnosis: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
