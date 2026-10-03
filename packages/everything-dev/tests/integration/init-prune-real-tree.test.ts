import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitPatterns, copyFilteredFiles } from "../../src/cli/init";
import { pruneUnusedUiFiles } from "../../src/cli/prune";

const REPO_ROOT = join(import.meta.dirname, "../../../../");

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true });
  } catch {
    return [];
  }
}

describe("pruneUnusedUiFiles — real parent tree survival", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("keeps the route tree, UI kit, and framework files a child needs — idempotently", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "bos-prune-real-tree-"));
    tempDirs.push(projectDir);
    const patterns = buildInitPatterns(["ui"]);

    await copyFilteredFiles(REPO_ROOT, projectDir, patterns, {
      overrides: ["ui"],
    });

    await pruneUnusedUiFiles(projectDir);
    const afterFirstRun = listFiles(join(projectDir, "ui", "src"));

    const routes = join(projectDir, "ui", "src", "routes");
    expect(existsSync(join(routes, "__root.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_public.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_public", "index.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_authenticated.tsx"))).toBe(true);
    expect(existsSync(join(routes, "_admin.tsx"))).toBe(true);
    expect(existsSync(join(projectDir, "ui", "src", "lib", "api.ts"))).toBe(true);
    expect(existsSync(join(projectDir, "ui", "src", "app.ts"))).toBe(true);
    expect(existsSync(join(projectDir, "ui", "src", "router.tsx"))).toBe(true);
    expect(
      listFiles(join(projectDir, "ui", "src", "components", "ui")).length,
    ).toBeGreaterThanOrEqual(25);

    const barrel = readFileSync(join(projectDir, "ui", "src", "components", "index.ts"), "utf-8");
    expect(barrel).toContain('from "./ui/button"');

    await pruneUnusedUiFiles(projectDir);
    const afterSecondRun = listFiles(join(projectDir, "ui", "src"));
    expect(afterSecondRun).toEqual(afterFirstRun);
  });
});
