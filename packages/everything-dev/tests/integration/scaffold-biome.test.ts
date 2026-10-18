import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { buildInitPatterns, copyFilteredFiles } from "../../src/cli/init";
import { loadParentConfigFixture } from "../helpers/parent-config";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

const ROOT_CONFIG = (await loadParentConfigFixture()) as {
  plugins?: Record<string, unknown>;
};

function localPluginKeys(): string[] {
  return Object.keys(ROOT_CONFIG.plugins ?? {});
}

/**
 * The scaffold biome-clean by construction: a freshly scaffolded child tree
 * passes `biome check .` with the sync-owned `biome.json` — the same check the
 * child's CI runs. Sync-owned files receive fixes at the source (the framework
 * home), so consumers never inherit lint noise a `bos sync` would re-introduce.
 */
describe("scaffolded project biome-clean", () => {
  const biomeBin = join(REPO_ROOT, "node_modules", ".bin", "biome");

  it.skipIf(!existsSync(biomeBin))(
    "passes biome check with the scaffolded biome.json",
    { timeout: 120_000 },
    async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "bos-scaffold-biome-"));
      try {
        const overrides = ["ui", "api", "plugins"] as const;
        const plugins = localPluginKeys();
        const patterns = buildInitPatterns([...overrides], plugins);
        const copied = await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
          overrides: [...overrides],
          plugins,
        });
        expect(copied, "scaffold copied too few files — patterns stopped matching").toBeGreaterThan(
          100,
        );
        expect(existsSync(join(projectDir, "biome.json"))).toBe(true);

        const result = await execa(biomeBin, ["check", "."], {
          cwd: projectDir,
          reject: false,
        });

        expect(result.exitCode, `biome check failed on the scaffold:\n${result.stdout}`).toBe(0);

        const checked = result.stdout.match(/Checked (\d+) files?/);
        expect(
          checked,
          `biome checked nothing — parser/config drift:\n${result.stdout}`,
        ).not.toBeNull();
        expect(Number(checked?.[1] ?? 0)).toBeGreaterThan(100);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    },
  );
});
