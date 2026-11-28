import { join } from "node:path";
import { Effect } from "effect";
import type { DatabaseBinding } from "../../db/bindings";
import { DEFAULT_MIGRATION_JOURNAL, pluginMigrationSlug } from "../../db/core";
import { createDatabaseDriver } from "../../db/driver";
import {
  loadMigrations,
  type Migration,
  type MigrationDatabase,
  runMigrations,
} from "../../db/run-migrations";
import { type DoctorReport, diagnosePlugin } from "./doctor";

export interface RepairResult {
  status: "repaired" | "refused" | "error";
  diagnosis: DoctorReport;
  message: string;
}

export interface RepairDeps {
  /**
   * Driver opener for the re-apply pass. Defaults to `createDatabaseDriver` —
   * the runtime's own seam, which creates the data schema and scopes the
   * connections to it — so the re-apply replays exactly what a boot replays.
   */
  openDatabase?: (
    url: string,
    namespace: string | undefined,
    journalLockKey: string,
  ) => Promise<{ db: MigrationDatabase; close: () => Promise<void> }>;
}

function isSharedJournalCoords(schema: string, table: string): boolean {
  return schema === DEFAULT_MIGRATION_JOURNAL.schema && table === DEFAULT_MIGRATION_JOURNAL.table;
}

/**
 * The data schema the runtime scopes this workspace's tables into —
 * `plugin_<slug>` for plugins (the `databaseLayer` default), `public`
 * (`undefined`) for the api shell and auth (`namespace: false`). Mirrors
 * `pluginSchemaName`/`detectDrift`'s `schemaName` handling (#663).
 */
function workspaceDataSchema(binding: DatabaseBinding): string | undefined {
  return binding.section === "plugins" ? `plugin_${pluginMigrationSlug(binding.key)}` : undefined;
}

async function defaultOpenDatabase(
  url: string,
  namespace: string | undefined,
  journalLockKey: string,
): Promise<{ db: MigrationDatabase; close: () => Promise<void> }> {
  const driver = await createDatabaseDriver(url, {}, namespace, journalLockKey);
  return { db: driver.db as unknown as MigrationDatabase, close: driver.close };
}

/**
 * Re-apply the workspace's migrations the way a boot would: the runtime
 * runner (`runMigrations`) under the workspace's data schema, journaling into
 * the workspace's own journal — not a drizzle-kit pass, whose config has no
 * notion of the v2 data schema and lands tables in the session `search_path`
 * (`public`), unable to fix the very drift the repair targets (#664).
 */
