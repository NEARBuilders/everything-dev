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

const {
  loadCoreUiRouteConfig,
  loadRouterModule,
  loadUiComposeModule,
  loadUiRouteConfig,
  FederationLoader,
} = await import("../../src/services/federation/loader");

const { FederationLifecycle } = await import("../../src/services/federation/lifecycle");

import type { CompositionSession } from "../../src/services/federation/instance";
import type { FederationLoader as FederationLoaderTag } from "../../src/services/federation/loader";

let lifecycle: ManagedRuntime.ManagedRuntime<FederationLoaderTag, never> | undefined;
let disposeLifecycle: (() => Promise<void>) | undefined;

async function startFederationLifecycle() {
  const runtime = ManagedRuntime.make(FederationLifecycle.layer);
  await runtime.runPromise(FederationLifecycle);
  lifecycle = runtime as unknown as ManagedRuntime.ManagedRuntime<FederationLoaderTag, never>;
  disposeLifecycle = () => runtime.dispose();
}

const runLoaded = <A, E>(effect: Effect.Effect<A, E, FederationLoaderTag>): Promise<A> => {
  if (!lifecycle) throw new Error("federation lifecycle not started");
  return (lifecycle as ManagedRuntime.ManagedRuntime<FederationLoaderTag, never>).runPromise(
    effect as Effect.Effect<A, E, never>,
  );
};

/** Open a composition session for the "ui" remote at one entry URL — the
 * load-API entry point the compose flow uses. */
const openSession = async (entryUrl: string): Promise<CompositionSession> => {
  if (!lifecycle) throw new Error("federation lifecycle not started");
  const loader = await lifecycle.runPromise(FederationLoader);
  return loader.ensureSession([{ name: "ui", entry: entryUrl }]);
};

/** A session that never touches the MF instance — for loads that must fail
 * before any session use (missing SSR entry URL). */
