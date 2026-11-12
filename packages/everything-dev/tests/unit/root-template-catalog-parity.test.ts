import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The drift alarm (#545 class): the child root package.json is written from
 * this repo's root template bytes, and `packageObjectNeedsCatalogRefs` flags
 * any literal version for an inherited-catalog package as pending drift.
 * Template bytes and alarm must agree — every dependency-field entry naming
 * a catalog-managed package uses the `catalog:` protocol, or it is not in
 * the catalog at all.
 */
describe("root template ↔ catalog-ref alarm parity", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as Record<
    string,
    Record<string, string>
  >;
  const catalog = parseCatalog(readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8"));

  it("never pins a literal for a catalog-managed package", () => {
    const offenders: string[] = [];
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      for (const [name, ref] of Object.entries(pkg[field] ?? {})) {
        if (name in catalog && ref !== "catalog:" && !ref.startsWith("workspace:")) {
          offenders.push(`${field}.${name}: ${ref}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the catalog spec in sync with a literal peer floor", () => {
    // when a package is deliberately literal (e.g. a peer floor), the catalog
    // must carry the same range so both resolve identically
    for (const [name, ref] of Object.entries(pkg.peerDependencies ?? {})) {
      if (ref === "catalog:" || ref.startsWith("workspace:")) continue;
      if (name in catalog) expect(ref).toBe(catalog[name]);
    }
  });
});

function parseCatalog(yaml: string): Record<string, string> {
  const entries: Record<string, string> = {};
  let inCatalog = false;
  for (const line of yaml.split("\n")) {
    if (line.startsWith("catalog:")) {
      inCatalog = true;
      continue;
    }
    if (inCatalog) {
      if (/^\s/.test(line)) {
        const match = /^\s+([\w@/.-]+):\s*(\S+)/.exec(line);
        if (match) entries[match[1]!] = match[2]!;
      } else {
        inCatalog = false;
      }
    }
  }
  return entries;
}
