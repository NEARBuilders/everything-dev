import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BosConfig, BosConfigSchema } from "../../types";
import { readLocalAuthoredConfigInput } from "./load";
import { type BosEnv, isPlainObject, type ResolvedConfigMeta, rebuildOrderedConfig } from "./merge";

const RESOLVED_CONFIG_FILENAME = "bos.resolved-config.json";

export function getResolvedConfigPath(configDir: string): string {
  return join(configDir, ".bos", RESOLVED_CONFIG_FILENAME);
}

export function loadGeneratedResolvedConfig(configDir: string): BosConfig | null {
  const resolvedPath = getResolvedConfigPath(configDir);
  if (!existsSync(resolvedPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"));
    if (!isPlainObject(raw)) return null;
    const { _resolved, ...configData } = raw;
    return BosConfigSchema.parse(configData);
  } catch {
    return null;
  }
}

export function writeResolvedConfig(
  configDir: string,
  config: BosConfig,
  env: BosEnv,
  extendsChain?: string[],
  source?: string,
): void {
  const resolvedPath = getResolvedConfigPath(configDir);
  const resolvedDir = dirname(resolvedPath);
  if (!existsSync(resolvedDir)) {
    mkdirSync(resolvedDir, { recursive: true });
  }

  const ordered = rebuildOrderedConfig(config);
  const meta: ResolvedConfigMeta = {
    env,
    resolvedAt: new Date().toISOString(),
    extendsChain: extendsChain ?? [],
    ...(source ? { source } : {}),
  };
  const output = {
    _resolved: meta,
    ...ordered,
  };

  const content = `${JSON.stringify(output, null, 2)}\n`;
  try {
    if (readFileSync(resolvedPath, "utf-8") === content) return;
  } catch {
    // file doesn't exist yet
  }
  // Atomic rename, not a plain write: concurrent dev sessions in one config
  // dir are a supported flow, and a plain write can hand the other session a
  // half-written file (torn read) — a missing plugins.localPath then flips
  // the contract-bridge sweep into deleting that plugin's fresh gen files.
  const tempPath = `${resolvedPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, resolvedPath);
}

export function resolveBosConfigPath(configDir: string): string {
  const resolvedPath = getResolvedConfigPath(configDir);
  if (existsSync(resolvedPath)) return resolvedPath;
  return join(configDir, "bos.config.json");
}

export async function readBosConfigForBuild(configDir: string): Promise<Record<string, unknown>> {
  const resolvedPath = getResolvedConfigPath(configDir);
  if (existsSync(resolvedPath)) {
    try {
      const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"));
      if (isPlainObject(raw)) {
        const { _resolved, ...configData } = raw;
        return configData as Record<string, unknown>;
      }
    } catch (e) {
      console.warn(
        `[Config] Failed to parse _resolved.json, falling back to the authored config: ${String(e)}`,
      );
    }
  }
  // Form-aware fallback: the authored `bos.app.ts` descriptor is canonical —
  // a TS-form child has no committed bos.config.json to parse.
  const authored = await readLocalAuthoredConfigInput(configDir);
  if (authored) return authored as unknown as Record<string, unknown>;
  const bosConfigPath = join(configDir, "bos.config.json");
  return JSON.parse(readFileSync(bosConfigPath, "utf-8")) as Record<string, unknown>;
}
