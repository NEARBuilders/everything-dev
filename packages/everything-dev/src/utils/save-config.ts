import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeAppDescriptorSource } from "../descriptor/serialize";
import { rebuildOrderedConfig } from "../merge";
import type { BosConfig, BosConfigInput } from "../types";

/**
 * Persist a config change back to the project's authored surface.
 *
 * TS-form projects (authored `bos.app.ts`, ADR 0005) get the descriptor
 * re-serialized — the emitted `App()` literal is pipeline-canonical and
 * functionally identical to the authored form. Legacy JSON-form projects
 * (no `bos.app.ts`) keep the `bos.config.json` write.
 */
export async function saveBosConfig(
  configDir: string,
  config: BosConfig | Record<string, unknown>,
): Promise<void> {
  const appPath = join(configDir, "bos.app.ts");
  if (existsSync(appPath)) {
    const source = serializeAppDescriptorSource(config as BosConfigInput);
    try {
      if (readFileSync(appPath, "utf8") === source) return;
    } catch {
      // fall through to write
    }
    writeFileSync(appPath, source);
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
