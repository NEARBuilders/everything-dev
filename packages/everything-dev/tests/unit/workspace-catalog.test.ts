import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogFromPackageJson,
  readWorkspaceCatalog,
  writeWorkspaceCatalog,
} from "../../src/workspace-catalog";

const tmpRoot = join(import.meta.dirname, ".workspace-catalog-fixture");

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("readWorkspaceCatalog", () => {
  it("reads the catalog from pnpm-workspace.yaml", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(
      join(tmpRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - api",
        "  - packages/*",
        "",
        "catalog:",
        '  react: "19.2.4"',
        '  zod: "^4.6.5"',
        "",
      ].join("\n"),
    );
    expect(readWorkspaceCatalog(tmpRoot)).toEqual({ react: "19.2.4", zod: "^4.6.5" });
  });

  it("returns an empty catalog when the file has none", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n  - api\n");
    expect(readWorkspaceCatalog(tmpRoot)).toEqual({});
  });

  it("falls back to package.json workspaces.catalog (pre-v2 runtimes)", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(
      join(tmpRoot, "package.json"),
      JSON.stringify({
        name: "legacy",
        workspaces: { packages: ["ui"], catalog: { react: "18.0.0" } },
      }),
    );
    expect(readWorkspaceCatalog(tmpRoot)).toEqual({ react: "18.0.0" });
  });

  it("returns empty when neither source exists", () => {
    mkdirSync(tmpRoot, { recursive: true });
    expect(readWorkspaceCatalog(tmpRoot)).toEqual({});
  });
});

describe("writeWorkspaceCatalog", () => {
  it("round-trips the packages block and replaces the catalog", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(
      join(tmpRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - api",
        "  - packages/*",
        "",
        "catalog:",
        '  react: "19.2.4"',
        "",
        "linkWorkspacePackages: true",
        "",
      ].join("\n"),
    );

    writeWorkspaceCatalog(tmpRoot, { react: "19.3.0", zod: "^4.6.5" });

    const text = readText();
    expect(text).toContain("packages:");
    expect(text).toContain("  - packages/*");
    expect(text).toContain("linkWorkspacePackages: true");
    expect(readWorkspaceCatalog(tmpRoot)).toEqual({ react: "19.3.0", zod: "^4.6.5" });
  });

  it("writes package.json workspaces.catalog when no pnpm-workspace.yaml exists (v1 runtimes)", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "legacy" }));
    writeWorkspaceCatalog(tmpRoot, { react: "18.0.0" });
    const pkg = JSON.parse(readTextLegacy());
    expect(pkg.workspaces.catalog).toEqual({ react: "18.0.0" });
  });

  it("creates pnpm-workspace.yaml when neither source exists", () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeWorkspaceCatalog(tmpRoot, { react: "19.2.4" });
    expect(readWorkspaceCatalog(tmpRoot)).toEqual({ react: "19.2.4" });
  });
});

function readText(): string {
  return require("node:fs").readFileSync(join(tmpRoot, "pnpm-workspace.yaml"), "utf8");
}

function readTextLegacy(): string {
  return require("node:fs").readFileSync(join(tmpRoot, "package.json"), "utf8");
}

describe("catalogFromPackageJson", () => {
  it("extracts a legacy workspaces.catalog", () => {
    expect(
      catalogFromPackageJson({ workspaces: { packages: ["ui"], catalog: { react: "18" } } }),
    ).toEqual({ react: "18" });
    expect(catalogFromPackageJson({})).toEqual({});
  });
});
