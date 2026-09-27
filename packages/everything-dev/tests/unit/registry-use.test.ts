import { describe, expect, it } from "vitest";

import { applyRegistrySections, listComposableSections } from "../../src/registry-use";

const remoteConfig = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: { development: "local:host", production: "https://host.example" },
    ui: { development: "local:ui", production: "https://ui.example", integrity: "sha384-abc" },
    api: { development: "local:api", production: "https://api.example" },
  },
  plugins: {
    apps: { production: "https://apps.example", integrity: "sha384-def" },
    nostr: { production: "https://nostr.example" },
  },
};

const localConfig = {
  account: "chicago.v1.citynode.near",
  domain: "chicago.citynode.app",
  app: {
    host: { development: "local:host", production: "https://old-host.example" },
    ui: { development: "local:ui", production: "https://old-ui.example" },
    api: { development: "local:api", production: "https://old-api.example" },
  },
  plugins: {
    apps: { development: "local:plugins/apps", production: "https://old-apps.example" },
  },
};

describe("listComposableSections", () => {
  it("lists app sections and plugin keys present in the remote config", () => {
    expect(listComposableSections(remoteConfig)).toEqual([
      "app.host",
      "app.ui",
      "app.api",
      "plugins.apps",
      "plugins.nostr",
    ]);
  });
});

describe("applyRegistrySections", () => {
  it("overwrites the target section and preserves everything else", () => {
    const { config, applied } = applyRegistrySections(localConfig, remoteConfig, ["app.ui"]);

    expect(applied).toEqual(["app.ui"]);
    expect(config.app.ui).toEqual(remoteConfig.app.ui);
    expect(config.app.api).toEqual(localConfig.app.api);
    expect(config.account).toBe(localConfig.account);
    expect(config.domain).toBe(localConfig.domain);
  });

  it("composes plugin sections from the remote runtime", () => {
    const { config } = applyRegistrySections(localConfig, remoteConfig, ["plugins.nostr"]);

    expect(config.plugins?.nostr).toEqual(remoteConfig.plugins?.nostr);
    expect(config.plugins?.apps).toEqual(localConfig.plugins?.apps);
  });

  it("creates the plugins object when the local config has none", () => {
    const bare = { account: "x.near", domain: "x.app" };
    const { config } = applyRegistrySections(bare, remoteConfig, ["plugins.apps"]);

    expect(config.plugins?.apps).toEqual(remoteConfig.plugins?.apps);
  });

  it("rejects unknown sections with the available list", () => {
    expect(() => applyRegistrySections(localConfig, remoteConfig, ["app.ssr"])).toThrow(
      /app\.ssr.*Available: app\.host, app\.ui, app\.api, plugins\.apps, plugins\.nostr/s,
    );
  });
});
