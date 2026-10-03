import { describe, expect, it } from "vitest";
import { applyDeployResults } from "../../src/integrity";
import { platformUrlDeployEntries, pluginUiUrlDeployEntries } from "../../src/platform-deploy";

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
      removeFields: ["app.ui.manifest"],
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
      removeFields: ["plugins.votes.manifest"],
    });
  });

  it("pins the slot: `pin` carries the manifest pointer, the direct entry SRI is scrubbed", () => {
    const config = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        ui: { development: "local:ui", integrity: "sha384-stale-entry-sri" },
      },
    };

    const merged = applyDeployResults(
      config,
      platformUrlDeployEntries({
        origin: ORIGIN,
        account: "v1.citynode.near",
        gateway: "citynode.app",
        key: "ui",
        kind: "app",
        pin: { file: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-manifest-sri" },
        integrity: "sha384-entry-sri",
        ssrIntegrity: "sha384-ssr-entry-sri",
      }),
    );

    const ui = (merged.app as Record<string, Record<string, unknown>>).ui;
    expect(ui.pin).toEqual({
      manifest: "versions/8f3ac1d2feedbeef.json",
      integrity: "sha384-manifest-sri",
    });
    // the pinned slot's identity is the pin — the direct entry SRI must not linger
    expect(ui.integrity).toBeUndefined();
    // a legacy flat manifest pointer is scrubbed
    expect(ui.manifest).toBeUndefined();
  });
});

describe("pluginUiUrlDeployEntries (folder-form plugin ui)", () => {
  const ORIGIN = "https://citynode.app";
  const BASE = `${ORIGIN}/bundles/v1.citynode.near/citynode.app`;

  it("pins app.<key>.ui.* fields for an app-slot plugin", () => {
    const entries = pluginUiUrlDeployEntries({
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "auth",
      kind: "app",
      integrity: "sha384-web",
      ssrIntegrity: "sha384-ssr",
    });
    expect(entries).toEqual([
      {
        url: `${BASE}/auth-ui/`,
        integrity: "sha384-web",
        urlField: "app.auth.ui.production",
        integrityField: "app.auth.ui.integrity",
        removeFields: ["app.auth.ui.manifest"],
      },
      {
        url: `${BASE}/auth-ui/ssr/`,
        integrity: "sha384-ssr",
        urlField: "app.auth.ui.ssr",
        integrityField: "app.auth.ui.ssrIntegrity",
      },
    ]);
  });

  it("pins plugins.<id>.ui.* fields for a plugins-slot entry", () => {
    const entries = pluginUiUrlDeployEntries({
      origin: ORIGIN,
      account: "v1.citynode.near",
      gateway: "citynode.app",
      key: "votes",
      kind: "plugin",
    });
    expect(entries[0]).toMatchObject({
      url: `${BASE}/votes-ui/`,
      urlField: "plugins.votes.ui.production",
      integrityField: "plugins.votes.ui.integrity",
    });
  });

  it("merges into an existing ui entry without clobbering name/development", () => {
    const config = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        auth: {
          development: "local:plugins/auth",
          ui: { name: "auth-ui", development: "local:plugins/auth/ui" },
        },
      },
    };

    const merged = applyDeployResults(
      config,
      pluginUiUrlDeployEntries({
        origin: ORIGIN,
        account: "v1.citynode.near",
        gateway: "citynode.app",
        key: "auth",
        kind: "app",
        integrity: "sha384-web",
        ssrIntegrity: "sha384-ssr",
      }),
    );

    const authUi = (merged.app as Record<string, Record<string, unknown>>).auth.ui as Record<
      string,
      unknown
    >;
    expect(authUi.name).toBe("auth-ui");
    expect(authUi.development).toBe("local:plugins/auth/ui");
    expect(authUi.production).toBe(`${BASE}/auth-ui/`);
    expect(authUi.integrity).toBe("sha384-web");
    expect(authUi.ssr).toBe(`${BASE}/auth-ui/ssr/`);
    expect(authUi.ssrIntegrity).toBe("sha384-ssr");
  });

  it("stamps the built container name over the authored fallback", () => {
    const config = {
      account: "v1.citynode.near",
      domain: "citynode.app",
      app: {
        auth: {
          development: "local:plugins/auth",
          ui: { name: "auth-ui", development: "local:plugins/auth/ui" },
        },
      },
    };

    const merged = applyDeployResults(
      config,
      pluginUiUrlDeployEntries({
        origin: ORIGIN,
        account: "v1.citynode.near",
        gateway: "citynode.app",
        key: "auth",
        kind: "app",
        name: "_everything_dev_auth_plugin",
      }),
    );

    const authUi = (merged.app as Record<string, Record<string, unknown>>).auth.ui as Record<
      string,
      unknown
    >;
    expect(authUi.name).toBe("_everything_dev_auth_plugin");
    expect(authUi.development).toBe("local:plugins/auth/ui");
  });

  it("carries the version-manifest pin on the ui slot", () => {
    const merged = applyDeployResults(
      { account: "v1.citynode.near", app: { auth: { ui: { name: "auth-ui" } } } },
      pluginUiUrlDeployEntries({
        origin: ORIGIN,
        account: "v1.citynode.near",
        gateway: "citynode.app",
        key: "auth",
        kind: "app",
        pin: { file: "versions/eee.json", integrity: "sha384-ui-manifest-sri" },
      }),
    );
    const authUi = (merged.app as Record<string, Record<string, unknown>>).auth.ui as Record<
      string,
      unknown
    >;
    expect(authUi.pin).toEqual({
      manifest: "versions/eee.json",
      integrity: "sha384-ui-manifest-sri",
    });
  });
});
