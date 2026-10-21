import { describe, expect, it } from "vitest";
import { diffCatalogEntries } from "../../src/cli/upgrade";

const chainCatalog: Record<string, string> = {
  "everything-dev": "2.0.0-rc.15",
  "every-plugin": "3.0.0-rc.10",
  effect: "4.0.0-rc.117",
  react: "19.2.0",
};

const driftAlarm = (updates: Array<{ from: string | undefined }>): boolean =>
  updates.some((u) => u.from !== undefined);

describe("diffCatalogEntries (upgrade --check drift alarm, #524)", () => {
  it("reads zero updates for a local catalog that matches the chain (v2 pnpm-workspace.yaml layout)", () => {
    const localCatalog = {
      effect: "4.0.0-rc.117",
      react: "19.2.0",
      "unused-extra-pin": "1.0.0",
    };
    const updates = diffCatalogEntries(chainCatalog, localCatalog);
    expect(updates).toEqual([]);
    expect(driftAlarm(updates)).toBe(false);
  });

  it("does not trip the alarm for purely-additive chain entries the child does not consume", () => {
    const updates = diffCatalogEntries(
      { ...chainCatalog, "unused-new-pin": "2.0.0" },
      { effect: "4.0.0-rc.117", react: "19.2.0" },
    );
    expect(updates).toEqual([{ name: "unused-new-pin", from: undefined, to: "2.0.0" }]);
    expect(driftAlarm(updates)).toBe(false);
  });

  it("counts a differing version as drift with a defined from", () => {
    const updates = diffCatalogEntries(chainCatalog, {
      effect: "4.0.0-rc.117",
      react: "19.1.0",
    });
    expect(updates).toEqual([{ name: "react", from: "19.1.0", to: "19.2.0" }]);
    expect(driftAlarm(updates)).toBe(true);
  });

  it("excludes framework packages — they ride the per-package version list", () => {
    const updates = diffCatalogEntries(chainCatalog, {});
    expect(updates.map((u) => u.name)).toEqual(["effect", "react"]);
  });
});
