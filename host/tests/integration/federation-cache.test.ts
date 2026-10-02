import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../src/services/config";

const loadRemoteMock = vi.fn();
const initializeSharingMock = vi.fn(async () => []);
const registerRemotesMock = vi.fn();
const createInstanceMock = vi.fn((options?: { name?: string; remotes?: unknown[] }) => ({
  loadRemote: loadRemoteMock,
  initializeSharing: initializeSharingMock,
  registerRemotes: registerRemotesMock,
  moduleCache: new Map(),
  options: { name: options?.name ?? "host-ssr-compose", remotes: options?.remotes ?? [] },
}));
const verifySriForUrlMock = vi.fn();

vi.mock("@module-federation/enhanced/runtime", () => ({
  createInstance: createInstanceMock,
}));

vi.mock("everything-dev/integrity", () => ({
  verifySriForUrl: verifySriForUrlMock,
}));

const { FederationLifecycle, loadRouterModule, loadUiComposeModule, loadUiRouteConfig } =
  await import("../../src/services/federation.server");

let disposeLifecycle: (() => Promise<void>) | undefined;

async function startFederationLifecycle() {
  const runtime = ManagedRuntime.make(FederationLifecycle.layer);
  await runtime.runPromise(FederationLifecycle);
  disposeLifecycle = () => runtime.dispose();
}

afterEach(async () => {
  await disposeLifecycle?.();
  disposeLifecycle = undefined;
});

function createRuntimeConfig(options?: {
  source?: "local" | "remote";
  ssrIntegrity?: string;
  ssrEntryUrl?: string;
}): RuntimeConfig {
  return {
    env: "production",
    account: "linktree.near",
    networkId: "mainnet",
    host: {
      name: "host",
      url: "https://linktree.com",
      entry: "https://linktree.com/mf-manifest.json",
      source: "remote",
    },
    ui: {
      name: "ui",
      url: "https://cdn.example.com/ui",
      entry: "https://cdn.example.com/ui/mf-manifest.json",
      source: options?.source ?? "remote",
      integrity: "sha384-ui",
      ssrUrl: "https://cdn.example.com/ui-ssr",
      ssrIntegrity: options?.ssrIntegrity,
      ssrEntryUrl: options?.ssrEntryUrl,
    },
    api: {
      name: "api",
      url: "https://api.example.com",
      entry: "https://api.example.com/mf-manifest.json",
      source: "remote",
    },
  } as RuntimeConfig;
}

