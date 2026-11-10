import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServiceDescriptorMap } from "../../src/services/dev/service-descriptor";
import {
  buildRuntimeConfig,
  buildRuntimePluginsForConfig,
} from "../../src/services/resolution/runtime";
import type { RuntimeConfig } from "../../src/types";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function rpcPluginConfig(extra: Record<string, unknown> = {}) {
  return {
    account: "test.near",
    app: {
      host: { development: "local:host" },
      ui: { development: "local:ui" },
      api: { development: "local:api" },
    },
    plugins: {
      feedback: {
        mode: "rpc",
        development: "http://localhost:4301",
        production: "https://feedback.example.com",
        secrets: ["FEEDBACK_API_KEY"],
        name: "feedback-plugin",
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
        name: "feedback-plugin",
        url: "https://feedback.example.com",
        entry: "https://feedback.example.com/mf-manifest.json",
        source: "remote",
        mode: "rpc",
      },
    },
  };
}

describe("rpc-mode plugin resolution (#848)", () => {
  it("carries mode and the resolved url through plugin resolution", async () => {
    const plugins = await buildRuntimePluginsForConfig(rpcPluginConfig(), "/tmp", "development");
    const feedback = plugins?.feedback;
    expect(feedback?.mode).toBe("rpc");
    expect(feedback?.url).toBe("http://localhost:4301");
    expect(feedback?.source).toBe("remote");
    expect(feedback?.secrets).toEqual(["FEEDBACK_API_KEY"]);
  });

  it("production env resolves the production url without demanding a version-manifest digest", async () => {
    const plugins = await buildRuntimePluginsForConfig(rpcPluginConfig(), "/tmp", "production");
    const runtime = await buildRuntimeConfig(rpcPluginConfig(), "/tmp", "production", { plugins });
    const feedback = runtime.plugins?.feedback;
    expect(feedback?.mode).toBe("rpc");
    expect(feedback?.url).toBe("https://feedback.example.com");
    expect(feedback?.digest).toBeUndefined();
    expect(feedback?.integrity).toBeUndefined();
  });

  it("refuses a local: development target for rpc entries", async () => {
    await expect(
      buildRuntimePluginsForConfig(
        {
          account: "test.near",
          app: {
            host: { development: "local:host" },
            ui: { development: "local:ui" },
            api: { development: "local:api" },
          },
          plugins: {
            feedback: {
              mode: "rpc",
              development: "local:../feedback/api",
              production: "https://feedback.example.com",
            },
          },
        } as any,
        "/tmp",
        "development",
      ),
    ).rejects.toThrow(/mode: "rpc" with a local target/);
  });

  it("refuses an rpc entry that resolves to no url", async () => {
    await expect(
      buildRuntimePluginsForConfig(
        {
          account: "test.near",
          app: {
            host: { development: "local:host" },
            ui: { development: "local:ui" },
            api: { development: "local:api" },
          },
          plugins: { feedback: { mode: "rpc", secrets: ["FEEDBACK_API_KEY"] } },
        } as any,
        "/tmp",
        "development",
      ),
    ).rejects.toThrow(/declares mode: "rpc" but resolves to no URL/);
  });
});

describe("rpc-mode dev service descriptors (#848)", () => {
  it("probes the remote plugin manifest and spawns no dev process", () => {
    const map = buildServiceDescriptorMap(baseRuntimeConfig());
    const descriptor = map.get("plugin:feedback");
    expect(descriptor).toBeDefined();
    expect(descriptor?.readinessUrl).toBe("https://feedback.example.com/plugin.manifest.json");
    expect(descriptor?.command).toBeUndefined();
    expect(descriptor?.args).toBeUndefined();
    expect(descriptor?.source).toBe("remote");
  });

  it("composed plugins keep the federation probe and spawn command", () => {
    const config = baseRuntimeConfig();
    config.plugins!.feedback = {
      ...config.plugins!.feedback,
      mode: undefined,
    };
    const map = buildServiceDescriptorMap(config);
    const descriptor = map.get("plugin:feedback");
    expect(descriptor?.readinessUrl).toBeUndefined();
    expect(descriptor?.command).toBe("pnpm");
    expect(descriptor?.readinessPath).toBe("/remoteEntry.js");
  });
});
