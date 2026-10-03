import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { DatabaseBinding, DrizzleKitService } from "../db";
import { type DoctorReport, diagnosePlugin } from "./db-doctor";

export interface RepairResult {
  status: "repaired" | "refused" | "error";
  diagnosis: DoctorReport;
  message: string;
}

export async function repairPlugin(
  binding: DatabaseBinding,
  mode: "history-reset" | "recreate",
  drizzleKit: DrizzleKitService,
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

  // drift-safe-repair: drop the journal and replay
  const { Pool } = await import("pg");
  const journalRef = `"${diagnosis.journalSchema}"."${diagnosis.journalTable}"`;
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
    await pool.query(`DROP TABLE IF EXISTS ${journalRef}`);

    if (binding.identity.workspaceDir) {
      const configPath = join(binding.identity.workspaceDir, "drizzle.config.ts");
      if (existsSync(configPath)) {
        try {
          await Effect.runPromise(drizzleKit.migrate(binding));
          return {
            status: "repaired",
            diagnosis,
            message:
              `Migration history reset for ${diagnosis.plugin}. ` +
              `Migrations reapplied via drizzle-kit. Restart the dev server to confirm.`,
          };
        } catch (error) {
          return {
            status: "repaired",
            diagnosis,
            message:
              `Migration history reset for ${diagnosis.plugin}. ` +
              `Automatic reapply failed: ${error instanceof Error ? error.message : String(error)}. ` +
              `Run \`bun run --cwd ${binding.identity.workspaceDir} db:migrate\` manually.`,
          };
        }
      }
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

  return {
    status: "repaired",
    diagnosis,
    message:
      `Migration history reset for ${diagnosis.plugin}. ` +
      "No local drizzle.config.ts found — start the dev server to reapply migrations.",
  };
}
