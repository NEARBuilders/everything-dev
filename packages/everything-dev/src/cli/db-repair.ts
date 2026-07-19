import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SHARED_MIGRATION_STORAGE } from "../db";
import { type DoctorReport, diagnosePlugin } from "./db-doctor";
import type { PluginDbInfo } from "./db-studio";

export interface RepairResult {
  status: "repaired" | "refused" | "error";
  diagnosis: DoctorReport;
  message: string;
}

export async function repairPlugin(
  info: PluginDbInfo,
  mode: "history-reset" | "recreate",
): Promise<RepairResult> {
  const diagnosis = await diagnosePlugin(info);

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
        "Recreate mode is not supported without per-plugin schemas. Use --mode history-reset instead.",
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

  // drift-safe-repair: drop the shared journal and replay
  const { Pool } = await import("pg");
  const journalRef = `"${SHARED_MIGRATION_STORAGE.schema}"."${SHARED_MIGRATION_STORAGE.table}"`;
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
    await pool.query(`DROP TABLE IF EXISTS ${journalRef}`);

    if (info.workspaceDir) {
      const configPath = join(info.workspaceDir, "drizzle.config.ts");
      if (existsSync(configPath)) {
        try {
          await spawnDrizzleMigrate(info.workspaceDir, configPath);
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
              `Run \`bun run --cwd ${info.workspaceDir} db:migrate\` manually.`,
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

function spawnDrizzleMigrate(cwd: string, configPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["drizzle-kit", "migrate", "--config", configPath], {
      cwd,
      stdio: "pipe",
      shell: true,
    });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => reject(err));

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`drizzle-kit migrate exited with code ${code}: ${stderr}`));
      }
    });
  });
}
