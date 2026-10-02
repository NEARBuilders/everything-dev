import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitPatterns, copyFilteredFiles } from "../../src/cli/init";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

async function scaffold(overrides: Array<"ui" | "api" | "host" | "plugins">): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), "bos-init-compose-"));
  const patterns = buildInitPatterns(overrides, overrides.includes("plugins") ? ["template"] : []);

  await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
    overrides,
    plugins: overrides.includes("plugins") ? ["template"] : [],
  });

  return projectDir;
}

describe("init docker-compose delivery", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("api-override children get the 2-service child compose", async () => {
    const projectDir = await scaffold(["ui", "api"]);
    tempDirs.push(projectDir);

    const compose = readFileSync(join(projectDir, "docker-compose.yml"), "utf-8");
    expect(compose).toContain("postgres-api:");
    expect(compose).toContain("postgres-api-test:");
    expect(compose).not.toContain("postgres-auth");
  });

  it("children overriding host get the compose too", async () => {
    const projectDir = await scaffold(["host"]);
    tempDirs.push(projectDir);

    expect(existsSync(join(projectDir, "docker-compose.yml"))).toBe(true);
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
