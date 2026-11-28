import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../src/services/config";

const federationMocks = vi.hoisted(() => ({
  loadUiComposeModule: vi.fn(),
  loadCoreUiRouteConfig: vi.fn(),
  loadUiRouteConfig: vi.fn(),
  loadRouterModule: vi.fn(),
  localUiRemoteEntry: vi.fn(),
  waitForLocalContainer: vi.fn(),
}));

vi.mock("../../src/services/federation/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/federation/loader")>();
  const loaderService = {
    ensureSession: () => ({ mf: {} as never, generation: 1 }),
    verifyIntegrity: () => Effect.void,
    loadExpose: () => Effect.die("loadExpose must run through the module-level mocks"),
    loadRouterModule: () => Effect.die("loadRouterModule must run through the module-level mocks"),
  };
  const mutable = actual.FederationLoader as unknown as { layer: Layer.Layer<never, never> };
  mutable.layer = Layer.succeed(actual.FederationLoader, loaderService as never);
  return {
    ...actual,
    loadUiComposeModule: (...args: unknown[]) => federationMocks.loadUiComposeModule(...args),
    loadCoreUiRouteConfig: (...args: unknown[]) => federationMocks.loadCoreUiRouteConfig(...args),
    loadUiRouteConfig: (...args: unknown[]) => federationMocks.loadUiRouteConfig(...args),
    loadRouterModule: (...args: unknown[]) => federationMocks.loadRouterModule(...args),
  };
});

vi.mock("../../src/services/federation/containers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/federation/containers")>();
  const containersService = {
    localUiRemoteEntry: (...args: unknown[]) => federationMocks.localUiRemoteEntry(...args),
  };
  const mutable = actual.FederationContainers as unknown as { layer: Layer.Layer<never, never> };
  mutable.layer = Layer.succeed(actual.FederationContainers, containersService as never);
  return {
    ...actual,
    waitForLocalContainer: (...args: unknown[]) => federationMocks.waitForLocalContainer(...args),
  };
});

const { composeUi, createUiComposeCacheState } = await import("../../src/services/ui-compose");
const { FederationError } = await import("../../src/services/errors");
const { FederationLifecycle } = await import("../../src/services/federation/lifecycle");
const { LOCAL_CONTAINER_RECOVERY_TIMEOUT_MS } = await import(
  "../../src/services/federation/containers"
);

const CORE_MANIFEST = {
  name: "ui",
  manifestVersion: 2,
  routes: [{ id: "_public", type: "layout", mount: "public", file: "_public.tsx" }],
};

const ROUTER_MODULE = { createRouter: vi.fn(), renderToStream: vi.fn(), getRouteHead: vi.fn() };
const CORE_ROUTE_CONFIG = { routeConfigLoaders: {}, rootMeta: { head: () => ({ meta: [] }) } };

const construct = vi.fn(
  async (input: {
    plugins: ReadonlyArray<{ key: string; mfName?: string }>;
    resolve: (ref: { key: string }) => Promise<{ manifest: unknown }>;
  }) => {
    const sorted = [...input.plugins].sort((a, b) => a.key.localeCompare(b.key));
    const resolved = [];
    for (const ref of sorted) resolved.push(await input.resolve(ref));
    const { digestOf } = await import("everything-dev/ui/manifest");
    return {
      rootRoute: { id: "composed-tree" },
      routeTree: { id: "composed-tree" },
      nav: { items: [] },
      manifests: [],
      digest: await digestOf({
        plugins: sorted.map((p) => ({ key: p.key, mfName: p.mfName ?? p.key })),
        manifests: resolved.map((r) => r.manifest),
      }),
    };
  },
);

const makeConfig = (coreRoot: string, pluginRoot?: string): RuntimeConfig => {
  const config = {
    env: "development",
    account: "linktree.near",
    networkId: "mainnet",
    host: { name: "host", url: "https://linktree.com", source: "remote" },
    ui: {
      name: "ui",
      url: "http://localhost:3003",
      source: "local",
      localPath: coreRoot,
      ssrUrl: "http://127.0.0.1:1/ssr",
    },
  } as unknown as RuntimeConfig;
  if (pluginRoot) {
    config.plugins = {
      auth: {
        name: "auth",
        source: "local",
        localPath: pluginRoot,
        ui: {
          name: "auth-ui",
          source: "local",
          localPath: pluginRoot,
          ssrUrl: "http://127.0.0.1:1/auth-ui-ssr",
        },
      },
    } as never;
  }
  return config;
};

let coreRoot: string;
let pluginRoot: string;
let cache: ReturnType<typeof createUiComposeCacheState>;
const makeLifecycleRuntime = () => ManagedRuntime.make(FederationLifecycle.layer);
let lifecycleRuntime: ReturnType<typeof makeLifecycleRuntime> | undefined;
let disposeFederation: (() => Promise<void>) | undefined;

const compose = (config?: RuntimeConfig) =>
  lifecycleRuntime!.runPromise(composeUi(config ?? makeConfig(coreRoot), cache));
const composeExit = (config?: RuntimeConfig) =>
  lifecycleRuntime!.runPromiseExit(composeUi(config ?? makeConfig(coreRoot), cache));

