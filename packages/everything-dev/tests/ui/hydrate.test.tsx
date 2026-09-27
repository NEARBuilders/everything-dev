// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  config: { hostUrl: "https://example.test", rpcBase: "/api" },
  routerLoads: 0,
  createRouter: vi.fn(() => ({ router: {} })),
  render: vi.fn(),
  hydrateRoot: vi.fn(),
  coreRouteConfig: {
    routeConfigLoaders: {},
    rootMeta: { head: () => ({ meta: [{ name: "core", content: "1" }] }) },
  },
}));

vi.mock("../../src/ui/api", () => ({
  createApiClient: vi.fn(),
}));
vi.mock("../../src/ui/auth", () => ({
  createAuthClient: vi.fn(),
}));
vi.mock("../../src/ui/runtime", () => ({
  getCspNonce: () => "test-nonce",
}));
vi.mock("../../src/ui/router-client", () => {
  bootstrap.routerLoads++;
  return {
    createRouter: bootstrap.createRouter,
  };
});
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: bootstrap.render }),
  hydrateRoot: bootstrap.hydrateRoot,
}));

const composeMocks = vi.hoisted(() => ({
  loadRemote: vi.fn(),
  registerRemotes: vi.fn(),
  constructTree: vi.fn(),
}));

vi.mock("@module-federation/enhanced/runtime", () => ({
  loadRemote: composeMocks.loadRemote,
  registerRemotes: composeMocks.registerRemotes,
}));
vi.mock("../../src/ui/manifest", () => ({
  constructTree: composeMocks.constructTree,
  ComposePayloadSchema: { parse: (payload: unknown) => payload },
  CORE_UI_PLUGIN_KEY: "ui",
}));

const CORE_MANIFEST = { name: "ui", manifestVersion: 1, routes: [] };
const AUTH_MANIFEST = {
  name: "auth",
  manifestVersion: 1,
  routes: [{ id: "_public/login", path: "/login" }],
};

function composeConfig() {
  return {
    hostUrl: "https://example.test",
    rpcBase: "/api",
    ui: {
      name: "ui",
      url: "https://cdn.example.com/ui",
      entry: "https://cdn.example.com/ui/remoteEntry.js",
      compose: {
        digest: "digest-1",
        remotes: [
          { key: "auth", name: "auth-ui", entry: "https://cdn.example.com/auth-ui/remoteEntry.js" },
        ],
        manifests: [CORE_MANIFEST, AUTH_MANIFEST],
      },
    },
  };
}

const composedTree = () => ({
  rootRoute: { id: "composed-tree" },
  digest: "digest-1",
  manifests: [CORE_MANIFEST, AUTH_MANIFEST],
  nav: {
    items: [
      { id: "auth:_public/login", label: "Login", to: "/login", plugin: "auth", mount: "public" },
    ],
  },
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  bootstrap.routerLoads = 0;
  bootstrap.config = { hostUrl: "https://example.test", rpcBase: "/api" };
  delete window.__EVERYTHING_DEV_HYDRATE_PROMISE__;
  delete window.__EVERYTHING_DEV_SSR__;
  delete window.__CLIENT_PROGRESS__;
  delete window.$_TSR;
  document.documentElement.removeAttribute("data-everything-ssr");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const loadHydrate = () => import("../../src/ui/hydrate");

const runHydrate = async (config: Record<string, unknown>) => {
  const { hydrate } = await loadHydrate();
  return hydrate({
    config: config as never,
    routeConfig: async () => bootstrap.coreRouteConfig,
  });
};

describe("client bootstrap", () => {
  it("rejects missing config before loading the router and can retry", async () => {
    bootstrap.config.hostUrl = "";
    await expect(runHydrate(bootstrap.config)).rejects.toThrow("Missing hostUrl or rpcBase");
    expect(bootstrap.routerLoads).toBe(0);
    expect(bootstrap.createRouter).not.toHaveBeenCalled();
    expect(window.__EVERYTHING_DEV_HYDRATE_PROMISE__).toBeUndefined();

    bootstrap.config.hostUrl = "https://example.test";
    await runHydrate(bootstrap.config);
    expect(bootstrap.createRouter).toHaveBeenCalledOnce();
    expect(bootstrap.render).toHaveBeenCalledOnce();
  });

  it("shares concurrent bootstrap calls and preserves CSR rendering", async () => {
    await Promise.all([runHydrate(bootstrap.config), runHydrate(bootstrap.config)]);
    expect(bootstrap.createRouter).toHaveBeenCalledOnce();
    expect(bootstrap.render).toHaveBeenCalledOnce();
    expect(bootstrap.hydrateRoot).not.toHaveBeenCalled();
  });

  it("client-renders instead of hydrating when a server-rendered page has no compose payload", async () => {
    document.documentElement.setAttribute("data-everything-ssr", "");
    await runHydrate(bootstrap.config);
    expect(bootstrap.hydrateRoot).not.toHaveBeenCalled();
    expect(bootstrap.render).toHaveBeenCalledOnce();
  });

  it("composes the tree from the payload before createRouter", async () => {
    bootstrap.config = composeConfig();
    composeMocks.loadRemote.mockResolvedValue({ routeConfigLoaders: {} });
    composeMocks.constructTree.mockImplementation(
      async (input: {
        plugins: Array<{ key: string }>;
        resolve: (ref: { key: string }) => unknown;
      }) => {
        for (const ref of input.plugins) await input.resolve(ref);
        return composedTree();
      },
    );

    await runHydrate(bootstrap.config);

    expect(composeMocks.registerRemotes).toHaveBeenCalledWith([
      {
        name: "auth-ui",
        alias: "auth-ui",
        entry: "https://cdn.example.com/auth-ui/mf-manifest.json",
      },
    ]);
    expect(composeMocks.loadRemote).toHaveBeenCalledWith("auth-ui/routeConfig", { from: "build" });

    const constructInput = composeMocks.constructTree.mock.calls[0]![0] as {
      plugins: Array<{ key: string; mfName: string }>;
      rootOptions: unknown;
    };
    expect(constructInput.plugins).toEqual([
      { key: "ui", mfName: "ui" },
      { key: "auth", mfName: "auth-ui" },
    ]);
    expect(constructInput.rootOptions).toBe(bootstrap.coreRouteConfig.rootMeta);

    const resolvedCore = await (
      composeMocks.constructTree.mock.calls[0]![0] as { resolve: (ref: { key: string }) => unknown }
    ).resolve({ key: "ui" });
    expect(resolvedCore).toMatchObject({ key: "ui", routeConfig: bootstrap.coreRouteConfig });

    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTree: { id: "composed-tree" },
        context: expect.objectContaining({ pluginNav: composedTree().nav }),
      }),
    );
  });

  it("falls back to the core-only tree when a plugin route config fails to load", async () => {
    bootstrap.config = composeConfig();
    composeMocks.loadRemote.mockRejectedValue(new Error("remote down"));
    composeMocks.constructTree.mockImplementation(
      async (input: {
        plugins: Array<{ key: string }>;
        resolve: (ref: { key: string }) => unknown;
      }) => {
        for (const ref of input.plugins) await input.resolve(ref);
        return composedTree();
      },
    );

    await runHydrate(bootstrap.config);

    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: undefined }),
    );
  });

  it("falls back to the core-only tree on compose digest mismatch", async () => {
    bootstrap.config = composeConfig();
    composeMocks.loadRemote.mockResolvedValue({ routeConfigLoaders: {} });
    composeMocks.constructTree.mockResolvedValue({ ...composedTree(), digest: "stale-digest" });

    await runHydrate(bootstrap.config);

    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: undefined }),
    );
  });
});
