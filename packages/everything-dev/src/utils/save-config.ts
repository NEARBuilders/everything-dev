import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebuildOrderedConfig } from "../merge";
import type { BosConfig } from "../types";

export async function saveBosConfig(
  configDir: string,
  config: BosConfig | Record<string, unknown>,
): Promise<void> {
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
