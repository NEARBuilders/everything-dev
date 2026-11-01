import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitPatterns, copyFilteredFiles } from "../../src/cli/init";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

/**
 * ADR 0038: local databases are the persistent PGlite data dirs — the
 * compose-era infra delivery is retired. `bos init` must never emit a
 * docker-compose.yml for any child shape.
 */
async function scaffold(overrides: Array<"ui" | "api" | "host" | "plugins">): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), "bos-init-compose-"));
  const patterns = buildInitPatterns(overrides, overrides.includes("plugins") ? ["template"] : []);

  await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
    overrides,
    plugins: overrides.includes("plugins") ? ["template"] : [],
  });

  return projectDir;
}

describe("init never delivers docker-compose (ADR 0038)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("api-override children get no compose", async () => {
    const projectDir = await scaffold(["ui", "api"]);
    tempDirs.push(projectDir);

    expect(existsSync(join(projectDir, "docker-compose.yml"))).toBe(false);
  });

  it("children overriding host get no compose either", async () => {
    const projectDir = await scaffold(["host"]);
    tempDirs.push(projectDir);

    expect(existsSync(join(projectDir, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(projectDir, ".github", "docker-compose.yml"))).toBe(false);
  });

  it("children without local compute get no compose", async () => {
    const uiOnly = await scaffold(["ui"]);
    tempDirs.push(uiOnly);
    expect(existsSync(join(uiOnly, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(uiOnly, ".github", "docker-compose.yml"))).toBe(false);

    const pluginsOnly = await scaffold(["plugins"]);
    tempDirs.push(pluginsOnly);
    expect(existsSync(join(pluginsOnly, "docker-compose.yml"))).toBe(false);
  });
});