async function reapplyWithRuntimeRunner(
  binding: DatabaseBinding,
  dataSchema: string | undefined,
  deps: RepairDeps,
): Promise<{ applied: number; total: number } | { skipped: string }> {
  const workspaceDir = binding.identity.workspaceDir;
  if (!workspaceDir) return { skipped: "no local workspace directory" };

  let migrations: Migration[];
  try {
    const loaded = await Effect.runPromise(
      loadMigrations({ fromDir: join(workspaceDir, "src", "db") }),
    );
    migrations = loaded.migrations;
  } catch (error) {
    return {
      skipped: `local migrations could not be loaded (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
  if (migrations.length === 0) return { skipped: "no local migrations found" };

  const openDatabase = deps.openDatabase ?? defaultOpenDatabase;
  const driver = await openDatabase(
    binding.url,
    dataSchema,
    `${binding.identity.journal.schema}.${binding.identity.journal.table}`,
  );
  try {
    const report = await Effect.runPromise(
      runMigrations(driver.db, migrations, {
        journal: binding.identity.journal,
        schemaName: dataSchema,
      }),
    );
    return { applied: report.applied, total: report.total };
  } finally {
    await driver.close();
  }
}

export async function repairPlugin(
  binding: DatabaseBinding,
  mode: "history-reset" | "recreate",
  deps: RepairDeps = {},
): Promise<RepairResult> {
  const diagnosis = await diagnosePlugin(binding);

  if (diagnosis.diagnosis === "error") {
    return {
      status: "refused",
      diagnosis,
      message: `Cannot repair — diagnosis failed: ${diagnosis.error}`,
    };
  }

  if (mode === "recreate") {
    return {
      status: "refused",
      diagnosis,
      message:
        "Recreate mode is not supported without per-plugin database schemas. Use --mode history-reset instead.",
    };
  }

  if (diagnosis.diagnosis !== "drift-safe-repair") {
    if (diagnosis.diagnosis === "healthy") {
      return { status: "refused", diagnosis, message: "Database is healthy — no repair needed." };
    }
    if (diagnosis.diagnosis === "no-local-migrations") {
      return {
        status: "refused",
        diagnosis,
        message: "No local migrations found for this plugin.",
      };
    }
    if (diagnosis.diagnosis === "drift-manual") {
      return {
        status: "refused",
        diagnosis,
        message:
          `Partial drift detected (${diagnosis.missingTables.length}/${diagnosis.expectedTables.length} tables missing). ` +
          "Manual intervention required — some tables exist but schema is incomplete.",
      };
    }
    if (diagnosis.diagnosis === "unapplied") {
      return {
        status: "refused",
        diagnosis,
        message: "Migrations have not been applied yet. Start the dev server to apply them.",
      };
    }
    if (diagnosis.diagnosis === "untracked-existing-schema") {
      return {
        status: "refused",
        diagnosis,
        message:
          "Tables exist but no matching migration history was found. " +
          "Run `drizzle-kit pull --init` in the plugin workspace to adopt the existing schema, " +
          "then run migrations from that baseline.",
      };
    }
    return {
      status: "refused",
      diagnosis,
      message: `Cannot repair — diagnosis: ${diagnosis.diagnosis}`,
    };
  }

  // drift-safe-repair: clear this workspace's recorded history, then replay
  // through the runtime runner under the workspace's data schema.
  const journalRef = `"${diagnosis.journalSchema}"."${diagnosis.journalTable}"`;
  const sharedJournal = isSharedJournalCoords(diagnosis.journalSchema, diagnosis.journalTable);
  const dataSchema = workspaceDataSchema(binding);

  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: binding.url,
    ssl:
      binding.url.includes("localhost") || binding.url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    if (sharedJournal) {
      // The legacy shared journal records every workspace on the database —
      // only the rows this workspace's own migrations reference may go. The
      // pre-#664 `DROP TABLE` wiped every sibling's history with it.
      await pool.query(`DELETE FROM ${journalRef} WHERE hash = ANY($1)`, [
        diagnosis.migrationHashes,
      ]);
    } else {
      // Per-workspace journal (ADR 0045): every row is this workspace's by
      // construction, so dropping the table resets only its history.
      await pool.query(`DROP TABLE IF EXISTS ${journalRef}`);
    }

    if (!binding.identity.workspaceDir) {
      return {
        status: "repaired",
        diagnosis,
        message:
          `Migration history reset for ${diagnosis.plugin}. ` +
          "No local workspace — start the dev server to reapply migrations.",
      };
    }

    try {
      const reapply = await reapplyWithRuntimeRunner(binding, dataSchema, deps);
      if ("skipped" in reapply) {
        return {
          status: "repaired",
          diagnosis,
          message:
            `Migration history reset for ${diagnosis.plugin}. ` +
            `Automatic reapply skipped: ${reapply.skipped}. ` +
            "Start the dev server to reapply migrations.",
        };
      }
      return {
        status: "repaired",
        diagnosis,
        message:
          `Migration history reset for ${diagnosis.plugin}. ` +
          `Reapplied ${reapply.applied}/${reapply.total} migration(s) under schema ${dataSchema ?? "public"} ` +
          "via the runtime runner. Restart the dev server to confirm.",
      };
    } catch (error) {
      return {
        status: "repaired",
        diagnosis,
        message:
          `Migration history reset for ${diagnosis.plugin}. ` +
          `Automatic reapply failed: ${error instanceof Error ? error.message : String(error)}. ` +
          "Start the dev server to reapply migrations.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      diagnosis,
      message: `Repair failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}
