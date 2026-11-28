import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const LEGACY_NAME = "plugin.dev.ts";
const CANONICAL_NAME = "bos.dev.ts";

function unitDirs(projectDir: string): string[] {
  const dirs = ["api"];
  const pluginsDir = join(projectDir, "plugins");
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir)) {
      const full = join(pluginsDir, entry);
      if (statSync(full).isDirectory()) dirs.push(join("plugins", entry));
    }
  }
  return dirs;
}

/**
 * The upgrade migration leg retiring the `plugin.dev.ts` dev-overlay name:
 * each unit's legacy overlay renames to `bos.dev.ts` (the root form's name),
 * with the original preserved under `.bos/sync-backup/`. When both forms
 * exist the canonical file wins and the legacy file is only backed up.
 * Idempotent — a second run finds nothing. Returns the renamed relative
 * paths (empty when there was nothing to do).
 */
export async function renameLegacyPluginDevOverlays(projectDir: string): Promise<string[]> {
  const renamed: string[] = [];

  for (const rel of unitDirs(projectDir)) {
    const legacyPath = join(projectDir, rel, LEGACY_NAME);
    if (!existsSync(legacyPath)) continue;

    const backupDir = join(projectDir, ".bos", "sync-backup", rel);
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(legacyPath, join(backupDir, LEGACY_NAME));

    const canonicalPath = join(projectDir, rel, CANONICAL_NAME);
    if (existsSync(canonicalPath)) {
      rmSync(legacyPath, { force: true });
    } else {
      renameSync(legacyPath, canonicalPath);
    }
    renamed.push(join(rel, LEGACY_NAME));
  }

  return renamed;
}