const notReadyError = (remoteName = "ui") =>
  new FederationError({
    remoteName,
    remoteUrl: "http://127.0.0.1:1/ssr",
    detail: `${remoteName} SSR container never became ready at http://127.0.0.1:1/ssr`,
  });

const writeUiSourceFixture = async (root: string, manifestName: string) => {
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "dist", "ssr"), { recursive: true });
  await writeFile(
    path.join(root, "src", "manifest.gen.json"),
    JSON.stringify({ ...CORE_MANIFEST, name: manifestName }),
  );
  await writeFile(path.join(root, "dist", "ssr", "remoteEntry.server.js"), "");
};

beforeEach(async () => {
  coreRoot = await mkdtemp(path.join(tmpdir(), "ui-compose-recovery-"));
  pluginRoot = await mkdtemp(path.join(tmpdir(), "ui-compose-recovery-plugin-"));
  await writeUiSourceFixture(coreRoot, "ui");
  await writeUiSourceFixture(pluginRoot, "auth");

  cache = createUiComposeCacheState();
  vi.clearAllMocks();

  federationMocks.localUiRemoteEntry.mockImplementation(
    ({ name, localRoot }: { name: string; localRoot: string }) =>
      Effect.try({
        try: () => {
          const containerPath = path.join(localRoot, "dist", "ssr", "remoteEntry.server.js");
          const containerVersion = existsSync(containerPath)
            ? String(statSync(containerPath).mtimeMs)
            : "pending";
          return { name, localPath: localRoot, ssrUrl: "http://127.0.0.1:1/ssr", containerVersion };
        },
        catch: (cause) => new Error(`localUiRemoteEntry stub failed: ${String(cause)}`),
      }),
  );
  federationMocks.waitForLocalContainer.mockImplementation(() => Effect.void);
  federationMocks.loadUiComposeModule.mockImplementation(() =>
    Effect.succeed({ constructTree: construct }),
  );
  federationMocks.loadCoreUiRouteConfig.mockImplementation(() => Effect.succeed(CORE_ROUTE_CONFIG));
  federationMocks.loadUiRouteConfig.mockImplementation(() =>
    Effect.succeed({ routeConfigLoaders: {} }),
  );
  federationMocks.loadRouterModule.mockImplementation(() => Effect.succeed(ROUTER_MODULE));

  lifecycleRuntime = ManagedRuntime.make(FederationLifecycle.layer);
  await lifecycleRuntime.runPromise(FederationLifecycle);
  disposeFederation = () => lifecycleRuntime!.dispose();
});

afterEach(async () => {
  await disposeFederation?.();
  disposeFederation = undefined;
  await rm(coreRoot, { recursive: true, force: true });
  await rm(pluginRoot, { recursive: true, force: true });
});

describe("composeUi container recovery (#940)", () => {
  it("a successful compose primes the last-good generation", async () => {
    const variant = await compose();
    expect(cache.lastGood?.variant).toBe(variant);
    expect(cache.lastGood?.savedAt).toBeGreaterThan(0);
  });

  it("the cold wait uses the full budget; a primed cache waits on the recovery budget", async () => {
    await compose();
    await compose();

    const calls = federationMocks.waitForLocalContainer.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).toBeUndefined();
    expect(calls[1]![2]).toEqual({ timeoutMs: LOCAL_CONTAINER_RECOVERY_TIMEOUT_MS });
  });

  it("a transiently missing container serves the last-good generation loud, without re-composing", async () => {
    const first = await compose();
    expect(construct).toHaveBeenCalledTimes(1);

    federationMocks.waitForLocalContainer.mockImplementation(() => Effect.fail(notReadyError()));
    const second = await compose();

    expect(second).toBe(first);
    expect(construct).toHaveBeenCalledTimes(1);
    expect(federationMocks.loadUiComposeModule).toHaveBeenCalledTimes(1);
  });

  it("without a last-good generation the compose fails loud", async () => {
    federationMocks.waitForLocalContainer.mockImplementation(() => Effect.fail(notReadyError()));

    const result = await composeExit();
    expect(Exit.isFailure(result)).toBe(true);
    expect(construct).not.toHaveBeenCalled();
  });

  it("the next healthy wait composes the new generation after the fallback", async () => {
    const first = await compose();
    federationMocks.waitForLocalContainer.mockImplementation(() => Effect.fail(notReadyError()));
    expect(await compose()).toBe(first);

    federationMocks.waitForLocalContainer.mockImplementation(() => Effect.void);
    await writeFile(
      path.join(coreRoot, "dist", "ssr", "remoteEntry.server.js"),
      "console.log('rebuilt')",
    );
    const third = await compose();

    expect(third).not.toBe(first);
    expect(construct).toHaveBeenCalledTimes(2);
    expect(cache.lastGood?.variant).toBe(third);
  });

  it("a local plugin container's wait failure also falls back to the last-good generation", async () => {
    const config = makeConfig(coreRoot, pluginRoot);
    const first = await compose(config);
    expect(construct).toHaveBeenCalledTimes(1);

    federationMocks.waitForLocalContainer.mockImplementation((entry: { name: string }) =>
      entry.name === "ui" ? Effect.void : Effect.fail(notReadyError(entry.name)),
    );
    const second = await compose(config);

    expect(second).toBe(first);
    expect(construct).toHaveBeenCalledTimes(1);
  });
});
