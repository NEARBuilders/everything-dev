import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  removeInitLockfile,
  scaffoldMinimalProject,
  stripOrphanedWorkspacesFromLockfile,
} from "../../src/cli/init";

describe("scaffoldMinimalProject — catalog population", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-catalog-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("populates workspaces.catalog with framework versions", async () => {
    const parentConfig = {
      extends: "bos://dev.everything.near/everything.dev",
      app: {
        ui: { name: "ui", development: "http://localhost:3003" },
        api: { name: "api", development: "http://localhost:3001" },
      },
    };

    await scaffoldMinimalProject(testDir, parentConfig, {
      extendsAccount: "dev.everything.near",
      extendsGateway: "everything.dev",
      account: "test.near",
      domain: "test.dev",
      overrides: ["ui", "api"],
    });

    const pkgPath = join(testDir, "package.json");
    expect(existsSync(pkgPath)).toBe(true);

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      workspaces?: { packages?: string[]; catalog?: Record<string, string> };
    };
    expect(pkg.dependencies?.["everything-dev"]).toBe("catalog:");
    expect(pkg.dependencies?.["every-plugin"]).toBe("catalog:");
    expect(pkg.workspaces?.catalog).toBeDefined();
    expect(Object.keys(pkg.workspaces?.catalog ?? {}).length).toBeGreaterThan(0);

    expect(pkg.workspaces?.catalog?.["everything-dev"]).toBeDefined();
    expect(pkg.workspaces?.catalog?.["every-plugin"]).toBeDefined();
    expect(pkg.workspaces?.catalog?.["everything-dev"]).toMatch(/^\^\d+\.\d+\.\d+/);
    expect(pkg.workspaces?.catalog?.["every-plugin"]).toMatch(/^\^?\d+/);
  });
});

describe("removeInitLockfile", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-lockfile-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("deletes copied bun.lock so init cannot reuse stale framework resolutions", () => {
    const lockfilePath = join(testDir, "bun.lock");
    writeFileSync(lockfilePath, JSON.stringify({ lockfileVersion: 1 }, null, 2));

    removeInitLockfile(lockfilePath);

    expect(existsSync(lockfilePath)).toBe(false);
  });

  it("no-ops when bun.lock does not exist", () => {
    const lockfilePath = join(testDir, "missing.lock");

    expect(() => removeInitLockfile(lockfilePath)).not.toThrow();
  });
});

describe("stripOrphanedWorkspacesFromLockfile", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-lockfile-strip-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("strips orphaned workspaces from bun.lock keeping only allowed ones", () => {
    const lockfile = {
      lockfileVersion: 1,
      workspaces: {
        "": { name: "monorepo", dependencies: {} },
        ui: { name: "ui", dependencies: {} },
        api: { name: "api", dependencies: {} },
        host: { name: "host", dependencies: {} },
        "packages/everything-dev": { name: "everything-dev", dependencies: {} },
        "packages/every-plugin": { name: "every-plugin", dependencies: {} },
        "plugins/apps": { name: "apps", dependencies: {} },
      },
      packages: {},
    };

    const lockfilePath = join(testDir, "bun.lock");
    writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));

    stripOrphanedWorkspacesFromLockfile(lockfilePath, ["ui", "api"]);

    const stripped = JSON.parse(readFileSync(lockfilePath, "utf-8")) as {
      workspaces: Record<string, unknown>;
    };

    const workspaceKeys = Object.keys(stripped.workspaces);
    expect(workspaceKeys).toContain("");
    expect(workspaceKeys).toContain("ui");
    expect(workspaceKeys).toContain("api");
    expect(workspaceKeys).not.toContain("host");
    expect(workspaceKeys).not.toContain("packages/everything-dev");
    expect(workspaceKeys).not.toContain("packages/every-plugin");
    expect(workspaceKeys).not.toContain("plugins/apps");
  });

  it("preserves lockfile when all workspaces are allowed", () => {
    const lockfile = {
      lockfileVersion: 1,
      workspaces: {
        "": { name: "monorepo" },
        ui: { name: "ui" },
        api: { name: "api" },
      },
      packages: {},
    };

    const lockfilePath = join(testDir, "bun-lock-all.lock");
    writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));

    stripOrphanedWorkspacesFromLockfile(lockfilePath, ["ui", "api"]);

    const result = JSON.parse(readFileSync(lockfilePath, "utf-8")) as {
      workspaces: Record<string, unknown>;
    };

    expect(Object.keys(result.workspaces)).toEqual(["", "ui", "api"]);
  });

  it("no-ops when lockfile does not exist", () => {
    const nonexistent = join(testDir, "nonexistent.lock");
    expect(() => stripOrphanedWorkspacesFromLockfile(nonexistent, ["ui", "api"])).not.toThrow();
  });

  it("no-ops when lockfile is not valid JSON", () => {
    const lockfilePath = join(testDir, "bun-invalid.lock");
    writeFileSync(lockfilePath, "this is not json {{{");

    expect(() => stripOrphanedWorkspacesFromLockfile(lockfilePath, ["ui", "api"])).not.toThrow();
  });

  it("no-ops when lockfile has no workspaces key", () => {
    const lockfilePath = join(testDir, "bun-no-ws.lock");
    writeFileSync(lockfilePath, JSON.stringify({ lockfileVersion: 1 }));

    expect(() => stripOrphanedWorkspacesFromLockfile(lockfilePath, ["ui", "api"])).not.toThrow();

    const result = JSON.parse(readFileSync(lockfilePath, "utf-8"));
    expect(result.workspaces).toBeUndefined();
  });
});
