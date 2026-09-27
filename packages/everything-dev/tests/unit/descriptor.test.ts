import { describe, expect, it } from "vitest";
import { API, App, applyDevOverlay, Plugin, UI } from "../../src/descriptor/constructors";
import { resolveApp, resolveApps } from "../../src/descriptor/resolve";
import type { AppRegistry } from "../../src/descriptor/schema";
import type { BosConfigInput } from "../../src/types";

const baseApp = App({
  name: "everything",
  account: "dev.everything.near",
  domain: "everything.dev",
  host: { path: "host", secrets: ["CORS_ORIGIN"] },
  api: API({ path: "api" }),
  auth: Plugin("auth").path("plugins/auth", {
    secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET"],
    ui: { name: "auth-ui", path: "plugins/auth/ui" },
  }),
});

const tenantApp = App({
  name: "citynode",
  extends: "everything",
  account: "v1.citynode.near",
  domain: "citynode.app",
  title: "City Nodes",
  ui: UI({ path: "ui" }),
  api: API({
    path: "api",
    variables: { platformAccount: "v1.citynode.near" },
    secrets: ["API_DATABASE_URL"],
  }),
  plugins: {
    apps: Plugin("apps").path("plugins/apps"),
  },
});

const REGISTRY: AppRegistry = { everything: baseApp, citynode: tenantApp };

describe("descriptor constructors", () => {
  it("return plain serializable data", () => {
    expect(baseApp).toEqual({
      name: "everything",
      account: "dev.everything.near",
      domain: "everything.dev",
      host: { path: "host", secrets: ["CORS_ORIGIN"] },
      api: { path: "api" },
      auth: {
        name: "auth",
        path: "plugins/auth",
        secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET"],
        ui: { name: "auth-ui", path: "plugins/auth/ui" },
      },
    });
  });

  it("reject unknown keys (typo guard)", () => {
    expect(() => App({ name: "x", domian: "nope" } as never)).toThrow();
    expect(() => App({ name: "x", ui: { pat: "ui" } as never })).toThrow();
  });

  it("Plugin.extends produces a bos:// ref attachment", () => {
    expect(Plugin("votes").extends("bos://dev.everything.near/votes")).toEqual({
      name: "votes",
      extends: "bos://dev.everything.near/votes",
    });
  });
});

describe("resolveApp", () => {
  it("resolves a standalone app to local-ref config input", () => {
    const resolved = resolveApp("everything", REGISTRY);
    expect(resolved).toEqual<BosConfigInput>({
      account: "dev.everything.near",
      domain: "everything.dev",
      app: {
        host: { development: "local:host", secrets: ["CORS_ORIGIN"] },
        api: { development: "local:api" },
        auth: {
          name: "auth",
          development: "local:plugins/auth",
          secrets: ["AUTH_DATABASE_URL", "BETTER_AUTH_SECRET"],
          ui: { name: "auth-ui", development: "local:plugins/auth/ui" },
        },
      },
    });
    expect(resolved.extends).toBeUndefined();
  });

  it("flattens extends child-wins and drops the consumed extends key", () => {
    const resolved = resolveApp("citynode", REGISTRY);
    expect(resolved.extends).toBeUndefined();
    expect(resolved.account).toBe("v1.citynode.near");
    expect(resolved.title).toBe("City Nodes");
    expect(resolved.app?.ui).toEqual({ development: "local:ui" });
    // inherited from base
    expect(resolved.app?.auth).toMatchObject({ development: "local:plugins/auth" });
    // api entry merged child-wins, secrets unioned
    expect(resolved.app?.api).toEqual({
      development: "local:api",
      variables: { platformAccount: "v1.citynode.near" },
      secrets: ["API_DATABASE_URL"],
    });
    expect(resolved.plugins?.apps).toMatchObject({ development: "local:plugins/apps" });
  });

  it("rejects missing extends targets and chains deeper than one level", () => {
    expect(() => resolveApp("ghost", REGISTRY)).toThrow(/not found/);
    const chained: AppRegistry = {
      base: App({ name: "base" }),
      mid: App({ name: "mid", extends: "base" }),
      leaf: App({ name: "leaf", extends: "mid" }),
    };
    expect(() => resolveApp("leaf", chained)).toThrow(/deeper than one level/);
  });

  it("rejects circular extends (via the depth guard, no infinite loop)", () => {
    const circular = { a: { name: "a", extends: "b" }, b: { name: "b", extends: "a" } };
    expect(() => resolveApps(circular)).toThrow(/Circular|deeper than one level/);
    expect(() => resolveApp("a", { a: { name: "a", extends: "a" } })).toThrow(
      /Circular|deeper than one level/,
    );
  });

  it("injects deploy-map pipeline state over the merged composition", () => {
    const resolved = resolveApp("citynode", REGISTRY, {
      citynode: {
        app: {
          host: { production: "https://host.example", integrity: "sha384-host" },
          ui: {
            production: "https://ui.example",
            integrity: "sha384-ui",
            ssr: "https://ssr.example",
            ssrIntegrity: "sha384-ssr",
          },
        },
        plugins: { apps: { production: "https://apps.example", integrity: "sha384-apps" } },
      },
    });

    expect(resolved.app?.host).toMatchObject({ production: "https://host.example" });
    expect(resolved.app?.ui).toEqual({
      development: "local:ui",
      production: "https://ui.example",
      integrity: "sha384-ui",
      ssr: "https://ssr.example",
      ssrIntegrity: "sha384-ssr",
    });
    // inherited slot, deploy map still applies
    expect(resolved.app?.auth).toMatchObject({ development: "local:plugins/auth" });
    expect(resolved.plugins?.apps).toMatchObject({ production: "https://apps.example" });
  });
});

