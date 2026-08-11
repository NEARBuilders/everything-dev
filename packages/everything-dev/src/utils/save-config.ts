import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findBosConfigPath, stringifyBosConfig } from "../config-source";
import { rebuildOrderedConfig } from "../merge";
import type { BosConfig } from "../types";

export async function saveBosConfig(
  configDir: string,
  config: BosConfig | Record<string, unknown>,
  format?: "json" | "toml",
): Promise<void> {
  const existingPath = findBosConfigPath(configDir);
  const forceToml = format === "toml";
  const forceJson = format === "json";
  const isToml = forceToml ? true : forceJson ? false : (existingPath?.endsWith(".toml") ?? true);
  const filePath = forceToml
    ? join(configDir, "bos.config.toml")
    : forceJson
      ? join(configDir, "bos.config.json")
      : (existingPath ?? join(configDir, "bos.config.toml"));

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
