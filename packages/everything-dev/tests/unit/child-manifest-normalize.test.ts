import { describe, expect, it } from "vitest";
import { normalizeChildManifest } from "../../src/services/scaffold/sync";

const catalog = {
  "everything-dev": "2.0.0-rc.15",
  "every-plugin": "3.0.0-rc.10",
  "@electric-sql/pglite": "0.10.0",
};

describe("normalizeChildManifest (#521)", () => {
  it("rewrites the parent's workspace:^ specifiers to catalog: for cataloged packages", () => {
    const pkg = {
      dependencies: {
        "everything-dev": "workspace:^",
        "every-plugin": "workspace:^2.0.0",
      },
    };
    expect(normalizeChildManifest(pkg, catalog)).toBe(true);
    expect(pkg.dependencies).toEqual({ "everything-dev": "catalog:", "every-plugin": "catalog:" });
  });

  it("leaves a workspace: specifier without a catalog entry alone (no version to pin)", () => {
    const pkg = { dependencies: { "some-new-package": "workspace:^" } };
    expect(normalizeChildManifest(pkg, catalog)).toBe(false);
    expect(pkg.dependencies).toEqual({ "some-new-package": "workspace:^" });
  });

  it("dedupes cross-field declarations — dependencies wins over devDependencies", () => {
    const pkg = {
      dependencies: { "@electric-sql/pglite": "catalog:" },
      devDependencies: { "@electric-sql/pglite": "0.9.0", vitest: "3.0.0" },
    };
    expect(normalizeChildManifest(pkg, catalog)).toBe(true);
    expect(pkg.devDependencies).toEqual({ vitest: "3.0.0" });
    expect(pkg.dependencies).toEqual({ "@electric-sql/pglite": "catalog:" });
  });

  it("reports no modification for an already-child-shaped manifest", () => {
    const pkg = {
      dependencies: { "everything-dev": "catalog:", react: "^19.0.0" },
      devDependencies: { vitest: "3.0.0" },
    };
    expect(normalizeChildManifest(pkg, catalog)).toBe(false);
  });
});
