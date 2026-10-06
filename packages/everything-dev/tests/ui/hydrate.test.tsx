// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  config: { hostUrl: "https://example.test", rpcBase: "/api" },
  routerLoads: 0,
  createRouter: vi.fn(() => ({ router: {} })),
  render: vi.fn(),
  hydrateRoot: vi.fn(),
  toastError: vi.fn(),
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

vi.mock("sonner", () => ({ toast: { error: bootstrap.toastError } }));

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
  parsePluginManifest: (raw: unknown) => raw,
  ComposePayloadSchema: {
    safeParse: (payload: unknown) =>
      payload && Array.isArray((payload as { remotes?: unknown }).remotes)
        ? { success: true, data: payload }
        : { success: false, error: { message: "malformed compose payload" } },
  },
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
  it("forwards the SSR document language into the composed router context", async () => {
    const previousLocale = document.documentElement.lang;
    document.documentElement.lang = "fr";
    document.documentElement.setAttribute("data-everything-ssr", "");
    try {
      await runHydrate(bootstrap.config);
      expect(bootstrap.createRouter).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ locale: "fr" }),
        }),
      );
    } finally {
      document.documentElement.lang = previousLocale;
    }
  });

  it("rejects missing config before loading the router and can retry", async () => {
    bootstrap.config.hostUrl = "";
    await expect(runHydrate(bootstrap.config)).rejects.toThrow("Missing hostUrl or rpcBase");
    expect(bootstrap.routerLoads).toBe(0);
    expect(bootstrap.createRouter).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-testid="application-startup-error"]')?.textContent,
    ).toContain("Reload");
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

  it("constructs the core-only tree when there is no compose payload", async () => {
    composeMocks.constructTree.mockResolvedValue({
      ...composedTree(),
      manifests: [CORE_MANIFEST],
      nav: { items: [] },
    });

    const { hydrate } = await loadHydrate();
    await hydrate({
      config: bootstrap.config as never,
      routeConfig: async () => bootstrap.coreRouteConfig,
      manifest: async () => CORE_MANIFEST,
    });

    // A plugin-free deployment carries no compose payload at all — the
    // core-only tree IS the tree, built from the app's own manifest and
    // route config. The router must never receive `undefined`.
    expect(composeMocks.constructTree).toHaveBeenCalledOnce();
    const input = composeMocks.constructTree.mock.calls[0]![0] as {
      name: string;
      plugins: Array<{ key: string; mfName: string }>;
      resolve: (ref: { key: string }) => unknown;
      rootOptions: unknown;
    };
    expect(input.name).toBe("core-fallback");
    expect(input.plugins).toEqual([{ key: "ui", mfName: "ui" }]);
    expect(input.rootOptions).toBe(bootstrap.coreRouteConfig.rootMeta);
    expect(await input.resolve({ key: "ui" })).toMatchObject({
      key: "ui",
      manifest: CORE_MANIFEST,
      routeConfig: bootstrap.coreRouteConfig,
    });
    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: { id: "composed-tree" } }),
    );
  });

  it("falls back to the core-only tree when the compose payload is malformed", async () => {
    document.documentElement.setAttribute("data-everything-ssr", "");
    composeMocks.constructTree.mockResolvedValue({
      ...composedTree(),
      manifests: [CORE_MANIFEST],
      nav: { items: [] },
    });
    bootstrap.config = {
      ...bootstrap.config,
      ui: { name: "ui", compose: { digest: "digest-1", remotes: "not-an-array" } },
    };

    const { hydrate } = await loadHydrate();
    await hydrate({
      config: bootstrap.config as never,
      routeConfig: async () => bootstrap.coreRouteConfig,
      manifest: async () => CORE_MANIFEST,
    });

    expect(composeMocks.constructTree).toHaveBeenCalledOnce();
    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: { id: "composed-tree" } }),
    );
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

  it("mints the router and query client through the app's factories", async () => {
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

    const appQueryClient = { tag: "app-client" };
    const appFactory = vi.fn(() => ({
      router: { tag: "app-router" },
      queryClient: appQueryClient,
    }));
    const createQueryClient = vi.fn(() => appQueryClient);

    const { hydrate } = await loadHydrate();
    await hydrate({
      config: bootstrap.config as never,
      routeConfig: async () => bootstrap.coreRouteConfig,
      createRouter: appFactory as never,
      createQueryClient: createQueryClient as never,
    });

    expect(createQueryClient).toHaveBeenCalledOnce();
    expect(appFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTree: { id: "composed-tree" },
        context: expect.objectContaining({
          queryClient: appQueryClient,
          pluginNav: composedTree().nav,
        }),
      }),
    );
    expect(bootstrap.createRouter).not.toHaveBeenCalled();
    expect(bootstrap.render).toHaveBeenCalledOnce();
  });

  it("drops the failed remote and composes the core-only subset (degraded, client-render)", async () => {
    document.documentElement.setAttribute("data-everything-ssr", "");
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

    // Per-source isolation: the broken remote drops ONLY its own routes —
    // one construction over the core-only subset, never a second fallback.
    expect(composeMocks.constructTree).toHaveBeenCalledTimes(1);
    const input = composeMocks.constructTree.mock.calls[0]![0] as {
      name: string;
      plugins: Array<{ key: string; mfName: string }>;
    };
    expect(input.name).toBe("client");
    expect(input.plugins).toEqual([{ key: "ui", mfName: "ui" }]);
    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: { id: "composed-tree" } }),
    );
    // The SSR'd tree included the dropped remote — hydration is unsafe, so
    // the page client-renders the degraded tree.
    expect(bootstrap.hydrateRoot).not.toHaveBeenCalled();
    expect(bootstrap.render).toHaveBeenCalledOnce();
    expect(bootstrap.toastError).toHaveBeenCalledWith(
      "Some application features couldn't load",
      expect.objectContaining({
        duration: Number.POSITIVE_INFINITY,
        action: expect.objectContaining({ label: "Reload" }),
      }),
    );
  });

  it("drops only the failed remote and composes the healthy subset", async () => {
    document.documentElement.setAttribute("data-everything-ssr", "");
    const IDEAS_MANIFEST = {
      name: "ideas",
      manifestVersion: 2,
      routes: [{ id: "_public/ideas", path: "/ideas" }],
    };
    bootstrap.config = {
      ...composeConfig(),
      ui: {
        ...composeConfig().ui,
        compose: {
          digest: "digest-1",
          remotes: [
            {
              key: "auth",
              name: "auth-ui",
              entry: "https://cdn.example.com/auth-ui/remoteEntry.js",
            },
            {
              key: "ideas",
              name: "ideas-ui",
              entry: "https://cdn.example.com/ideas-ui/remoteEntry.js",
            },
          ],
          manifests: [CORE_MANIFEST, AUTH_MANIFEST, IDEAS_MANIFEST],
        },
      },
    } as never;
    composeMocks.loadRemote.mockImplementation(async (name: unknown) => {
      if (String(name).startsWith("ideas-ui/")) throw new Error("remote down");
      return { routeConfigLoaders: {} };
    });
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

    // the healthy remote composes; the broken one drops
    expect(composeMocks.constructTree).toHaveBeenCalledOnce();
    const input = composeMocks.constructTree.mock.calls[0]![0] as {
      plugins: Array<{ key: string; mfName: string }>;
    };
    expect(input.plugins).toEqual([
      { key: "ui", mfName: "ui" },
      { key: "auth", mfName: "auth-ui" },
    ]);
    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: { id: "composed-tree" } }),
    );
    // degraded (the SSR'd tree included the dropped remote) → client-render
    expect(bootstrap.hydrateRoot).not.toHaveBeenCalled();
    expect(bootstrap.render).toHaveBeenCalledOnce();
  });

  it("falls back to the core-only tree on compose digest mismatch", async () => {
    bootstrap.config = composeConfig();
    composeMocks.loadRemote.mockResolvedValue({ routeConfigLoaders: {} });
    composeMocks.constructTree
      .mockResolvedValueOnce({ ...composedTree(), digest: "stale-digest" })
      .mockResolvedValueOnce(composedTree());

    await runHydrate(bootstrap.config);

    expect(composeMocks.constructTree).toHaveBeenCalledTimes(2);
    const fallbackInput = composeMocks.constructTree.mock.calls[1]![0] as {
      plugins: Array<{ key: string; mfName: string }>;
    };
    expect(fallbackInput.plugins).toEqual([{ key: "ui", mfName: "ui" }]);
    expect(bootstrap.createRouter).toHaveBeenCalledWith(
      expect.objectContaining({ routeTree: { id: "composed-tree" } }),
    );
    expect(bootstrap.hydrateRoot).not.toHaveBeenCalled();
    expect(bootstrap.render).toHaveBeenCalledOnce();
    expect(bootstrap.toastError).toHaveBeenCalledOnce();
  });
});
