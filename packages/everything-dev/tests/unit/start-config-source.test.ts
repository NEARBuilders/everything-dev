import { describe, expect, it } from "vitest";
import { isRegistryStart, resolveStartConfigSource } from "../../src/start-config-source";

describe("resolveStartConfigSource", () => {
  it("an explicit config outranks the registry identity", () => {
    const source = resolveStartConfigSource(
      { configPath: "/tmp/resolved.json", account: "acc.near", domain: "gw.app" },
      { BOS_ACCOUNT: "env.near", BOS_GATEWAY: "env.app" },
    );
    expect(source).toEqual({ configPath: "/tmp/resolved.json" });
  });

  it("falls back to the registry identity from input or env", () => {
    expect(resolveStartConfigSource({}, { BOS_ACCOUNT: "a.near", BOS_GATEWAY: "b.app" })).toEqual({
      registry: { account: "a.near", domain: "b.app" },
    });
    expect(resolveStartConfigSource({ account: "a.near", domain: "b.app" }, {})).toEqual({
      registry: { account: "a.near", domain: "b.app" },
    });
  });

  it("yields a local discovery source when nothing is set", () => {
    expect(resolveStartConfigSource({}, {})).toEqual({});
  });
});

describe("isRegistryStart (localhost-origin purge gate)", () => {
  it("a registry-fetched start purges stray localhost origins", () => {
    expect(isRegistryStart({ registry: { account: "a.near", domain: "b.app" } })).toBe(true);
  });

  it("an explicit config-path start keeps its injected origins", () => {
    expect(isRegistryStart({ configPath: "/app/.bos/regression/image/config-ssr.json" })).toBe(
      false,
    );
  });

  it("a bare local start keeps its injected origins", () => {
    expect(isRegistryStart({})).toBe(false);
  });
});
