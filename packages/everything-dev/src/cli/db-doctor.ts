import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractExpectedTables, SHARED_MIGRATION_STORAGE } from "../db";
import type { PluginDbInfo } from "./db-studio";

export interface DoctorReport {
  plugin: string;
  slug: string;
  journalTable: string;
  journalSchema: string;
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

export async function diagnosePlugin(info: PluginDbInfo): Promise<DoctorReport> {
  const { Pool } = await import("pg");

  const slug = "shared";
  const journalTable = SHARED_MIGRATION_STORAGE.table;
  const journalSchema = SHARED_MIGRATION_STORAGE.schema;
  const journalRef = `"${journalSchema}"."${journalTable}"`;

  const localMigrations = info.workspaceDir ? readLocalMigrations(info.workspaceDir) : [];

  const expectedTables = extractExpectedTables(localMigrations);
  const localHashes = localMigrations.map((m) => m.hash).filter(Boolean);
  const migrationHashes = localHashes;

  const pool = new Pool({
    connectionString: info.databaseUrl,
    ssl:
      info.databaseUrl.includes("localhost") || info.databaseUrl.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const journalExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = '${journalSchema}' AND table_name = '${journalTable}'
      ) AS exists
    `);

    let appliedHashCount = 0;
    if (journalExists.rows[0]?.exists) {
      const result = await pool.query(`SELECT hash FROM ${journalRef}`);
      appliedHashCount = result.rows.length;
    }

    let missingTables: string[] = [];
    if (expectedTables.length > 0) {
      const tableResult = await pool.query(
        `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1)
      `,
        [expectedTables],
      );
      const existing = new Set(tableResult.rows.map((r: any) => r.table_name));
      missingTables = expectedTables.filter((t) => !existing.has(t));
    }

    let diagnosis: string;
    if (localMigrations.length === 0) {
      diagnosis = "no-local-migrations";
    } else if (appliedHashCount === 0 && missingTables.length === 0 && localHashes.length > 0) {
      // Journal is empty but all expected public tables exist.
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

    const masked = info.databaseUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");

    return {
      plugin: info.key,
      slug,
      journalTable,
      journalSchema,
      dbSecret: info.databaseSecret,
      dbUrl: masked,
      workspaceDir: info.workspaceDir,
      localMigrationCount: localMigrations.length,
      appliedHashCount,
      expectedTables,
      missingTables,
      migrationHashes,
      diagnosis,
    };
  } catch (error) {
    return {
      plugin: info.key,
      slug,
      journalTable,
      journalSchema,
      dbSecret: info.databaseSecret,
      dbUrl: info.databaseUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
      workspaceDir: info.workspaceDir,
      localMigrationCount: localMigrations.length,
      appliedHashCount: 0,
      expectedTables,
      missingTables: [],
      migrationHashes: [],
      diagnosis: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await pool.end().catch(() => {});
  }
}
