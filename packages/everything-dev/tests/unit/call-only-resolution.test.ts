import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServiceDescriptorMap } from "../../src/services/dev/service-descriptor";
import { buildRuntimePluginsForConfig } from "../../src/services/resolution/runtime";
import type { RuntimeConfig } from "../../src/types";

const originalFetch = globalThis.fetch;

// The contract locator resolves through the registry seam: the provider app's
// published config (its app.api entry carries the STAMPED production — the
// artifact CDN origin that serves plugin.manifest.json).
const CONTRACT_PRODUCTION =
  "https://cdn.everything.dev/bundles/nearbuilding.near/feedback.nearbuilders.org/api";
const PROXY_ORIGIN = "https://feedback.nearbuilders.org";

vi.mock("../../src/services/registry/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/registry/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: async (bosUrl: string) => {
      if (bosUrl === "bos://nearbuilding.near/feedback.nearbuilders.org") {
        return {
          account: "nearbuilding.near",
          app: {
            host: { production: "https://feedback.nearbuilders.org" },
            ui: {
              production:
                "https://cdn.everything.dev/bundles/nearbuilding.near/feedback.nearbuilders.org/ui",
            },
            api: { production: CONTRACT_PRODUCTION },
          },
        };
      }
      throw new Error(`No config found for ${bosUrl}`);
    },
  };
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function callOnlyConfig(extra: Record<string, unknown> = {}) {
  return {
    account: "test.near",
    app: {
      host: { development: "local:host" },
      ui: { development: "local:ui" },
      api: { development: "local:api" },
    },
    plugins: {
      feedback: {
        proxy: PROXY_ORIGIN,
        contract: "bos://nearbuilding.near/feedback.nearbuilders.org#app.api",
        secrets: ["FEEDBACK_API_KEY"],
        ...extra,
      },
    },
  } as any;
}

function baseRuntimeConfig(): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    networkId: "testnet",
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "/mf-manifest.json",
      source: "local",
    },
    ui: { name: "ui", url: "http://localhost:3003", entry: "/mf-manifest.json", source: "local" },
    api: { name: "api", url: "http://localhost:3001", entry: "/mf-manifest.json", source: "local" },
    plugins: {
      feedback: {
        name: "feedback",
        url: PROXY_ORIGIN,
        entry: "",
        source: "remote",
        proxy: PROXY_ORIGIN,
        contractUrl: CONTRACT_PRODUCTION,
      },
    },
  };
}

describe("call-only plugin resolution (#848)", () => {
  it("resolves the two locators: url is the proxy endpoint, contractUrl is the stamped contract origin", async () => {
    const plugins = await buildRuntimePluginsForConfig(callOnlyConfig(), "/tmp", "development");
    const feedback = plugins?.feedback;
    expect(feedback?.url).toBe(PROXY_ORIGIN);
    expect(feedback?.proxy).toBe(PROXY_ORIGIN);
    expect(feedback?.contractUrl).toBe(CONTRACT_PRODUCTION);
    expect(feedback?.url).not.toBe(feedback?.contractUrl);
    expect(feedback?.entry).toBe("");
    expect(feedback?.secrets).toEqual(["FEEDBACK_API_KEY"]);
    expect(feedback?.localPath).toBeUndefined();
  });

  it("refuses a call-only entry without a contract locator", async () => {
    await expect(
      buildRuntimePluginsForConfig(callOnlyConfig({ contract: undefined }), "/tmp", "development"),
    ).rejects.toThrow(/declares proxy \(call-only\) without a contract locator/);
  });

  it("refuses a contract locator without proxy", async () => {
    await expect(
      buildRuntimePluginsForConfig(callOnlyConfig({ proxy: undefined }), "/tmp", "development"),
    ).rejects.toThrow(/declares contract without proxy/);
  });

  it("refuses call-only entries declaring composed-source fields", async () => {
    await expect(
      buildRuntimePluginsForConfig(
        callOnlyConfig({ extends: "bos://provider.near/provider.dev#plugins.feedback" }),
        "/tmp",
        "development",
      ),
    ).rejects.toThrow(/declares proxy \(call-only\) alongside extends/);
    await expect(
      buildRuntimePluginsForConfig(
        callOnlyConfig({ development: "local:../feedback/api" }),
        "/tmp",
        "development",
      ),
    ).rejects.toThrow(/declares proxy \(call-only\) alongside development/);
    await expect(
      buildRuntimePluginsForConfig(callOnlyConfig({ ui: false }), "/tmp", "development"),
    ).rejects.toThrow(/declares proxy \(call-only\) alongside ui/);
  });

  it("composed plugins are unaffected — url fields still drive federation resolution", async () => {
    const plugins = await buildRuntimePluginsForConfig(
      {
        account: "test.near",
        app: {
          host: { development: "local:host" },
          ui: { development: "local:ui" },
          api: { development: "local:api" },
        },
        plugins: {
          votes: {
            name: "votes-plugin",
            development: "local:plugins/votes",
            production: "https://cdn.everything.dev/bundles/test.near/votes.dev/plugins/votes",
          },
        },
      } as any,
      "/tmp",
      "development",
    );
    const votes = plugins?.votes;
    expect(votes?.source).toBe("remote");
    expect(votes?.url).toBe("https://cdn.everything.dev/bundles/test.near/votes.dev/plugins/votes");
    expect(votes?.entry).toBe(
      "https://cdn.everything.dev/bundles/test.near/votes.dev/plugins/votes/mf-manifest.json",
    );
    expect(votes?.contractUrl).toBeUndefined();
  });
});

describe("call-only dev service descriptors (#848)", () => {
  it("probes the traffic endpoint's rpc ping and spawns no dev process", () => {
    const map = buildServiceDescriptorMap(baseRuntimeConfig());
    const descriptor = map.get("plugin:feedback");
    expect(descriptor).toBeDefined();
    expect(descriptor?.readinessUrl).toBe(`${PROXY_ORIGIN}/api/rpc/ping`);
    expect(descriptor?.readinessMethod).toBe("POST");
    expect(descriptor?.command).toBeUndefined();
    expect(descriptor?.args).toBeUndefined();
    expect(descriptor?.readinessPath).toBe("/");
  });

  it("composed plugins keep the federation probe and spawn command", () => {
    const config = baseRuntimeConfig();
    config.plugins!.feedback = {
      ...config.plugins!.feedback,
      contractUrl: undefined,
      entry: `${PROXY_ORIGIN}/mf-manifest.json`,
    };
    const map = buildServiceDescriptorMap(config);
    const descriptor = map.get("plugin:feedback");
    expect(descriptor?.readinessUrl).toBeUndefined();
    expect(descriptor?.command).toBe("pnpm");
    expect(descriptor?.readinessPath).toBe("/remoteEntry.js");
  });
});
