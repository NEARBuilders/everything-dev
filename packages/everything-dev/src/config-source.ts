import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Data, Effect } from "effect";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isPlainObject } from "./merge";
import type { BosConfigInput } from "./types";

export const CONFIG_FILENAMES = ["bos.config.toml", "bos.config.json"] as const;

export class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
  path: string;
  cause: unknown;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  path: string;
  format: "toml" | "json";
  cause: unknown;
}> {}

export class ConfigBothExistError extends Data.TaggedError("ConfigBothExistError")<{
  dir: string;
}> {}

export type ConfigSourceError = ConfigReadError | ConfigParseError | ConfigBothExistError;

function detectFormat(path: string, content: string): "toml" | "json" {
  if (path.endsWith(".toml")) return "toml";
  if (path.endsWith(".json")) return "json";
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed[0] === "{" ? "json" : "toml";
}

export const readBosConfigSourceEff = (
  configPath: string,
): Effect.Effect<BosConfigInput, ConfigReadError | ConfigParseError, never> =>
  Effect.gen(function* () {
    const content = yield* Effect.try({
      try: () => readFileSync(configPath, "utf-8"),
      catch: (error) => new ConfigReadError({ path: configPath, cause: error }),
    });

    const format = detectFormat(configPath, content);

    return yield* Effect.try({
      try: () =>
        format === "toml"
          ? (parseToml(content) as unknown as BosConfigInput)
          : (JSON.parse(content) as BosConfigInput),
      catch: (error) => new ConfigParseError({ path: configPath, format, cause: error }),
    });
  });

export const findBosConfigPathEff = (
  dir: string,
): Effect.Effect<string | null, ConfigBothExistError, never> =>
  Effect.gen(function* () {
    let current = resolve(dir);
    while (current !== "/") {
      const tomlPath = join(current, "bos.config.toml");
      const jsonPath = join(current, "bos.config.json");
      const hasToml = existsSync(tomlPath);
      const hasJson = existsSync(jsonPath);

      if (hasToml && hasJson) {
        return yield* Effect.fail(new ConfigBothExistError({ dir: current }));
      }
      if (hasToml) return tomlPath;
      if (hasJson) return jsonPath;

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  });

const RESOLVED_CONFIG_FILENAME = "bos.resolved-config.json";

export const readBosConfigWithResolvedFallbackEff = (
  configDir: string,
): Effect.Effect<Record<string, unknown>, ConfigSourceError, never> =>
  Effect.gen(function* () {
    const resolvedPath = join(configDir, ".bos", RESOLVED_CONFIG_FILENAME);
    if (existsSync(resolvedPath)) {
      const raw = yield* Effect.try({
        try: () => JSON.parse(readFileSync(resolvedPath, "utf-8")),
        catch: (error) =>
          new ConfigParseError({ path: resolvedPath, format: "json", cause: error }),
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            `[Config] Failed to parse ${resolvedPath}, falling back to source: ${error}`,
          ),
        ),
        Effect.catchAll(() => Effect.succeed(null)),
      );

      if (isPlainObject(raw)) {
        const { _resolved: _ignored, ...configData } = raw as Record<string, unknown>;
        if (Object.keys(configData).length > 0) {
          return configData;
        }
      }
    }

    const sourcePath = yield* findBosConfigPathEff(configDir);
    if (!sourcePath) {
      return yield* Effect.fail(
        new ConfigReadError({
          path: join(configDir, "bos.config.json"),
          cause: new Error("No bos.config.toml or bos.config.json found"),
        }),
      );
    }
    const config = yield* readBosConfigSourceEff(sourcePath);
    return config as unknown as Record<string, unknown>;
  });

function stripNulls(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripNulls(val);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (Array.isArray(value)) {
    const arr = value.map((item) => stripNulls(item)).filter((item) => item !== undefined);
    return arr.length > 0 ? arr : undefined;
  }
  return value;
}

export function stringifyBosConfig(value: Record<string, unknown>): string {
  const cleaned = stripNulls(value);
  if (
    !cleaned ||
    (typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0)
  ) {
    return "";
  }
  return stringifyToml(cleaned);
}

export function findFormat(configPath: string): "json" | "toml" {
  return detectFormat(configPath, "");
}

export function readBosConfigSource(configPath: string): BosConfigInput {
  const content = readFileSync(configPath, "utf-8");
  const format = detectFormat(configPath, content);
  if (format === "toml") {
    return parseToml(content) as unknown as BosConfigInput;
  }
  return JSON.parse(content) as BosConfigInput;
}

export function findBosConfigPathInDir(dir: string): string | null {
  const tomlPath = join(dir, "bos.config.toml");
  const jsonPath = join(dir, "bos.config.json");
  if (existsSync(tomlPath) && existsSync(jsonPath)) {
    throw new Error(
      `Both bos.config.toml and bos.config.json exist in ${dir}. Remove one of them.`,
    );
  }
  if (existsSync(tomlPath)) return tomlPath;
  if (existsSync(jsonPath)) return jsonPath;
  return null;
}

export function findBosConfigPath(dir: string): string | null {
  let current = resolve(dir);
  while (current !== "/") {
    const tomlPath = join(current, "bos.config.toml");
    const jsonPath = join(current, "bos.config.json");
    const hasToml = existsSync(tomlPath);
    const hasJson = existsSync(jsonPath);

    if (hasToml && hasJson) {
      throw new Error(
        `Both bos.config.toml and bos.config.json exist in ${current}. Remove one of them.`,
      );
    }
    if (hasToml) return tomlPath;
    if (hasJson) return jsonPath;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function readBosConfigWithResolvedFallback(configDir: string): Record<string, unknown> {
  const resolvedPath = join(configDir, ".bos", RESOLVED_CONFIG_FILENAME);
  if (existsSync(resolvedPath)) {
    try {
      const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"));
      if (isPlainObject(raw)) {
        const { _resolved: _ignored, ...configData } = raw as Record<string, unknown>;
        if (Object.keys(configData).length > 0) {
          return configData;
        }
      }
    } catch (e) {
      console.warn(`[Config] Failed to parse ${resolvedPath}, falling back to source: ${e}`);
    }
  }

  const sourcePath = findBosConfigPathInDir(configDir);
  if (!sourcePath) {
    throw new Error(`No bos.config.toml or bos.config.json found in ${configDir}`);
  }
  return readBosConfigSource(sourcePath) as unknown as Record<string, unknown>;
}