describe("resolveApps", () => {
  it("resolves every app in the registry", () => {
    const resolved = resolveApps(REGISTRY);
    expect(Object.keys(resolved).sort()).toEqual(["citynode", "everything"]);
    expect(resolved.everything.name).toBeUndefined();
    expect(resolved.citynode.domain).toBe("citynode.app");
  });
});

describe("imported-App extends", () => {
  it("accepts an imported App descriptor value as an inlined parent", () => {
    const child = App({
      name: "tenant",
      extends: baseApp,
      account: "tenant.near",
      domain: "tenant.everything.dev",
    });
    const resolved = resolveApp("tenant", { tenant: child });
    expect(resolved.account).toBe("tenant.near");
    expect(resolved.domain).toBe("tenant.everything.dev");
    // inherited from the inlined parent — identical to a fetched parent
    expect(resolved.app?.host).toEqual({ development: "local:host", secrets: ["CORS_ORIGIN"] });
    expect(resolved.app?.auth).toMatchObject({
      name: "auth",
      development: "local:plugins/auth",
      ui: { name: "auth-ui", development: "local:plugins/auth/ui" },
    });
    expect(resolved.extends).toBeUndefined();
  });

  it("rejects an inlined parent that itself extends (depth guard)", () => {
    const mid = App({ name: "mid", extends: "everything" });
    const leaf = App({ name: "leaf", extends: mid });
    expect(() => resolveApp("leaf", { everything: baseApp, leaf })).toThrow(
      /deeper than one level/,
    );
  });
});

describe("applyDevOverlay", () => {
  it("merges the overlay child-wins and never mutates the resolved input", () => {
    const resolved = resolveApp("citynode", REGISTRY);
    const overlaid = applyDevOverlay(resolved, {
      api: { path: "api", variables: { platformAccount: "dev-proxy.near" } },
    });
    expect(overlaid.app?.api).toMatchObject({
      development: "local:api",
      variables: { platformAccount: "dev-proxy.near" },
    });
    // the original resolved config is untouched
    expect(resolved.app?.api).toMatchObject({
      variables: { platformAccount: "v1.citynode.near" },
    });
  });

  it("keeps authored secrets intact through the overlay", () => {
    const resolved = resolveApp("citynode", REGISTRY);
    const overlaid = applyDevOverlay(resolved, { ui: { path: "ui" } });
    expect(overlaid.app?.ui).toEqual({ development: "local:ui" });
  });
});
