import { describe, expect, it } from "vitest";
import {
  isRegistryStart,
  prepareLocalProductionConfig,
  resolveStartConfigSource,
} from "../../src/local-prod-config";
import type { BosConfig } from "../../src/types";

const baseConfig = {
  account: "v1.citynode.near",
  domain: "citynode.app",
  repository: "https://github.com/NEARBuilders/citynode.app",
  staging: { domain: "testnet.citynode.app", account: "v1.citynode.testnet" },
  app: {
    host: {
      development: "local:host",
      production: "https://host.example.com",
      secrets: ["CORS_ORIGIN"],
    },
    ui: {
      development: "local:ui",
      production: "https://ui.example.com",
      ssr: "https://ssr.example.com",
      integrity: "sha384-ui",
      ssrIntegrity: "sha384-ui-ssr",
    },
    api: {
      development: "local:api",
      production: "https://api.example.com",
      integrity: "sha384-api",
      variables: { platformAccount: "v1.citynode.near" },
      secrets: ["API_DATABASE_URL"],
    },
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://auth.example.com",
      integrity: "sha384-auth",
      secrets: ["AUTH_DATABASE_URL"],
      ui: {
        name: "auth-ui",
        development: "local:plugins/auth/ui",
        production: "https://auth-ui.example.com",
        integrity: "sha384-auth-ui",
        ssr: "https://auth-ui-ssr.example.com",
        ssrIntegrity: "sha384-auth-ui-ssr",
      },
    },
  },
  plugins: {
    template: {
      development: "local:plugins/_template",
      production: "https://template.example.com",
      integrity: "sha384-template",
      secrets: ["TEMPLATE_DATABASE_URL"],
    },
    remoteOnly: { production: "https://remote.example.com", integrity: "sha384-remote" },
    stringRef: "some-account.near",
  },
} as unknown as BosConfig;