const deadSession: CompositionSession = { mf: null as never, generation: 0 };

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

    const firstSession = await openSession(
      "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
    );
    const first = await runLoaded(
      loadRouterModule(
        createRuntimeConfig({
          ssrIntegrity: "sha384-ssr-a",
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
        undefined,
        firstSession,
      ),
    );
    // A changed entry retires the generation — a fresh instance carries the
    // new coordinates; the old generation's cached module can never serve.
    const secondSession = await openSession(
      "https://cdn.example.com/ui-ssr/remoteEntry.server.bbb.js",
    );
    const second = await runLoaded(
      loadRouterModule(
        createRuntimeConfig({
          ssrIntegrity: "sha384-ssr-b",
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.bbb.js",
        }),
        undefined,
        secondSession,
      ),
    );

    expect(first).toBe(routerOne.default);
    expect(second).toBe(routerTwo.default);
    expect(createInstanceMock).toHaveBeenCalledTimes(2);
    const secondInstance = createInstanceMock.mock.calls[1]?.[0] as
      | { remotes?: Array<{ entry?: string }> }
      | undefined;
    expect(secondInstance?.remotes?.[0]?.entry).toBe(
      "https://cdn.example.com/ui-ssr/remoteEntry.server.bbb.js",
    );
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
    const session = await openSession("https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js");
    const first = await runLoaded(loadRouterModule(config, undefined, session));
    const second = await runLoaded(
      loadRouterModule(
        createRuntimeConfig({
          ssrIntegrity: "sha384-ssr-a",
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
        undefined,
        session,
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
    await expect(runLoaded(loadRouterModule(localConfig, undefined, deadSession))).rejects.toThrow(
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

    const session = await openSession("https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js");
    const first = await runLoaded(
      loadRouterModule(
        createRuntimeConfig({
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
        undefined,
        session,
      ),
    );
    const second = await runLoaded(
      loadRouterModule(
        createRuntimeConfig({
          ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
        }),
        undefined,
        session,
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
    const session = await openSession("https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js");
    await runLoaded(loadRouterModule(config, undefined, session));
    await runLoaded(loadRouterModule({ ...config }, undefined, session));
    await runLoaded(
      loadRouterModule(
        { ...config, account: "other.near" } as unknown as RuntimeConfig,
        undefined,
        session,
      ),
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
    const session = await openSession("https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js");

    await expect(runLoaded(loadRouterModule(config, undefined, session))).rejects.toThrow();

    const callsAfterFirstFailure = loadRemoteMock.mock.calls.length;
    expect(callsAfterFirstFailure).toBeGreaterThan(0);

    await expect(runLoaded(loadRouterModule(config, undefined, session))).rejects.toThrow();

    expect(loadRemoteMock.mock.calls.length).toBe(callsAfterFirstFailure);
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
  });

  it("re-verifies SSR integrity after a failed verification — the cache entry is evicted, not poisoned", async () => {
    const router = {
      default: { renderToStream: vi.fn(), getRouteHead: vi.fn(), createRouter: vi.fn() },
    };
    loadRemoteMock.mockResolvedValue(router);

    const config = createRuntimeConfig({
      ssrIntegrity: "sha384-ssr-a",
      ssrEntryUrl: "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
    });
    const session = await openSession("https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js");

    verifySriForUrlMock.mockRejectedValueOnce(new Error("integrity mismatch"));
    await expect(runLoaded(loadRouterModule(config, undefined, session))).rejects.toThrow(
      /integrity mismatch/,
    );
    expect(loadRemoteMock).not.toHaveBeenCalled();

    verifySriForUrlMock.mockResolvedValue(undefined);
    const second = await runLoaded(loadRouterModule(config, undefined, session));

    expect(second).toBe(router.default);
    expect(verifySriForUrlMock).toHaveBeenCalledTimes(2);
    expect(verifySriForUrlMock).toHaveBeenNthCalledWith(
      2,
      "https://cdn.example.com/ui-ssr/remoteEntry.server.aaa.js",
      "sha384-ssr-a",
      { resolveEntryUrl: false },
    );
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

    const session = await openSession("http://localhost:4113/remoteEntry.server.js");
    const loaded = await runLoaded(
      loadUiRouteConfig(uiEntry({ ssrUrl: "http://localhost:4113" }), "development", session),
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

    const session = await openSession("http://localhost:4113/remoteEntry.server.js");
    const loaded = await runLoaded(
      loadUiComposeModule(uiEntry({ ssrUrl: "http://localhost:4113" }), "development", session),
    );

    expect(loaded).toBe(composeModule);
    expect(loadRemoteMock).toHaveBeenCalledWith("auth-ui/compose", { from: "build" });
  });

  it("rejects a ui surface without an SSR entry URL with an actionable error", async () => {
    await expect(
      runLoaded(
        loadUiRouteConfig(uiEntry({ localPath: "/x/plugins/y" }), "development", deadSession),
      ),
    ).rejects.toThrow(/no SSR entry URL/);
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it("rejects a routeConfig expose that is missing routeConfigLoaders, for plugin and core ui", async () => {
    loadRemoteMock.mockResolvedValue({ meta: true });
    const entry = uiEntry({ ssrUrl: "http://localhost:4113" });
    const session = await openSession("http://localhost:4113/remoteEntry.server.js");

    await expect(runLoaded(loadUiRouteConfig(entry, "development", session))).rejects.toThrow(
      /routeConfigLoaders/,
    );
    await expect(runLoaded(loadCoreUiRouteConfig(entry, "development", session))).rejects.toThrow(
      /routeConfigLoaders/,
    );
  });
});

describe("waitForLocalContainer", () => {
  it("polls a pending local container until it appears, then succeeds", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const nodePath = await import("node:path");
    const { FederationContainers, waitForLocalContainer } = await import(
      "../../src/services/federation/containers"
    );

    const localRoot = await mkdtemp(nodePath.join(tmpdir(), "wait-container-"));
    try {
      await mkdir(nodePath.join(localRoot, "dist", "ssr"), { recursive: true });
      const runtime = ManagedRuntime.make(FederationContainers.layer);
      const containers = await runtime.runPromise(FederationContainers);
      const slot = await runtime.runPromise(
        containers.localUiRemoteEntry({ name: "ui", localRoot }),
      );
      expect(slot.containerVersion).toBe("pending");

      // the container "compiles" 700ms in — past two poll intervals
      const timer = setTimeout(() => {
        void writeFile(
          nodePath.join(localRoot, "dist", "ssr", "remoteEntry.server.js"),
          "export {};",
        );
      }, 700);
      timer.unref?.();

      const exit = await Effect.runPromise(waitForLocalContainer(slot, "development"));
      expect(exit).toBeUndefined();
      await runtime.dispose();
    } finally {
      await rm(localRoot, { recursive: true, force: true });
    }
  });

  it("fails with an actionable error when the slot has no SSR entry URL", async () => {
    const { waitForLocalContainer } = await import("../../src/services/federation/containers");
    await expect(
      Effect.runPromise(
        waitForLocalContainer(
          { name: "ui", url: "https://cdn.example.com/ui", ssrUrl: "" },
          "development",
        ),
      ),
    ).rejects.toThrow(/no entry URL/);
  });
});
