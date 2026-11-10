import { Effect, Layer } from "effect";
import type { RuntimeConfig } from "everything-dev/types";
import { describe, expect, it } from "vitest";
import { ConfigService } from "../../src/services/config";
import { failedPluginsClientEntry, initializePlugins } from "../../src/services/plugins";

function baseConfig(plugins: RuntimeConfig["plugins"] = {}): RuntimeConfig {
  return {
    env: "production",
    account: "test.near",
    networkId: "testnet",
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "/mf-manifest.json",
      source: "local",
    },
    ui: { name: "ui", url: "http://localhost:3003", entry: "/mf-manifest.json", source: "local" },
    api: {
      name: "api",
      url: "https://api.example.com",
      entry: "https://api.example.com/mf-manifest.json",
      source: "remote",
    },
    plugins,
  } as RuntimeConfig;
}

function runInitialize(config: RuntimeConfig) {
  return Effect.runPromise(
    Effect.scoped(Effect.provide(initializePlugins(), Layer.succeed(ConfigService, config))),
  );
}

describe("plugin failure containment (#848)", () => {
  it("a dependency cycle fails the whole init but the host shape survives", async () => {
    const result = await runInitialize(
      baseConfig({
        a: {
          name: "a",
          url: "https://a.example.com",
          entry: "https://a.example.com/mf-manifest.json",
          source: "remote",
          dependsOn: ["b"],
        },
        b: {
          name: "b",
          url: "https://b.example.com",
          entry: "https://b.example.com/mf-manifest.json",
          source: "remote",
          dependsOn: ["a"],
        },
      }),
    );

    expect(result.status.available).toBe(false);
    expect(result.auth).toBeNull();
    expect(result.api).toBeNull();
    expect(result.plugins).toEqual({});
    expect(result.status.error).toContain("Circular dependency detected among");
    // a whole-init failure is NOT a per-plugin failure — nothing to attribute
    expect(result.status.failures).toEqual([]);
  });

  it("an idle config serves without plugins and records no failure", async () => {
    const config = baseConfig();
    config.api = { ...config.api, url: "" };
    const result = await runInitialize(config);

    expect(result.status.available).toBe(false);
    expect(result.status.error).toBeNull();
    expect(result.status.failures).toEqual([]);
  });

  it("proxy mode short-circuits initialization without touching the runtime", async () => {
    const config = baseConfig();
    config.api = { ...config.api, proxy: "https://upstream.example.com" };
    const result = await runInitialize(config);

    expect(result.status.available).toBe(false);
    expect(result.status.error).toBeNull();
    expect(result.runtime).toBeNull();
  });
});

describe("failedPluginsClientEntry — the dependent-cascade contract (#848)", () => {
  it("throws on client construction and on any router property access", () => {
    const entry = failedPluginsClientEntry("Plugin feedback failed: unreachable");
    expect(() => entry.client()).toThrow("Plugin feedback failed: unreachable");
    expect(() => (entry.router as Record<string, unknown>).anything).toThrow(
      "Plugin feedback failed: unreachable",
    );
  });
});
