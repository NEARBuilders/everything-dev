import { ConfigProvider, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../src/services/config";

const usePluginMock = vi.fn();

vi.mock("@module-federation/enhanced/runtime", () => ({
  createInstance: () => null,
}));
vi.mock("every-plugin", () => ({
  createPluginRuntime: () => ({ __mfInstance: undefined, usePlugin: usePluginMock }),
}));
vi.mock("every-plugin/remote-entry", async (importOriginal) => {
  const original = await importOriginal<typeof import("every-plugin/remote-entry")>();
  return {
    ...original,
    loadRemoteWithRetry: (options: Parameters<typeof original.loadRemoteWithRetry>[0]) =>
      original.loadRemoteWithRetry({
        // Tests stub `load`; the cold-compile poll would hit the network.
        ...options,
        readinessTimeoutMs: 0,
      }),
  };
});
vi.mock("everything-dev/integrity", () => ({
  IntegrityRegistry: class {
    registerEntry() {}
  },
  verifyConfigAgainstChain: async () => ({ verified: true, mismatches: [] }),
}));

const { initializePlugins } = await import("../../src/services/plugins");
const { ConfigService } = await import("../../src/services/config");

function makeLoaded(key: string) {
  return {
    createClient: (): unknown => ({}),
    router: { key },
    metadata: { remoteUrl: `https://cdn.example.com/${key}`, version: "1.0.0" },
    name: key,
  };
}

function slot(name: string) {
  return {
    name,
    url: `https://cdn.example.com/${name}`,
    entry: `https://cdn.example.com/${name}/mf-manifest.json`,
    entryUrl: `https://cdn.example.com/${name}/remoteEntry.js`,
    source: "remote" as const,
  };
}

function makeConfig(overrides: Partial<RuntimeConfig>, pluginNames: string[]): RuntimeConfig {
  return {
    env: "production",
    account: "test.near",
    networkId: "mainnet",
    ui: slot("ui"),
    api: { name: "api" },
    plugins: Object.fromEntries(pluginNames.map((name) => [name, slot(name)])),
    ...overrides,
  } as unknown as RuntimeConfig;
}

function run(currentConfig: RuntimeConfig) {
  return Effect.runPromise(
    Effect.scoped(
      initializePlugins().pipe(
        Effect.provideService(
          // Hermetic env — vitest's ambient "/" BASE_URL must not leak into the
          // origin derivation under test.
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({}),
        ),
        Effect.provideService(ConfigService, currentConfig),
      ),
    ),
  );
}

beforeEach(() => {
  usePluginMock.mockReset();
});

describe("plugin failure isolation", () => {
  it("still loads a healthy plugin when another plugin's bundle fails to load", async () => {
    usePluginMock.mockImplementation((runtimeId: string) =>
      runtimeId === "dead"
        ? Promise.reject(new Error("Module not found: dead/exploded-remote"))
        : Promise.resolve(makeLoaded(runtimeId)),
    );

    const result = await run(makeConfig({}, ["dead", "votes"]));

    expect(result.status.loadedPlugins).toContain("votes");
    expect(result.status.loadedPlugins).not.toContain("dead");
    expect(result.plugins.votes).toBeDefined();
    expect(result.status.failures).toHaveLength(1);
    expect(result.status.failures[0]?.pluginKey).toBe("dead");
  });

  it("isolates a plugin whose bootstrap dies fatally (production origin misconfig)", async () => {
    usePluginMock.mockImplementation((runtimeId: string) => Promise.resolve(makeLoaded(runtimeId)));

    const result = await run(
      makeConfig(
        {
          host: undefined,
          domain: undefined,
          auth: { ...slot("auth"), name: "auth" },
        } as Partial<RuntimeConfig>,
        ["votes"],
      ),
    );

    expect(result.auth).toBeNull();
    expect(result.status.loadedPlugins).toContain("votes");
    expect(result.status.failures).toHaveLength(1);
    expect(result.status.failures[0]?.pluginKey).toBe("auth");
    expect(result.status.failures[0]?.message).toContain("No reachable origin");
  });
});
