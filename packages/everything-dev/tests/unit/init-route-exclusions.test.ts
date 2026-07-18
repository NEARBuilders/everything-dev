import { describe, expect, it } from "vitest";
import { buildPluginRouteExclusions } from "../../src/cli/init";

describe("buildPluginRouteExclusions", () => {
  it("returns empty array when parentConfig is undefined", () => {
    expect(buildPluginRouteExclusions(undefined, [])).toEqual([]);
  });

  it("returns empty array when parentConfig is null", () => {
    expect(buildPluginRouteExclusions(null, [])).toEqual([]);
  });

  it("returns empty array when parentConfig has no plugins", () => {
    expect(buildPluginRouteExclusions({}, [])).toEqual([]);
  });

  it("returns empty array when all plugins are selected", () => {
    const parentConfig = {
      plugins: {
        apps: { routes: ["ui/src/routes/_layout/apps/**"] },
        other: { routes: ["ui/src/routes/_layout/other/**"] },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, ["apps", "other"])).toEqual([]);
  });

  it("returns routes from non-selected plugins", () => {
    const parentConfig = {
      plugins: {
        apps: { routes: ["ui/src/routes/_layout/apps/**"] },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, [])).toEqual(["ui/src/routes/_layout/apps/**"]);
  });

  it("returns routes from multiple non-selected plugins", () => {
    const parentConfig = {
      plugins: {
        apps: { routes: ["ui/src/routes/_layout/apps/**"] },
        things: { routes: ["ui/src/routes/_layout/things/**"] },
        selected: { routes: ["ui/src/routes/_layout/selected/**"] },
      },
    };
    const result = buildPluginRouteExclusions(parentConfig, ["selected"]);
    expect(result).toContain("ui/src/routes/_layout/apps/**");
    expect(result).toContain("ui/src/routes/_layout/things/**");
    expect(result).not.toContain("ui/src/routes/_layout/selected/**");
  });

  it("does not exclude a route co-claimed by a selected plugin", () => {
    const parentConfig = {
      plugins: {
        apps: { routes: ["ui/src/routes/_layout/shared/**"] },
        things: { routes: ["ui/src/routes/_layout/shared/**"] },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, ["things"])).toEqual([]);
  });

  it("handles string-form plugin entries (no routes)", () => {
    const parentConfig = {
      plugins: {
        apps: "bos://dev.everything.near/apps",
        things: { routes: ["ui/src/routes/_layout/things/**"] },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, ["things"])).toEqual([]);
  });

  it("handles object-form plugin entries without routes", () => {
    const parentConfig = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        things: { routes: ["ui/src/routes/_layout/things/**"] },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, ["things"])).toEqual([]);
  });

  it("handles plugins with no routes at all", () => {
    const parentConfig = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        things: { development: "local:plugins/things" },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, [])).toEqual([]);
  });

  it("filters non-string entries in routes array", () => {
    const parentConfig = {
      plugins: {
        apps: {
          routes: ["ui/src/routes/_layout/apps/**", 42, null, "ui/src/routes/_layout/other/**"],
        },
      },
    };
    expect(buildPluginRouteExclusions(parentConfig, [])).toEqual([
      "ui/src/routes/_layout/apps/**",
      "ui/src/routes/_layout/other/**",
    ]);
  });
});