describe("loadRouterModule cache", () => {
  beforeEach(async () => {
    await startFederationLifecycle();
    vi.clearAllMocks();
    verifySriForUrlMock.mockResolvedValue(undefined);
  });

  it("reloads the router module when the deployed SSR coordinates change", async () => {
    const routerOne = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    const routerTwo = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    loadRemoteMock.mockResolvedValueOnce(routerOne).mockResolvedValueOnce(routerTwo);

    const first = await Effect.runPromise(
      loadRouterModule(
        createRuntimeConfig({
          ssrIntegrity: "sha384-ssr-a",
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
      ),
    );
    const second = await Effect.runPromise(
      loadRouterModule(
        createRuntimeConfig({
          ssrIntegrity: "sha384-ssr-b",
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.bbb.js",
        }),
      ),
    );

    expect(first).toBe(routerOne.default);
    expect(second).toBe(routerTwo.default);
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    expect(registerRemotesMock).toHaveBeenCalledWith([
      {
        name: "ui",
        entry: "https://cdn.example.com/ui-ssr/remoteEntry.server.bbb.js",
        alias: "ui",
      },
    ]);
    expect(verifySriForUrlMock).toHaveBeenNthCalledWith(
      1,
      "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
      "sha384-ssr-a",
      { resolveEntryUrl: false },
    );
    expect(verifySriForUrlMock).toHaveBeenNthCalledWith(
      2,
      "https://cdn.example.com/ui-ssr/remoteEntry.server.bbb.js",
      "sha384-ssr-b",
      { resolveEntryUrl: false },
    );
  });

  it("reuses the router module when remote SSR integrity stays the same", async () => {
    const router = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    loadRemoteMock.mockResolvedValue(router);

    const config = createRuntimeConfig({
      ssrIntegrity: "sha384-ssr-a",
      ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
    });
    const first = await Effect.runPromise(loadRouterModule(config));
    const second = await Effect.runPromise(
      loadRouterModule(
        createRuntimeConfig({
          ssrIntegrity: "sha384-ssr-a",
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
      ),
    );

    expect(first).toBe(router.default);
    expect(second).toBe(router.default);
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    expect(verifySriForUrlMock).toHaveBeenCalledTimes(1);
  });

  it("fails loudly for local ui without an SSR entry — source composition owns that path", async () => {
    const localConfig = createRuntimeConfig({ source: "local" });
    (localConfig.ui as { ssrUrl?: string }).ssrUrl = undefined;
    await expect(Effect.runPromise(loadRouterModule(localConfig))).rejects.toThrow(
      /no SSR entry URL/,
    );
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it("bypasses the router module cache for remote ui without SSR integrity", async () => {
    const routerOne = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    const routerTwo = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    loadRemoteMock.mockResolvedValueOnce(routerOne).mockResolvedValueOnce(routerTwo);

    const first = await Effect.runPromise(
      loadRouterModule(
        createRuntimeConfig({
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
      ),
    );
    const second = await Effect.runPromise(
      loadRouterModule(
        createRuntimeConfig({
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
      ),
    );

    expect(first).toBe(routerOne.default);
    expect(second).toBe(routerTwo.default);
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    expect(loadRemoteMock).toHaveBeenCalledTimes(2);
    expect(verifySriForUrlMock).not.toHaveBeenCalled();
  });

  it("reuses the MF instance across cached reloads of the same remote", async () => {
    const router = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    loadRemoteMock.mockResolvedValue(router);

    const config = createRuntimeConfig({
      ssrIntegrity: "sha384-ssr-a",
      ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
    });
    await Effect.runPromise(loadRouterModule(config));
    await Effect.runPromise(loadRouterModule({ ...config }));
    await Effect.runPromise(
      loadRouterModule({ ...config, account: "other.near" } as unknown as RuntimeConfig),
    );

    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    const instanceOptions = createInstanceMock.mock.calls[0]?.[0] as { name: string } | undefined;
    expect(instanceOptions?.name).toMatch(/^host-/);
  });

  it("keeps the failing promise cached so a downed remote is probed once per window", async () => {
    loadRemoteMock.mockRejectedValue(new Error("remote down"));

    const config = createRuntimeConfig({
      ssrIntegrity: "sha384-ssr-a",
      ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
    });

    await expect(Effect.runPromise(loadRouterModule(config))).rejects.toThrow();

    const callsAfterFirstFailure = loadRemoteMock.mock.calls.length;
    expect(callsAfterFirstFailure).toBeGreaterThan(0);

    await expect(Effect.runPromise(loadRouterModule(config))).rejects.toThrow();

    expect(loadRemoteMock.mock.calls.length).toBe(callsAfterFirstFailure);
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
  });
});

describe("ui expose loads (routeConfig / compose)", () => {
  beforeEach(async () => {
    await startFederationLifecycle();
    vi.clearAllMocks();
    verifySriForUrlMock.mockResolvedValue(undefined);
  });

  function uiEntry(options?: { ssrUrl?: string; localPath?: string }) {
    return {
      name: "auth-ui",
      ssrUrl: options?.ssrUrl,
      ssrIntegrity: undefined,
      localPath: options?.localPath,
    };
  }

  it("loads a routeConfig through the ui's HTTP SSR entry URL, same shape as production", async () => {
    const routeConfig = { routeConfigLoaders: {} };
    loadRemoteMock.mockResolvedValue(routeConfig);

    const loaded = await Effect.runPromise(
      loadUiRouteConfig(uiEntry({ ssrUrl: "http://localhost:4113" }), "development"),
    );

    expect(loaded).toBe(routeConfig);
    expect(loadRemoteMock).toHaveBeenCalledWith("auth-ui/routeConfig", { from: "build" });
    const instanceOptions = createInstanceMock.mock.calls[0]?.[0] as
      | { remotes?: Array<{ entry?: string }> }
      | undefined;
    expect(instanceOptions?.remotes?.[0]?.entry).toBe(
      "http://localhost:4113/remoteEntry.server.js",
    );
    expect(verifySriForUrlMock).not.toHaveBeenCalled();
  });

  it("loads the core compose module without default-unwrap (named constructTree)", async () => {
    const composeModule = { constructTree: vi.fn() };
    loadRemoteMock.mockResolvedValue(composeModule);

    const loaded = await Effect.runPromise(
      loadUiComposeModule(uiEntry({ ssrUrl: "http://localhost:4113" }), "development"),
    );

    expect(loaded).toBe(composeModule);
    expect(loadRemoteMock).toHaveBeenCalledWith("auth-ui/compose", { from: "build" });
  });

  it("rejects a ui surface without an SSR entry URL with an actionable error", async () => {
    await expect(
      Effect.runPromise(loadUiRouteConfig(uiEntry({ localPath: "/x/plugins/y" }), "development")),
    ).rejects.toThrow(/no SSR entry URL/);
    expect(createInstanceMock).not.toHaveBeenCalled();
  });
});
