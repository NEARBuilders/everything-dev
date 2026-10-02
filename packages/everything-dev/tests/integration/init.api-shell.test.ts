import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitPatterns, copyFilteredFiles } from "../../src/cli/init";
import { isFrameworkOwnedSyncFile } from "../../src/cli/sync";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

async function scaffoldApiProject(): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), "bos-init-api-shell-"));
  const patterns = buildInitPatterns(["ui", "api"]);

  await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
    overrides: ["ui", "api"],
  });

  return projectDir;
}

describe("init api shell", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("delivers the slim shell instead of the domain API", async () => {
    const projectDir = await scaffoldApiProject();
    tempDirs.push(projectDir);

    for (const relative of [
      "api/src/contract.ts",
      "api/src/index.ts",
      "api/src/db/schema.ts",
      "api/src/db/layer.ts",
      "api/src/db/migrate.ts",
      "api/src/db/index.ts",
      "api/src/lib/context.ts",
      "api/src/lib/errors.ts",
      "api/src/global.d.ts",
      "api/drizzle.config.ts",
      "api/package.json",
      "api/plugin.dev.ts",
      "api/tests/setup.ts",
    ]) {
      expect(existsSync(join(projectDir, relative))).toBe(true);
    }

    expect(listDir(join(projectDir, "api", "src", "services"))).toEqual([]);
    expect(listDir(join(projectDir, "api", "src", "db", "migrations"))).toEqual([]);
    expect(existsSync(join(projectDir, "api", "src", "discovery-contract.ts"))).toBe(false);
    expect(existsSync(join(projectDir, "api", "src", "feature-areas.ts"))).toBe(false);
    expect(existsSync(join(projectDir, "api", "src", "team-access-policy.ts"))).toBe(false);
    expect(existsSync(join(projectDir, "api", "tests", "unit"))).toBe(false);
    expect(existsSync(join(projectDir, "api", "tests", "integration"))).toBe(false);
  });

  it("shell contract is minimal", async () => {
    const projectDir = await scaffoldApiProject();
    tempDirs.push(projectDir);

    const contractSource = readFileSync(join(projectDir, "api", "src", "contract.ts"), "utf-8");
    expect(contractSource).toContain("ping");
    expect(contractSource).toContain("testError");
    expect(contractSource).not.toContain("listTenants");
    expect(contractSource).not.toContain("listNodes");

    const indexSource = readFileSync(join(projectDir, "api", "src", "index.ts"), "utf-8");
    expect(indexSource).not.toContain("./services/");
    expect(indexSource).not.toContain("./discovery-contract");
  });

  it("ui-only children receive no api directory", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-init-api-shell-ui-only-"));
    tempDirs.push(projectDir);
    const patterns = buildInitPatterns(["ui"]);

    await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
      overrides: ["ui"],
    });

    expect(existsSync(join(projectDir, "api"))).toBe(false);
  });

  it("shell plumbing stays framework-owned so sync can refresh it", async () => {
    const frameworkOwned = [
      "api/src/db/index.ts",
      "api/src/db/layer.ts",
      "api/src/db/migrate.ts",
      "api/src/lib/context.ts",
      "api/src/global.d.ts",
      "api/drizzle.config.ts",
    ];
    for (const relative of frameworkOwned) {
      expect(isFrameworkOwnedSyncFile(relative)).toBe(true);
    }
    for (const relative of ["api/src/contract.ts", "api/src/index.ts", "api/src/db/schema.ts"]) {
      expect(isFrameworkOwnedSyncFile(relative)).toBe(false);
    }
  });
});

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
