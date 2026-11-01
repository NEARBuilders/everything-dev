import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PNPM_PACKAGE_MANAGER,
  reconcilePackageManagerPin,
  reconcileWorkspacePosture,
  reconcileWorkspaceYamlFile,
  type WorkspaceYamlDoc,
} from "../../src/services/workspace/catalog-overrides";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "catalog-overrides-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("reconcileWorkspacePosture", () => {
  it("rewrites catalog-pinned override literals to the current catalog rows", () => {
    const doc: WorkspaceYamlDoc = {
      catalog: { "@tanstack/react-router": "1.170.46", "@tanstack/router-core": "1.171.39" },
      overrides: { "@tanstack/react-router": "1.170.45", "@tanstack/router-core": "1.171.38" },
    };
    expect(reconcileWorkspacePosture(doc)).toBe(true);
    expect(doc.overrides).toEqual({
      "@tanstack/react-router": "1.170.46",
      "@tanstack/router-core": "1.171.39",
    });
  });

  it("regenerates framework release-age excludes from the catalog and prunes stale ones", () => {
    const doc: WorkspaceYamlDoc = {
      catalog: { "everything-dev": "^2.0.0-rc.27" },
      minimumReleaseAgeExclude: ["everything-dev@2.0.0-rc.7 || 2.0.0-rc.8", "left-pad@1.0.0"],
    };
    expect(reconcileWorkspacePosture(doc)).toBe(true);
    expect(doc.minimumReleaseAgeExclude).toEqual(["everything-dev@2.0.0-rc.27", "left-pad@1.0.0"]);
    expect(doc.minimumReleaseAgeExcludePrune).toBe(true);
  });

  it("keeps user-authored non-framework excludes and reports no change when current", () => {
    const doc: WorkspaceYamlDoc = {
      catalog: { "everything-dev": "^2.0.0-rc.27" },
      overrides: {},
      minimumReleaseAgeExclude: ["everything-dev@2.0.0-rc.27"],
      minimumReleaseAgeExcludePrune: true,
    };
    // overrides: an empty row set stays empty; nothing to reconcile
    expect(reconcileWorkspacePosture(doc)).toBe(false);
  });

  it("leaves override keys absent from the catalog untouched", () => {
    const doc: WorkspaceYamlDoc = {
      catalog: { react: "19.2.9" },
      overrides: { "some-transitive": "3.2.1" },
    };
    expect(reconcileWorkspacePosture(doc)).toBe(true);
    expect(doc.overrides).toEqual({ "some-transitive": "3.2.1", react: "19.2.9" });
  });
});

describe("reconcilePackageManagerPin", () => {
  const write = (packageManager?: string) =>
    writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "child", packageManager, scripts: {} }, null, 2),
    );

  it("bumps an older pnpm pin forward", async () => {
    await write("pnpm@12.10.1+sha512.abc");
    expect(reconcilePackageManagerPin(join(dir, "package.json"))).toBe(true);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.packageManager).toBe(PNPM_PACKAGE_MANAGER);
  });

  it("never downgrades a newer pin", async () => {
    await write("pnpm@99.0.0+sha512.abc");
    expect(reconcilePackageManagerPin(join(dir, "package.json"))).toBe(false);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.packageManager).toBe("pnpm@99.0.0+sha512.abc");
  });

  it("leaves non-pnpm managers alone (the bun cutover is migrate-pnpm's job)", async () => {
    await write("bun@1.2.3");
    expect(reconcilePackageManagerPin(join(dir, "package.json"))).toBe(false);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.packageManager).toBe("bun@1.2.3");
  });
});

describe("reconcileWorkspaceYamlFile", () => {
  it("applies the posture to a workspace yaml on disk", async () => {
    await writeFile(
      join(dir, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - ui",
        "catalog:",
        "  everything-dev: ^2.0.0-rc.27",
        "  '@tanstack/react-router': 1.170.46",
        "overrides:",
        "  '@tanstack/react-router': 1.170.32",
        "",
      ].join("\n"),
    );
    expect(reconcileWorkspaceYamlFile(dir)).toBe(true);
    const yaml = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).toContain("1.170.46");
    expect(yaml).not.toContain("1.170.32");
    expect(yaml).toContain("minimumReleaseAgeExcludePrune: true");
    expect(yaml).toContain("everything-dev@2.0.0-rc.27");
  });

  it("is a no-op without pnpm-workspace.yaml", () => {
    expect(reconcileWorkspaceYamlFile(dir)).toBe(false);
  });
});
