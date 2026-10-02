import { Effect, Fiber, Layer } from "effect";
import type { RuntimeConfig } from "everything-dev/types";
import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/services/config";
import {
  createRuntimeSnapshotState,
  deploymentFingerprint,
  RuntimeSnapshot,
} from "../../src/services/runtime-snapshot";
import { createSsrRender } from "../../src/services/ssr-render";

const baseConfig = {
  env: "production",
  account: "v1.citynode.near",
  domain: "citynode.app",
  networkId: "mainnet",
  title: "City Nodes",
  ui: {
    name: "ui",
    url: "https://cdn.example.test/ui/",
    entry: "https://cdn.example.test/ui/mf-manifest.json",
    source: "remote",
    integrity: "sha384-ui-entry",
  },
  api: {
    name: "api",
    url: "https://cdn.example.test/api/",
    entry: "https://cdn.example.test/api/mf-manifest.json",
    source: "remote",
  },
} as unknown as RuntimeConfig;

const snapshotLayer = RuntimeSnapshot.layer().pipe(
  Layer.provide(Layer.succeed(ConfigService, baseConfig)),
);

describe("RuntimeSnapshot service", () => {
  it("boots from ConfigService with a deployment fingerprint", async () => {
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        return yield* snapshot.get;
      }).pipe(Effect.provide(snapshotLayer)),
    );
    expect(state.config).toBe(baseConfig);
    expect(state.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(state.composeState).toBeDefined();
    expect(state.clientConfigState).toBeDefined();
  });

  it("swap releases the abandoned state's serving caches", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const before = yield* snapshot.get;
        before.composeState.variants.set("stale", {
          variant: {} as never,
          staleAfter: Number.POSITIVE_INFINITY,
        });
        before.clientConfigState.entries.set("stale", {
          value: {} as never,
          expiresAt: Number.POSITIVE_INFINITY,
        });

        yield* snapshot.swap(
          createRuntimeSnapshotState({
            fingerprint: "next",
            config: {
              ...baseConfig,
              ui: { ...baseConfig.ui, integrity: "sha384-ui-entry-v2" },
            } as RuntimeConfig,
          }),
        );

        expect(before.composeState.variants.size).toBe(0);
        expect(before.composeState.remoteManifests.size).toBe(0);
        expect(before.clientConfigState.entries.size).toBe(0);
        const after = yield* snapshot.get;
        expect(after).not.toBe(before);
      }).pipe(Effect.provide(snapshotLayer)),
    );
  });

  it("readers during a concurrent swap observe exactly one complete state", async () => {
    const observed: Array<string> = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const snapshot = yield* RuntimeSnapshot;
          const nextConfig = {
            ...baseConfig,
            ui: { ...baseConfig.ui, integrity: "sha384-ui-entry-v2" },
          } as RuntimeConfig;

          const reader = yield* Effect.forkScoped(
            Effect.gen(function* () {
              for (let i = 0; i < 200; i++) {
                const state = yield* snapshot.get;
                observed.push(state.config.ui.integrity ?? "none");
                yield* Effect.yieldNow;
              }
            }),
          );

          yield* Effect.sleep(1);
          yield* snapshot.swap(
            createRuntimeSnapshotState({
              fingerprint: "swapped",
              config: nextConfig,
            }),
          );
          yield* Effect.sleep(1);
          yield* Fiber.join(reader);
          return observed;
        }).pipe(Effect.provide(snapshotLayer)),
      ),
    );
    // every read observed one of the two complete states — never a hybrid
    expect(observed.length).toBeGreaterThan(0);
    for (const integrity of observed) {
      expect(["sha384-ui-entry", "sha384-ui-entry-v2"]).toContain(integrity);
    }
    expect(observed).toContain("sha384-ui-entry");
    expect(observed).toContain("sha384-ui-entry-v2");
  });
});

describe("deploymentFingerprint", () => {
  it("is stable for identical configs and sensitive to entry-level coordinates", () => {
    const a = deploymentFingerprint(baseConfig);
    const b = deploymentFingerprint(baseConfig);
    expect(a).toBe(b);

    const changedIntegrity = deploymentFingerprint({
      ...baseConfig,
      ui: { ...baseConfig.ui, integrity: "sha384-other" },
    } as RuntimeConfig);
    expect(changedIntegrity).not.toBe(a);

    const changedEntryUrl = deploymentFingerprint({
      ...baseConfig,
      ui: { ...baseConfig.ui, entryUrl: "https://cdn.example.test/ui/remoteEntry.8f3a.js" },
    } as RuntimeConfig);
    expect(changedEntryUrl).not.toBe(a);
  });
});

describe("ssr render read-through", () => {
  it("captures one serving state per request and resolves each against it", async () => {
    lastBase = undefined;
    const nextConfig = {
      ...baseConfig,
      ui: { ...baseConfig.ui, integrity: "sha384-ui-entry-v2" },
    } as RuntimeConfig;

    let serving = createRuntimeSnapshotState({ fingerprint: "boot", config: baseConfig });
    const getServingState = async () => serving;
    const render = createSsrRender({
      config: baseConfig,
      getServingState,
      plugins: {
        api: undefined,
        auth: undefined,
        status: {
          available: false,
          error: null,
          errorDetails: null,
          failures: [],
          loadedPlugins: [],
        },
      } as never,
    });

    const request = new Request("https://citynode.app/", { headers: { host: "citynode.app" } });
    await render(request, { session: null, user: null, pluginContext: {} } as never);
    const firstBase = lastBase as RuntimeConfig | undefined;

    serving = createRuntimeSnapshotState({ fingerprint: "next", config: nextConfig });
    await render(request, { session: null, user: null, pluginContext: {} } as never);
    const secondBase = lastBase as RuntimeConfig | undefined;

    expect(firstBase?.ui.integrity).toBe("sha384-ui-entry");
    expect(secondBase?.ui.integrity).toBe("sha384-ui-entry-v2");
  });
});

let lastBase: RuntimeConfig | undefined;

vi.mock("../../src/services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/services/tenant-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/tenant-runtime")>();
  return {
    ...actual,
    resolveRequestRuntime: (...args: unknown[]) => {
      // capture the base the caller passed, then delegate to the real one
      lastBase = args[0] as RuntimeConfig;
      return actual.resolveRequestRuntime(
        ...(args as Parameters<typeof actual.resolveRequestRuntime>),
      );
    },
  };
});
