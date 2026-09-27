import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import { bindingEnv } from "./binding";
import type { DatabaseBinding } from "./bindings";

export class DrizzleKitError extends Data.TaggedError("DrizzleKitError")<{
  readonly command: string;
  readonly message: string;
  readonly exitCode: number | undefined;
}> {}

export interface DrizzleKitService {
  readonly studio: (binding: DatabaseBinding) => Effect.Effect<void, DrizzleKitError>;
  readonly migrate: (binding: DatabaseBinding) => Effect.Effect<void, DrizzleKitError>;
}

export class DrizzleKit extends Context.Service<DrizzleKit, DrizzleKitService>()(
  "everything-dev/DrizzleKit",
) {}

interface SpawnSpec {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly command: string;
  readonly stdio: "inherit" | "pipe";
}

/**
 * The single choke point for invoking drizzle-kit. Every child receives the
 * composition root's materialized environment (`bindingEnv`) so the config it
 * evaluates never has to re-derive credentials from ambient state.
 */
function spawnDrizzleKit(spec: SpawnSpec): Effect.Effect<void, DrizzleKitError> {
  return Effect.callback((resume) => {
    let stderr = "";
    let settled = false;
    const settle = (effect: Effect.Effect<void, DrizzleKitError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: spec.stdio,
    });

    if (spec.stdio === "pipe") {
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    child.on("error", (err) => {
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? '"npx" not found. Ensure Node.js is installed.'
          : err.message;
      settle(
        Effect.fail(
          new DrizzleKitError({ command: spec.command, message: hint, exitCode: undefined }),
        ),
      );
    });

    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        settle(Effect.void);
        return;
      }
      settle(
        Effect.fail(
          new DrizzleKitError({
            command: spec.command,
            message: `drizzle-kit ${spec.command} exited with code ${code}${
              stderr.trim() ? `: ${stderr.trim()}` : ""
            }`,
            exitCode: code,
          }),
        ),
      );
    });

    return Effect.sync(() => {
      if (child.exitCode === null && !child.killed) child.kill();
    });
  });
}

function childEnv(binding: DatabaseBinding): Record<string, string | undefined> {
  return {
    ...process.env,
    ...bindingEnv({ secretName: binding.identity.secretName, url: binding.url }),
  };
}

function workspaceConfigPath(binding: DatabaseBinding): string | undefined {
  const workspaceDir = binding.identity.workspaceDir;
  if (!workspaceDir) return undefined;
  const configPath = join(workspaceDir, "drizzle.config.ts");
  return existsSync(configPath) ? configPath : undefined;
}

function writeGeneratedConfig(binding: DatabaseBinding, projectDir: string): string {
  const dbDir = resolve(projectDir, ".bos", "db", binding.key);
  mkdirSync(dbDir, { recursive: true });

  const configPath = join(dbDir, "drizzle.config.ts");
  const configContent = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: "${binding.url}",
  },
  migrations: {
    schema: "${binding.identity.journal.schema}",
    table: "${binding.identity.journal.table}",
  },
  verbose: true,
  strict: true,
});
`;

  writeFileSync(configPath, configContent);
  return dbDir;
}

export interface DrizzleKitOptions {
  readonly projectDir: string;
  readonly onLog?: (message: string) => void;
}

export const makeDrizzleKitLive = (options: DrizzleKitOptions): Layer.Layer<DrizzleKit> =>
  Layer.succeed(DrizzleKit, {
    studio: (binding) =>
      Effect.gen(function* () {
        const localConfig = workspaceConfigPath(binding);

        if (localConfig && binding.identity.workspaceDir) {
          options.onLog?.(`Starting Drizzle Studio for ${binding.key} (local)...`);
          yield* spawnDrizzleKit({
            args: ["drizzle-kit", "studio", "--config", localConfig],
            cwd: binding.identity.workspaceDir,
            env: childEnv(binding),
            command: "studio",
            stdio: "inherit",
          });
          return;
        }

        if (binding.source === "local") {
          return yield* Effect.fail(
            new DrizzleKitError({
              command: "studio",
              message:
                `No drizzle.config.ts found in ${binding.identity.workspaceDir ?? binding.key}. ` +
                `Run 'drizzle-kit init' first in the plugin workspace.`,
              exitCode: undefined,
            }),
          );
        }

        options.onLog?.(`Introspecting database schema for ${binding.key}...`);
        const dbDir = writeGeneratedConfig(binding, options.projectDir);
        yield* spawnDrizzleKit({
          args: ["drizzle-kit", "pull", "--config", join(dbDir, "drizzle.config.ts")],
          cwd: dbDir,
          env: childEnv(binding),
          command: "pull",
          stdio: "inherit",
        }).pipe(
          Effect.mapError(
            (error) =>
              new DrizzleKitError({
                command: "pull",
                exitCode: error.exitCode,
                message:
                  `Failed to introspect database for "${binding.key}". ` +
                  `Check that ${binding.identity.secretName} is correct and the database is reachable. ` +
                  error.message,
              }),
          ),
        );

        options.onLog?.(`Starting Drizzle Studio for ${binding.key}...`);
        yield* spawnDrizzleKit({
          args: ["drizzle-kit", "studio", "--config", join(dbDir, "drizzle.config.ts")],
          cwd: dbDir,
          env: childEnv(binding),
          command: "studio",
          stdio: "inherit",
        });
      }),

    migrate: (binding) => {
      const configPath = workspaceConfigPath(binding);
      if (!configPath || !binding.identity.workspaceDir) {
        return Effect.fail(
          new DrizzleKitError({
            command: "migrate",
            message: `No drizzle.config.ts found in ${binding.identity.workspaceDir ?? binding.key}.`,
            exitCode: undefined,
          }),
        );
      }
      return spawnDrizzleKit({
        args: ["drizzle-kit", "migrate", "--config", configPath],
        cwd: binding.identity.workspaceDir,
        env: childEnv(binding),
        command: "migrate",
        stdio: "pipe",
      });
    },
  });
