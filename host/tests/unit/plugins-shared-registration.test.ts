import { mergeSharedMaps, SharedDependencyResolutionError } from "every-plugin/shared-deps-spec";
import { describe, expect, it } from "vitest";
import { buildSharedRegistrationEntries } from "../../src/services/plugins";

describe("host shared registration entries", () => {
  it("derives normalized registration entries from config-declared shared deps", () => {
    const entries = buildSharedRegistrationEntries(
      mergeSharedMaps(
        { "every-plugin": { version: "2.10.1", singleton: true } },
        { react: { version: "19.2.4", singleton: true, eager: true, shareScope: "default" } },
      ),
    );
    expect(entries["every-plugin"]).toEqual({
      version: "2.10.1",
      shareScope: "default",
      shareConfig: {
        singleton: true,
        requiredVersion: false,
        strictVersion: false,
        eager: false,
      },
    });
    expect(entries.react?.shareConfig.eager).toBe(true);
  });

  it("returns no entries for empty config", () => {
    expect(buildSharedRegistrationEntries(undefined)).toEqual({});
    expect(buildSharedRegistrationEntries({})).toEqual({});
  });

  it("fails loudly on unresolved versions — no wildcard, no latest", () => {
    for (const version of ["*", "latest", ""]) {
      expect(() => buildSharedRegistrationEntries(mergeSharedMaps({ react: { version } }))).toThrow(
        SharedDependencyResolutionError,
      );
    }
  });

  it("merges across api/auth/plugins with conflict detection", () => {
    const shared = mergeSharedMaps(
      { react: { version: "19.2.4", singleton: true } },
      { react: { version: "19.2.4", singleton: true } },
      { zod: { version: "4.2.1", singleton: true } },
    );
    expect(Object.keys(shared).sort()).toEqual(["react", "zod"]);

    expect(() =>
      mergeSharedMaps(
        { react: { version: "19.2.4", singleton: true } },
        { react: { version: "19.3.0", singleton: true } },
      ),
    ).toThrow(/Conflicting shared dependency "react"/);
  });
});
