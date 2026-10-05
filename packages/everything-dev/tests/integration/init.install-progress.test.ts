import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  PNPM_PACKAGE_MANAGER,
  removeStrayLockfiles,
  scaffoldMinimalProject,
  writeChildWorkspaceYaml,
} from "../../src/cli/init";

vi.mock("../../src/http-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/http-client")>();
  return {
    ...actual,
    fetchResponse: async () => {
      throw new Error("network disabled in test");
    },
    fetchJsonOrNull: async () => null,
  };
});

const REPO_ROOT = join(import.meta.dirname, "../../../../");

describe("scaffoldMinimalProject — pnpm workspace synthesis", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-catalog-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes pnpm-workspace.yaml with child globs + catalog, package.json stays pnpm-native", async () => {
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
      catalogSourceDir: REPO_ROOT,
    });

    const pkgPath = join(testDir, "package.json");
    expect(existsSync(pkgPath)).toBe(true);

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      workspaces?: unknown;
      packageManager?: string;
    };
    expect(pkg.dependencies?.["everything-dev"]).toBe("catalog:");
    expect(pkg.dependencies?.["every-plugin"]).toBe("catalog:");
    expect(pkg.packageManager).toBe(PNPM_PACKAGE_MANAGER);
    expect(pkg.workspaces).toBeUndefined();

    const doc = parseYaml(readFileSync(join(testDir, "pnpm-workspace.yaml"), "utf-8")) as {
      packages?: string[];
      catalog?: Record<string, string>;
    };
    expect(doc.packages).toContain("ui");
    expect(doc.packages).toContain("api");
    const catalog = doc.catalog ?? {};
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
    expect(catalog["everything-dev"]).toMatch(/^\^\d+\.\d+\.\d+/);
    expect(catalog["every-plugin"]).toMatch(/^\^?\d+/);
  });
});

describe("removeStrayLockfiles", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-lockfile-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("deletes a copied bun.lock on sight and the child's pnpm-lock.yaml for re-resolution", () => {
    const bunLock = join(testDir, "bun.lock");
    const pnpmLock = join(testDir, "pnpm-lock.yaml");
    writeFileSync(bunLock, JSON.stringify({ lockfileVersion: 1 }, null, 2));
    writeFileSync(pnpmLock, "lockfileVersion: '9.0'\n");

    removeStrayLockfiles(testDir);

    expect(existsSync(bunLock)).toBe(false);
    expect(existsSync(pnpmLock)).toBe(false);
  });

  it("no-ops when no lockfile exists", () => {
    expect(() => removeStrayLockfiles(testDir)).not.toThrow();
  });
});

describe("writeChildWorkspaceYaml", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-init-workspace-yaml-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates the manifest when missing and merges on re-run", () => {
    expect(
      writeChildWorkspaceYaml(testDir, {
        packages: ["ui", "plugins/*"],
        catalog: { react: "^19.2.4" },
      }),
    ).toBe(true);

    expect(
      writeChildWorkspaceYaml(testDir, {
        packages: ["ui", "api"],
        catalog: { react: "^19.3.0", effect: "4.0.0-rc.117" },
      }),
    ).toBe(true);

    const doc = parseYaml(readFileSync(join(testDir, "pnpm-workspace.yaml"), "utf-8")) as {
      packages?: string[];
      catalog?: Record<string, string>;
    };
    expect(doc.packages).toEqual(["api", "plugins/*", "ui"]);
    expect(doc.catalog?.react).toBe("^19.3.0");
    expect(doc.catalog?.effect).toBe("4.0.0-rc.117");
  });

  it("no-ops when nothing changes", () => {
    expect(
      writeChildWorkspaceYaml(testDir, {
        packages: ["ui", "api"],
        catalog: { react: "^19.3.0", effect: "4.0.0-rc.117" },
      }),
    ).toBe(false);
  });
});
