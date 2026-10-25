import { describe, expect, it } from "vitest";
import { composeRuntimeMap, type MapSource } from "../../src/services/codegen/runtime-map";
import type { PluginManifest } from "every-plugin/ui/manifest";

function source(
  key: string,
  routes: Array<Record<string, unknown>>,
  overrides?: Partial<MapSource>,
): MapSource & { manifest: PluginManifest } {
  return {
    key,
    kind: key === "ui" ? "core" : "plugin-ui",
    source: "local",
    location: key,
    manifest: { manifestVersion: 2, routes } as PluginManifest,
    ...overrides,
  };
}

describe("composeRuntimeMap — the static model of constructTree (#594)", () => {
  it("composes mount-level and nested plugin routes with full paths", () => {
    const map = composeRuntimeMap([
      source("ui", [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/index", type: "route", path: "/", parent: "_public" },
      ]),
      source("votes", [
        { id: "_authenticated", type: "layout", mount: "authenticated" },
        { id: "_authenticated/vote-feed", type: "route", path: "/votes", parentId: "_authenticated" },
      ]),
    ]);
    expect(map.mounts).toEqual([
      { id: "public", declaredBy: "ui", recordId: "_public" },
      { id: "authenticated", declaredBy: "votes", recordId: "_authenticated" },
    ]);
    const votes = map.routes.find((route) => route.owner === "votes");
    expect(votes?.fullPath).toBe("/votes");
  });

  it("core ui shadows a plugin's mount and route claims — reported, not composed", () => {
    const map = composeRuntimeMap([
      source("ui", [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/login", type: "route", path: "/login" },
      ]),
      source("auth", [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/login", type: "route", path: "/login" },
      ]),
    ]);
    expect(map.shadowed).toHaveLength(2);
    expect(map.shadowed.map((entry) => entry.owner)).toEqual(["auth", "auth"]);
    // only the core's routes compose
    expect(map.routes.every((route) => route.core)).toBe(true);
  });

  it("a peer path collision throws", () => {
    expect(() =>
      composeRuntimeMap([
        source("ui", [{ id: "_public", type: "layout", mount: "public" }]),
        source("votes", [{ id: "_public/x", type: "route", path: "/x" }]),
        source("proposals", [{ id: "_public/x", type: "route", path: "/x" }]),
      ]),
    ).toThrow(/path collision/);
  });

  it("a route outside any mount throws", () => {
    expect(() => composeRuntimeMap([source("votes", [{ id: "orphan", type: "route", path: "/x" }])])).toThrow(
      /must live under a mount/,
    );
  });
});
