import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  readInstalledFrameworkVersion,
  readRootCatalogVersion,
} from "../../src/services/framework-version";

/**
 * The release-composition audit's "what does this runtime compose" probe
 * (`readRootCatalogVersion` via `readInstalledFrameworkVersion`). The
 * regression it pins: children keep the catalog in pnpm-workspace.yaml and
 * (pre-hoisted-linker trees) have no root `node_modules/<pkg>` to fall back
 * to — the probe used to read only the legacy package.json catalog location
 * and reported every shared singleton as `@unknown`, turning a coherent
 * pinned plane into a wall of false divergence lines (opencrosspost, rc.30).
 */

const tempDirs: string[] = [];
const tempRoot = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "framework-version-"));
  tempDirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(dir, path);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }
  return dir;
};

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("readRootCatalogVersion — the catalog probe", () => {
  it("reads the pnpm-workspace.yaml catalog (the v2 location every child uses)", () => {
    const dir = tempRoot({
      "pnpm-workspace.yaml": "packages:\n  - ui\ncatalog:\n  react: 19.3.1\n",
    });
    expect(readRootCatalogVersion(dir, "react")).toBe("19.3.1");
  });

  it("strips range prefixes from catalog specifiers", () => {
    const dir = tempRoot({
      "pnpm-workspace.yaml": 'catalog:\n  "@electric-sql/pglite": ^0.4.5\n',
    });
    expect(readRootCatalogVersion(dir, "@electric-sql/pglite")).toBe("0.4.5");
  });

  it("falls back to the legacy package.json workspaces.catalog", () => {
    const dir = tempRoot({
      "package.json": JSON.stringify({
        workspaces: { packages: ["ui"], catalog: { react: "^19.2.0" } },
      }),
    });
    expect(readRootCatalogVersion(dir, "react")).toBe("19.2.0");
  });

  it("returns undefined for a name the catalog does not carry", () => {
    const dir = tempRoot({ "pnpm-workspace.yaml": "catalog:\n  react: 19.3.1\n" });
    expect(readRootCatalogVersion(dir, "preact")).toBeUndefined();
  });
});

describe("readInstalledFrameworkVersion — node_modules fallback", () => {
  it("resolves from the root node_modules when the catalog misses the name", () => {
    const dir = tempRoot({
      "package.json": "{}\n",
      "pnpm-workspace.yaml": "catalog:\n  react: 19.3.1\n",
      "node_modules/solo-pkg/package.json": JSON.stringify({ name: "solo-pkg", version: "1.2.3" }),
    });
    expect(readInstalledFrameworkVersion(dir, "solo-pkg")).toBe("1.2.3");
  });

  it("prefers the catalog over node_modules", () => {
    const dir = tempRoot({
      "package.json": "{}\n",
      "pnpm-workspace.yaml": "catalog:\n  react: 19.3.1\n",
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "18.0.0" }),
    });
    expect(readInstalledFrameworkVersion(dir, "react")).toBe("19.3.1");
  });
});
