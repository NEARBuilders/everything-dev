import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localConfigEntryPath } from "../config";
import { serializeAppDescriptorSource } from "../descriptor/serialize";
import { rebuildOrderedConfig } from "../merge";
import type { BosConfig, BosConfigInput } from "../types";

/**
 * Persists config changes onto the project's authored surface: the authored
 * `bos.app.ts` descriptor when present (the serializer drops pipeline state —
 * production URLs and integrity), else the legacy `bos.config.json` as-is.
 */
export async function saveBosConfig(
  configDir: string,
  config: BosConfig | BosConfigInput | Record<string, unknown>,
): Promise<void> {
  const entryPath = localConfigEntryPath(configDir);
  if (entryPath?.endsWith(".app.ts")) {
    writeFileSync(entryPath, serializeAppDescriptorSource(config as BosConfigInput));
    return;
  }

  const filePath = join(configDir, "bos.config.json");
  const ordered = rebuildOrderedConfig(config as Record<string, unknown>);
  const next = `${JSON.stringify(ordered, null, 2)}\n`;
  try {
    if (readFileSync(filePath, "utf8") === next) return;
  } catch {
    // file does not exist yet
  }

  writeFileSync(filePath, next);
}
