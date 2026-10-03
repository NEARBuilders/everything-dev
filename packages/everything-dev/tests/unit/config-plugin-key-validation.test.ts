import { describe, expect, it } from "vitest";
import { BosConfigSchema, RuntimeConfigSchema } from "../../src/types";

const validKey = "my-plugin.v2";

describe("plugin key validation (SEC-01/07 chokepoint)", () => {
  it("accepts well-formed keys in bos.config plugins", () => {
    const parsed = BosConfigSchema.parse({
      account: "test.near",
      app: {
        host: { development: "./host", production: "host.near" },
        ui: { development: "./ui", production: "ui.near" },
        api: { development: "./api", production: "api.near" },
      },
      plugins: { [validKey]: "local:plugins/x" },
    });
    expect(parsed.plugins?.[validKey]).toBeDefined();
  });

  it("rejects shell-metacharacter keys at the config boundary", () => {
    for (const bad of ["a;b", "a b", 'a"b', "a/b/c", "a$b", "`x`"]) {
      expect(() =>
        BosConfigSchema.parse({
          account: "test.near",
          app: {
            host: { development: "./host", production: "host.near" },
            ui: { development: "./ui", production: "ui.near" },
            api: { development: "./api", production: "api.near" },
          },
          plugins: { [bad]: "local:plugins/x" },
        }),
      ).toThrow();
    }
  });

  it("rejects hostile keys in the runtime config plugins record", () => {
    expect(() =>
      RuntimeConfigSchema.parse({
        env: "development",
        account: "test.near",
        networkId: "mainnet",
        host: {
          name: "host",
          source: "remote",
          url: "https://x",
          entry: "https://x/mf-manifest.json",
        },
        ui: { name: "ui", source: "remote", url: "https://x", entry: "https://x/mf-manifest.json" },
        api: {
          name: "api",
          source: "remote",
          url: "https://x",
          entry: "https://x/mf-manifest.json",
        },
        plugins: {
          "bad\nkey": {
            name: "bad",
            source: "remote",
            url: "https://x",
            entry: "https://x/mf-manifest.json",
          },
        },
      }),
    ).toThrow();
  });

  it("accepts keys with dots, dashes, digits and underscores", () => {
    expect(() =>
      RuntimeConfigSchema.parse({
        env: "development",
        account: "test.near",
        networkId: "mainnet",
        host: {
          name: "host",
          source: "remote",
          url: "https://x",
          entry: "https://x/mf-manifest.json",
        },
        ui: { name: "ui", source: "remote", url: "https://x", entry: "https://x/mf-manifest.json" },
        api: {
          name: "api",
          source: "remote",
          url: "https://x",
          entry: "https://x/mf-manifest.json",
        },
        plugins: {
          "my-plugin.v2_x": {
            name: "my-plugin",
            source: "remote",
            url: "https://x",
            entry: "https://x/mf-manifest.json",
          },
        },
      }),
    ).not.toThrow();
  });
});
