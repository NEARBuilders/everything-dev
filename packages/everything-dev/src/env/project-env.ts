import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import * as p from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import { Context, Data, Effect, Layer } from "effect";

export class EnvEnsureError extends Data.TaggedError("EnvEnsureError")<{ cause: unknown }> {}

export class EnvLoadError extends Data.TaggedError("EnvLoadError")<{ cause: unknown }> {}

export interface EnvDrift {
  key: string;
  from: string | undefined;
  to: string;
}

export class EnvSyncError extends Data.TaggedError("EnvSyncError")<{ cause: unknown }> {}

/**
 * The process environment as exported by the parent shell. Values present
 * here were explicitly provided by the caller (shell, CI, the regression
 * harness) and therefore outrank planner-generated values; values that only
 * exist after `.env` loading do not. The bootstrap program captures this
 * snapshot as its first step — before any `.env` loading — and provides it
 * to the rest of the program as a service.
 */
export class ShellEnv extends Context.Service<ShellEnv, Record<string, string>>()(
  "everything-dev/ShellEnv",
) {}

export const captureShellEnv: Effect.Effect<Record<string, string>> = Effect.sync(() =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null),
  ),
);

export const ShellEnvLive = (env: Record<string, string>) => Layer.succeed(ShellEnv, env);

/**
 * Align the bos-owned lines of `.env` with the generated infra env
 * (ports/secrets derived from the resolved dev topology). Keys the caller
 * explicitly exported (`shellEnv`) are skipped — a deliberate override must
 * not be silently reverted on disk. Lines the user added outside the
 * generated key set are untouched. Idempotent.
 */
const GENERATED_OWNED_KEYS = new Set(["BASE_URL", "CORS_ORIGIN"]);

const maskValue = (key: string, value: string | undefined): string => {
  if (value === undefined) return "(absent)";
  if (/_DATABASE_URL$|_REDIS_URL$|_SECRET$|_KEY$/.test(key)) {
    return value.replace(/\/\/([^:/@]+):([^@]+)@/, "//***:***@");
  }
  return value;
};

export const syncEnvFile = (
  configDir: string,
  generated: Record<string, string>,
  shellEnv: Record<string, string> = {},
): Effect.Effect<EnvDrift[], EnvSyncError> =>
  Effect.gen(function* () {
    if (Object.keys(generated).length === 0) return [];

    const envPath = join(configDir, ".env");
    if (!existsSync(envPath)) return [];

    const lines = yield* Effect.try({
      try: () => readFileSync(envPath, "utf-8").split("\n"),
      catch: (cause) => new EnvSyncError({ cause }),
    });

    const drift: EnvDrift[] = [];
    const seen = new Set<string>();
    const keyOf = (line: string): string | null => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      return match?.[1] ?? null;
    };

    const updated = lines.map((line) => {
      const key = keyOf(line);
      if (!key || !(key in generated)) return line;
      const shellOwned = key in shellEnv && !GENERATED_OWNED_KEYS.has(key);
      if (shellOwned) return line;
      seen.add(key);
      const value = line.slice(key.length + 1);
      if (value === generated[key]) return line;
      drift.push({ key, from: value, to: generated[key] });
      return `${key}=${generated[key]}`;
    });

    for (const [key, value] of Object.entries(generated)) {
      if (seen.has(key)) continue;
      const shellOwned = key in shellEnv && !GENERATED_OWNED_KEYS.has(key);
      if (shellOwned) continue;
      drift.push({ key, from: undefined, to: value });
      updated.push(`${key}=${value}`);
    }

    if (drift.length > 0) {
      yield* Effect.try({
        try: () => writeFileSync(envPath, updated.join("\n")),
        catch: (cause) => new EnvSyncError({ cause }),
      });
      for (const { key, from, to } of drift) {
        yield* Effect.logInfo(
          `[env] ${key} updated: ${maskValue(key, from)} → ${maskValue(key, to)} (generated from resolved ports)`,
        );
      }
    }
    return drift;
  });

export interface ProjectEnvService {
  readonly ensureFile: (configDir: string) => Effect.Effect<boolean, EnvEnsureError>;
  readonly load: (
    configDir: string,
    options?: { force?: boolean },
  ) => Effect.Effect<void, EnvLoadError>;
  readonly sync: (
    configDir: string,
    generated: Record<string, string>,
    shellEnv: Record<string, string>,
  ) => Effect.Effect<EnvDrift[], EnvSyncError>;
}

export class ProjectEnv extends Context.Service<ProjectEnv, ProjectEnvService>()(
  "everything-dev/ProjectEnv",
) {}

export const makeProjectEnv = (): ProjectEnvService => {
  const loadedDirs = new Set<string>();
  return {
    ensureFile: (configDir) =>
      Effect.try({
        try: () => {
          const envPath = join(configDir, ".env");
          const examplePath = join(configDir, ".env.example");
          if (existsSync(envPath) || !existsSync(examplePath)) return false;

          const content = readFileSync(examplePath, "utf-8");
          const lines = content.split("\n");
          const secret = randomBytes(32).toString("base64url");
          const updated = lines
            .map((line) => {
              if (line.startsWith("BETTER_AUTH_SECRET=")) {
                return `BETTER_AUTH_SECRET=${secret}`;
              }
              return line;
            })
            .join("\n");

          writeFileSync(envPath, updated);
          p.log.info("Created .env from generated .env.example with generated BETTER_AUTH_SECRET");
          return true;
        },
        catch: (cause) => new EnvEnsureError({ cause }),
      }),
    load: (configDir, options) =>
      Effect.gen(function* () {
        if (!options?.force && loadedDirs.has(configDir)) return;
        const envPath = join(configDir, ".env");
        if (!existsSync(envPath)) return;

        yield* Effect.try({
          try: () => loadDotenv({ path: envPath, processEnv: process.env, quiet: true }),
          catch: (cause) => new EnvLoadError({ cause }),
        });
        loadedDirs.add(configDir);
      }),
    sync: (configDir, generated, shellEnv) => syncEnvFile(configDir, generated, shellEnv),
  };
};

export const ProjectEnvLive: Layer.Layer<ProjectEnv> = Layer.sync(ProjectEnv, () =>
  makeProjectEnv(),
);
