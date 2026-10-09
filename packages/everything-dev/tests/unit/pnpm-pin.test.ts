import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNPM_PACKAGE_MANAGER } from "../../src/cli/init";

// Drift guard: the pin `bos init` writes into generated child projects must
// track the parent workspace's own packageManager pin. These are two
// literals in different files — the root one moves on every toolchain bump
// (e.g. the pnpm 10 → 12 cut-over), so assert the agreement here.
describe("PNPM_PACKAGE_MANAGER", () => {
  it("matches the parent workspace's packageManager pin", () => {
    const root = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../../package.json"), "utf8"),
    ) as { packageManager?: string };
    const rootPin = root.packageManager?.split("+")[0];
    expect(rootPin, "root package.json must pin pnpm via packageManager").toMatch(/^pnpm@/);
    expect(PNPM_PACKAGE_MANAGER).toBe(rootPin);
  });
});
