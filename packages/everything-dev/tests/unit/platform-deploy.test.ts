import { describe, expect, it } from "vitest";
import { applyPluginPublishUrl, platformUrlDeployEntries } from "../../src/platform-deploy";

describe("platformUrlDeployEntries (image-native)", () => {
  const ORIGIN = "https://citynode.app";
  const BASE = `${ORIGIN}/bundles/v1.citynode.near/citynode.app`;

  it("writes production + integrity fields with no integrity value", () => {
    const entries = platformUrlDeployEntries({
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "ui",
      kind: "app",
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      url: `${BASE}/ui/`,
      urlField: "app.ui.production",
      integrityField: "app.ui.integrity",
    });
    // integrity omitted — applyDeployResults deletes stale pipeline hashes
    expect(entries[0].integrity).toBeUndefined();
  });

  it("derives the SSR container URL for the ui slot", () => {
    const entries = platformUrlDeployEntries({
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "ui",
      kind: "app",
    });
    expect(entries[1]).toEqual({
      url: `${BASE}/ui/ssr/`,
      urlField: "app.ui.ssr",
      integrityField: "app.ui.ssrIntegrity",
    });
  });

  it("maps plugins to the plugins slot without ssr", () => {
    const entries = platformUrlDeployEntries({
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "votes",
      kind: "plugin",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      url: `${BASE}/votes/`,
      urlField: "plugins.votes.production",
      integrityField: "plugins.votes.integrity",
    });
  });
});

describe("applyPluginPublishUrl (image-native plugin publish)", () => {
  const ORIGIN = "https://citynode.app";

  it("sets the deterministic bundle URL and deletes stale integrity", () => {
    const config = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      plugins: {
        votes: {
          development: "local:plugins/votes",
          production: "https://stale.example.com/votes/",
          integrity: "sha384-stale",
        },
      },
    };

    const merged = applyPluginPublishUrl(config, {
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "votes",
    });

    expect(merged).not.toBe(config);
    const votes = (merged.plugins as Record<string, Record<string, unknown>>).votes;
    expect(votes?.production).toBe(`${ORIGIN}/bundles/v1.citynode.near/citynode.app/votes/`);
    expect(votes?.integrity).toBeUndefined();
    expect(votes?.development).toBe("local:plugins/votes");
  });

  it("creates the plugins entry when absent and never touches other slots", () => {
    const config = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: { ui: { production: "https://elsewhere/ui/" } },
    };

    const merged = applyPluginPublishUrl(config, {
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "auth",
    });

    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.auth?.production).toBe(`${ORIGIN}/bundles/v1.citynode.near/citynode.app/auth/`);
    expect((merged.app as Record<string, unknown>).ui).toBeDefined();
  });
});
