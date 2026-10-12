import { describe, expect, it } from "vitest";
import { mergeBosConfigWithExtends } from "../../src/merge";
import type { ExtendsConfig } from "../../src/types";

describe("env-specific extends in merge scenario", () => {
  const PARENT_CONFIG = {
    account: "parent.near",
    domain: "parent.dev",
    app: {
      host: { development: "http://localhost:3000", production: "https://host.parent.dev" },
      ui: { name: "ui", development: "http://localhost:3003", production: "https://ui.parent.dev" },
      api: {
        name: "api",
        development: "http://localhost:3001",
        production: "https://api.parent.dev",
      },
    },
    plugins: {
      apps: {
        development: "local:plugins/apps",
        production: "https://cdn.parent.dev/apps",
      },
    },
    shared: {
      ui: {
        effect: { version: "3.20.0", singleton: true },
      },
    },
  };

  it("child with env-specific extends can override parent plugin selection while inheriting shared config", () => {
    const child = {
      account: "child.near",
      domain: "child.dev",
      extends: {
        development: "bos://dev.near/dev",
        production: "bos://dev.near/prod",
      } satisfies ExtendsConfig,
      plugins: {
        myplugin: { development: "local:plugins/myplugin" },
      },
      shared: {
        ui: {
          effect: { version: "3.21.0" },
        },
      },
    };

    const merged = mergeBosConfigWithExtends(PARENT_CONFIG as any, child as any);

    expect(merged.account).toBe("child.near");
    expect(merged.domain).toBe("child.dev");
    expect(merged.extends).toEqual({
      development: "bos://dev.near/dev",
      production: "bos://dev.near/prod",
    });

    const plugins = merged.plugins as Record<string, unknown>;
    expect(plugins.apps).toBeUndefined();
    expect(plugins.myplugin).toBeDefined();

    const ui = (merged.shared as Record<string, unknown>).ui as Record<
      string,
      Record<string, unknown>
    >;
    expect(ui.effect.version).toBe("3.21.0");
    expect(ui.effect.singleton).toBe(true);
  });

  it("extends field with staging env is preserved in canonical ordering", () => {
    const child = {
      extends: {
        development: "bos://dev.near/dev",
        production: "bos://dev.near/prod",
        staging: "bos://dev.near/stage",
      } satisfies ExtendsConfig,
      account: "child.near",
      domain: "child.dev",
      shared: {},
    };

    const merged = mergeBosConfigWithExtends(PARENT_CONFIG as any, child as any);
    const keys = Object.keys(merged);
    expect(keys[0]).toBe("extends");
    expect(keys[1]).toBe("account");
    expect(keys[2]).toBe("domain");
  });
});
