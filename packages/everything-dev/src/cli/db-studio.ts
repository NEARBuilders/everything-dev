import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { getMigrationStorage, pluginMigrationSlug } from "../db";
import type { RuntimeConfig } from "../types";

export interface PluginDbInfo {
  key: string;
  source: "local" | "remote";
  section: "app.api" | "app.auth" | "plugins";
  databaseSecret: string;
  databaseUrl: string;
  workspaceDir?: string;
  projectDir: string;
}

export function resolvePluginDbInfo(
  pluginKey: string,
  runtimeConfig: RuntimeConfig,
  projectDir: string,
): PluginDbInfo {
  let source: "local" | "remote" | undefined;
  let section: PluginDbInfo["section"];
  let secrets: string[] | undefined;
  let localPath: string | undefined;
  let key: string;

  if (pluginKey === "api" && runtimeConfig.api) {
    source = runtimeConfig.api.source;
    section = "app.api";
    secrets = runtimeConfig.api.secrets;
    localPath = runtimeConfig.api.localPath;
    key = "api";
  } else if (pluginKey === "auth" && runtimeConfig.auth) {
    source = runtimeConfig.auth.source;
    section = "app.auth";
    secrets = runtimeConfig.auth.secrets;
    localPath = runtimeConfig.auth.localPath;
    key = "auth";
  } else if (runtimeConfig.plugins?.[pluginKey]) {
    const plugin = runtimeConfig.plugins[pluginKey];
    source = plugin.source;
    section = "plugins";
    secrets = plugin.secrets;
    localPath = plugin.localPath;
    key = pluginKey;
  } else {
    throw new Error(
      `Plugin "${pluginKey}" not found in app.api, app.auth, or plugins. ` +
        `Available: ${[
          "api",
          ...(runtimeConfig.auth ? ["auth"] : []),
          ...Object.keys(runtimeConfig.plugins ?? {}),
        ].join(", ")}`,
    );
  }

  const dbSecret = secrets?.find((s) => s.endsWith("_DATABASE_URL"));
  if (!dbSecret) {
    throw new Error(
      `Plugin "${pluginKey}" has no database secret (no secret ending in _DATABASE_URL). ` +
        `Secrets: ${(secrets ?? []).join(", ") || "none"}`,
    );
  }

  const dbUrl = process.env[dbSecret];
  if (!dbUrl) {
    throw new Error(
      `.env missing ${dbSecret} for plugin "${pluginKey}". ` +
        `Add it to your .env file (see .env.example).`,
    );
  }

  return {
    key,
    source: source ?? "remote",
    section,
    databaseSecret: dbSecret,
    databaseUrl: dbUrl,
    workspaceDir: localPath,
    projectDir,
  };
}

export async function runStudioLocal(info: PluginDbInfo): Promise<void> {
  const workspaceRoot = info.workspaceDir
    ? resolve(info.projectDir, info.workspaceDir)
    : resolve(info.projectDir, info.key);
  const configPath = join(workspaceRoot, "drizzle.config.ts");

  if (!existsSync(configPath)) {
    throw new Error(
      `No drizzle.config.ts found in ${workspaceRoot}. ` +
        `Run 'drizzle-kit init' first in the plugin workspace.`,
    );
  }

  p.log.info(`Starting Drizzle Studio for ${info.key} (local)...`);

  await spawnAsync("npx", ["drizzle-kit", "studio", "--config", configPath], {
    cwd: workspaceRoot,
  });
}

export async function runStudioRemote(info: PluginDbInfo): Promise<void> {
  const dbDir = resolve(info.projectDir, ".bos", "db", info.key);

  mkdirSync(dbDir, { recursive: true });

  const storage = getMigrationStorage(pluginMigrationSlug(info.key));
  const journalSchema = storage.schema;
  const journalTable = storage.table;

  const configPath = join(dbDir, "drizzle.config.ts");
  const configContent = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: "${info.databaseUrl}",
  },
  migrations: {
    schema: "${journalSchema}",
    table: "${journalTable}",
  },
  verbose: true,
  strict: true,
});
`;

  writeFileSync(configPath, configContent);

  p.log.info(`Introspecting database schema for ${info.key}...`);
  try {
    await spawnAsync("npx", ["drizzle-kit", "pull", "--config", configPath], {
      cwd: dbDir,
    });
  } catch {
    throw new Error(
      `Failed to introspect database for "${info.key}". ` +
        `Check that ${info.databaseSecret} is correct and the database is reachable.`,
    );
  }

  p.log.info(`Starting Drizzle Studio for ${info.key}...`);
  await spawnAsync("npx", ["drizzle-kit", "studio", "--config", configPath], {
    cwd: dbDir,
  });
}

function spawnAsync(cmd: string, args: string[], options: { cwd: string }): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: "inherit",
      shell: true,
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `"${cmd}" not found. Ensure it is installed (e.g. 'npm install -g drizzle-kit').`,
          ),
        );
      } else {
        reject(new Error(`Failed to start ${cmd}: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolvePromise();
      } else {
        reject(new Error(`"${cmd}" exited with code ${code}`));
      }
    });
  });
}