describe("prepareLocalProductionConfig", () => {
  it("rewrites every planned remote to localhost and drops integrity", () => {
    const result = prepareLocalProductionConfig(baseConfig, {
      host: "http://localhost:4105",
      ui: { production: "http://localhost:4103", ssr: "http://localhost:4103/ssr" },
      api: "http://localhost:4101",
      auth: "http://localhost:4102",
      authUi: {
        production: "http://localhost:4112",
        ssr: "http://localhost:4112/ssr",
        name: "_everything_dev_auth_plugin",
      },
      plugins: {
        template: { production: "http://localhost:4113" },
        remoteOnly: { production: "http://localhost:4114" },
      },
    });

    expect(result.app.host).toMatchObject({
      development: "local:host",
      production: "http://localhost:4105",
      secrets: ["CORS_ORIGIN"],
    });
    expect(result.app.ui).toEqual({
      development: "local:ui",
      production: "http://localhost:4103",
      ssr: "http://localhost:4103/ssr",
    });
    expect(result.app.api).toMatchObject({
      production: "http://localhost:4101",
      variables: { platformAccount: "v1.citynode.near" },
      secrets: ["API_DATABASE_URL"],
    });
    expect(result.app.api).not.toHaveProperty("integrity");
    expect(result.app.auth).toMatchObject({
      name: "@everything-dev/auth-plugin",
      production: "http://localhost:4102",
      secrets: ["AUTH_DATABASE_URL"],
    });
    expect(result.app.auth).not.toHaveProperty("integrity");
    expect(result.app.auth?.ui).toEqual({
      name: "_everything_dev_auth_plugin",
      development: "local:plugins/auth/ui",
      production: "http://localhost:4112",
      ssr: "http://localhost:4112/ssr",
    });
    expect(result.plugins?.template).toMatchObject({ production: "http://localhost:4113" });
    expect(result.plugins?.template).not.toHaveProperty("integrity");
    expect(result.plugins?.remoteOnly).toMatchObject({ production: "http://localhost:4114" });
  });

  it("a planned ui without an ssr origin is the csr variant", () => {
    const result = prepareLocalProductionConfig(baseConfig, {
      ui: { production: "http://localhost:4103" },
      authUi: { production: "http://localhost:4112", name: "_everything_dev_auth_plugin" },
      api: "http://localhost:4101",
      auth: "http://localhost:4102",
    });
    expect(result.app.ui).not.toHaveProperty("ssr");
    expect(result.app.ui).not.toHaveProperty("ssrIntegrity");
    expect(result.app.ui).toMatchObject({ production: "http://localhost:4103" });
    expect(result.app.auth?.ui).not.toHaveProperty("ssr");
  });

  it("plans publicUrl alongside container-local production urls", () => {
    const result = prepareLocalProductionConfig(baseConfig, {
      ui: {
        production: "http://localhost:4103",
        ssr: "http://localhost:4103/ssr",
        publicUrl: "/bundles/v1.citynode.near/citynode.app/ui",
      },
      auth: "http://localhost:4102",
      authUi: {
        production: "http://localhost:4112",
        name: "_everything_dev_auth_plugin",
        publicUrl: "/bundles/v1.citynode.near/citynode.app/auth-ui",
      },
      plugins: {
        template: {
          production: "http://localhost:4113",
          uiPublicUrl: "/bundles/v1.citynode.near/citynode.app/template",
        },
      },
    });
    expect(result.app.ui).toMatchObject({
      production: "http://localhost:4103",
      publicUrl: "/bundles/v1.citynode.near/citynode.app/ui",
    });
    expect(result.app.auth?.ui).toMatchObject({
      production: "http://localhost:4112",
      publicUrl: "/bundles/v1.citynode.near/citynode.app/auth-ui",
    });
    expect(result.plugins?.template).toMatchObject({
      production: "http://localhost:4113",
    });
  });

  it("leaves publicUrl untouched when the plan does not mention it", () => {
    const withPublic = {
      ...baseConfig,
      app: {
        ...baseConfig.app,
        ui: {
          ...baseConfig.app.ui,
          publicUrl: "https://public.example.com/ui",
        },
      },
    } as unknown as BosConfig;
    const result = prepareLocalProductionConfig(withPublic, {
      ui: { production: "http://localhost:4103" },
    });
    expect(result.app.ui).toMatchObject({
      production: "http://localhost:4103",
      publicUrl: "https://public.example.com/ui",
    });
  });

  it("leaves unplanned remotes verbatim — origin and integrity", () => {
    const result = prepareLocalProductionConfig(baseConfig, {
      ui: { production: "http://localhost:4103", ssr: "http://localhost:4103/ssr" },
    });
    expect(result.plugins?.template).toEqual(baseConfig.plugins?.template);
    expect(result.plugins?.remoteOnly).toEqual(baseConfig.plugins?.remoteOnly);
    expect(result.app.api).toEqual(baseConfig.app.api);
    expect(result.app.auth).toEqual(baseConfig.app.auth);
  });

  it("passes string plugin refs and unrelated config through untouched", () => {
    const result = prepareLocalProductionConfig(baseConfig, {
      ui: { production: "http://localhost:4103" },
      api: "http://localhost:4101",
    });
    expect(result.plugins?.stringRef).toBe("some-account.near");
    expect(result.account).toBe("v1.citynode.near");
    expect(result.domain).toBe("citynode.app");
    expect(result.staging).toEqual(baseConfig.staging);
    expect(result.app.host).toEqual(baseConfig.app.host);
  });

  it("does not mutate the input config", () => {
    const frozen = JSON.parse(JSON.stringify(baseConfig));
    prepareLocalProductionConfig(baseConfig, {
      ui: { production: "http://localhost:4103", ssr: "http://localhost:4103/ssr" },
      api: "http://localhost:4101",
      auth: "http://localhost:4102",
      authUi: { production: "http://localhost:4112" },
      plugins: { template: { production: "http://localhost:4113" } },
    });
    expect(baseConfig).toEqual(frozen);
  });
});

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
