import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findBosConfigPath, stringifyBosConfig } from "../config-source";
import { rebuildOrderedConfig } from "../merge";
import type { BosConfig } from "../types";

export async function saveBosConfig(
  configDir: string,
  config: BosConfig | Record<string, unknown>,
): Promise<void> {
  const existingPath = findBosConfigPath(configDir);
  const isToml = existingPath?.endsWith(".toml") ?? false;
  const filePath = existingPath ?? join(configDir, "bos.config.json");

  const ordered = rebuildOrderedConfig(config as Record<string, unknown>);
  const next = isToml
    ? `${stringifyBosConfig(ordered)}\n`
    : `${JSON.stringify(ordered, null, 2)}\n`;

  try {
    if (readFileSync(filePath, "utf8") === next) return;
  } catch {
    // file does not exist yet
  }

  writeFileSync(filePath, next);
}
