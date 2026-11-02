import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { V2_CATALOG } from "../../src/services/scaffold/upgrade-audit/steps/migrate-pnpm";

// Drift guard: the v1→v2 migration's catalog baseline is compiled into the
// released everything-dev and overwrites the child's rows on migration — if
// it falls behind the parent's own catalog, the migration regresses a child
// to old pins (#650's "writes outdated catalog"). V2_CATALOG must be a
// verbatim copy of the parent pnpm-workspace.yaml catalog, both directions.
describe("V2_CATALOG", () => {
  it("matches the parent workspace catalog row-for-row", () => {
    const workspace = parse(
      readFileSync(join(import.meta.dirname, "../../../../pnpm-workspace.yaml"), "utf8"),
    ) as { catalog?: Record<string, string> };
    const catalog = workspace.catalog ?? {};
    const missingOrStale = Object.entries(catalog)
      .filter(([key, version]) => V2_CATALOG[key] !== version)
      .map(([key, version]) => `  "${key}": "${version}",`)
      .join("\n");
    const extra = Object.keys(V2_CATALOG)
      .filter((key) => !(key in catalog))
      .map((key) => `  ${key}`)
      .join("\n");
    const hint = [
      "V2_CATALOG drifted from the parent pnpm-workspace.yaml catalog.",
      "Update the mirror in src/services/scaffold/upgrade-audit/steps/migrate-pnpm.ts:",
      missingOrStale && `set to parent rows:\n${missingOrStale}`,
      extra && `removed from parent, delete:\n${extra}`,
    ]
      .filter(Boolean)
      .join("\n");
    expect(V2_CATALOG, hint).toEqual(catalog);
  });
});
