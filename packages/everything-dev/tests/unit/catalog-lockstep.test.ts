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
    expect(V2_CATALOG).toEqual(workspace.catalog ?? {});
  });
});
