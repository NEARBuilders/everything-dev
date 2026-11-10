import type { RuntimeConfig } from "everything-dev/types";
import { describe, expect, it } from "vitest";
import { planAttachments } from "../../src/services/plugins";

function baseConfig(
  plugins: RuntimeConfig["plugins"],
  overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig {
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
    ...overrides,
  } as RuntimeConfig;
}

function composedPlugin(url: string): NonNullable<RuntimeConfig["plugins"]>[string] {
  return {
    name: "votes-plugin",
    url,
    entry: `${url}/mf-manifest.json`,
    source: "remote",
  };
}

function callOnlyPlugin(): NonNullable<RuntimeConfig["plugins"]>[string] {
  return {
    name: "feedback",
    url: "https://feedback.nearbuilders.org",
    entry: "",
    source: "remote",
    proxy: "https://feedback.nearbuilders.org",
    contractUrl:
      "https://cdn.everything.dev/bundles/nearbuilding.near/feedback.nearbuilders.org/api",
  };
}

describe("planAttachments — the attachment policy (#848)", () => {
  it("segregates call-only attachments from federation loadables", () => {
    const plan = planAttachments(
      baseConfig({
        votes: composedPlugin("https://votes.example.com"),
        feedback: callOnlyPlugin(),
      }),
    );
    expect(plan.loadable.map((entry) => entry.key).sort()).toEqual(["api", "votes"]);
    expect(plan.callOnly.map((entry) => entry.key)).toEqual(["feedback"]);
    expect(plan.idle).toBe(false);
    expect(plan.proxyMode).toBe(false);
  });

  it("orders federation loadables in DAG order — the api loads after its dependencies", () => {
    const plan = planAttachments(
      baseConfig({
        votes: { ...composedPlugin("https://votes.example.com"), dependsOn: ["registry"] },
        registry: composedPlugin("https://registry.example.com"),
      }),
    );
    const keys = plan.loadable.map((entry) => entry.key);
    expect(keys.indexOf("registry")).toBeLessThan(keys.indexOf("votes"));
    expect(keys.indexOf("votes")).toBeLessThan(keys.indexOf("api"));
  });

  it("excludes the auth mirror — the auth slot owns that backend", () => {
    const authUrl = "https://auth.example.com";
    const authSlot = {
      name: "auth-plugin",
      url: authUrl,
      entry: `${authUrl}/mf-manifest.json`,
      source: "remote" as const,
    };
    const config = baseConfig({ auth: structuredClone(authSlot) }) as RuntimeConfig;
    config.auth = authSlot;
    const plan = planAttachments(config);
    expect(plan.loadable.filter((entry) => entry.key === "auth")).toHaveLength(1);
  });

  it("flags proxy mode — the host composes nothing and forwards /api/*", () => {
    const config = baseConfig({}) as RuntimeConfig;
    config.api = { ...config.api, proxy: "https://upstream.example.com" };
    const plan = planAttachments(config);
    expect(plan.proxyMode).toBe(true);
  });

  it("flags idle when nothing is loadable and no auth slot exists", () => {
    const config = baseConfig({});
    const plan = planAttachments(config);
    expect(plan.loadable.map((entry) => entry.key)).toEqual(["api"]);
    expect(plan.idle).toBe(false);

    const noApi = { ...config, api: { ...config.api, url: "" } };
    expect(planAttachments(noApi as RuntimeConfig).idle).toBe(true);
  });
});
