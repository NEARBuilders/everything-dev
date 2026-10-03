import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRuntimeClientConfig,
  type RuntimeConfig,
  resolveActiveRuntime,
} from "../../src/services/config";

const federationMocks = vi.hoisted(() => ({
  loadUiComposeModule: vi.fn(),
  loadCoreUiRouteConfig: vi.fn(),
  loadUiRouteConfig: vi.fn(),
  loadRouterModule: vi.fn(),
}));

vi.mock("../../src/services/federation.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/federation.server")>();
  return {
    ...actual,
    loadUiComposeModule: (...args: unknown[]) => federationMocks.loadUiComposeModule(...args),
    loadCoreUiRouteConfig: (...args: unknown[]) => federationMocks.loadCoreUiRouteConfig(...args),
    loadUiRouteConfig: (...args: unknown[]) => federationMocks.loadUiRouteConfig(...args),
    loadRouterModule: (...args: unknown[]) => federationMocks.loadRouterModule(...args),
  };
});

const { composeUi, composeClientPayload, createUiComposeCacheState, uiSources } = await import(
  "../../src/services/ui-compose"
);
const { FederationLifecycle } = await import("../../src/services/federation.server");

const CORE_MANIFEST = {
  name: "ui",
  manifestVersion: 1,
  routes: [
    { id: "_public", isLayout: true, mount: "public", file: "_public.tsx" },
    {
      id: "_public/login-target",
      path: "/welcome",
      parentId: "_public",
      file: "_public/welcome.tsx",
    },
    { id: "_authenticated", isLayout: true, mount: "authenticated", file: "_authenticated.tsx" },
  ],
};

// The built manifest's container name derives from the plugin package name —
// never the config label ("auth") the host uses for sources. The payload and
// digest identity must key by this, not the label.
const AUTH_MANIFEST = {
  name: "_everything_dev_auth_plugin",
  manifestVersion: 1,
  routes: [
    { id: "_public/login", path: "/login", file: "_public/login.tsx" },
    {
      id: "_authenticated/settings",
      path: "/settings",
      parentId: "_authenticated",
      file: "_authenticated/settings.tsx",
    },
  ],
};

const ROUTER_MODULE = { createRouter: vi.fn(), renderToStream: vi.fn(), getRouteHead: vi.fn() };
const CORE_ROUTE_CONFIG = { routeConfigLoaders: {}, rootMeta: { head: () => ({ meta: [] }) } };
const AUTH_ROUTE_CONFIG = { routeConfigLoaders: {} };

function createBaseRuntimeConfig(): RuntimeConfig {
  return {
    env: "production",
    account: "linktree.near",
    domain: "linktree.com",
    networkId: "mainnet",
    title: "Linktree",
    description: "",
    host: {
      name: "host",
      url: "https://linktree.com",
      entry: "https://linktree.com/mf-manifest.json",
      source: "remote",
    },
    ui: {
      name: "ui",
      url: "https://cdn.example.com/base-ui",
      entry: "https://cdn.example.com/base-ui/mf-manifest.json",
      entryUrl: "https://cdn.example.com/base-ui/remoteEntry.aaa.js",
      source: "remote",
      integrity: "sha384-base",
      ssrUrl: "https://cdn.example.com/base-ui-ssr",
      ssrIntegrity: "sha384-base-ssr",
      ssrEntryUrl: "https://cdn.example.com/base-ui-ssr/remoteEntry.server.aaa.js",
    },
  } as RuntimeConfig;
}

function configWithPlugin(): RuntimeConfig {
  const config = createBaseRuntimeConfig();
  config.plugins = {
    auth: {
      name: "auth",
      url: "https://cdn.example.com/auth",
      entry: "https://cdn.example.com/auth/mf-manifest.json",
      source: "remote",
      ui: {
        name: "auth-ui",
        url: "https://cdn.example.com/auth-ui",
        entry: "https://cdn.example.com/auth-ui/mf-manifest.json",
        browserManifestUrl: "https://cdn.example.com/auth-ui/mf-manifest.json",
        entryUrl: "https://cdn.example.com/auth-ui/remoteEntry.aaa.js",
        source: "remote",
        ssrUrl: "https://cdn.example.com/auth-ui-ssr",
        ssrIntegrity: "sha384-a",
        ssrEntryUrl: "https://cdn.example.com/auth-ui-ssr/remoteEntry.server.aaa.js",
      },
    } as never,
  };
  return config;
}

const construct = vi.fn(
  async (input: {
    plugins: Array<{ key: string; mfName?: string }>;
    resolve: (ref: { key: string }) => Promise<{ manifest: unknown }>;
    rootOptions?: unknown;
  }) => {
    const resolved = [];
    for (const ref of input.plugins) resolved.push(await input.resolve(ref));
    const { digestOf } = await import("everything-dev/ui/manifest");
    return {
      rootRoute: { id: "composed-tree" },
      routeTree: { id: "composed-tree" },
      nav: { items: [] },
      manifests: [],
      digest: await digestOf({
        plugins: input.plugins.map((p) => ({ key: p.key, mfName: p.mfName ?? p.key })),
        manifests: resolved.map((r) => r.manifest),
      }),
    };
  },
);

const realFetch = globalThis.fetch.bind(globalThis);
const cdnAwareFetch = async (url: unknown) => {
  const target = String(url);
  if (target.startsWith("https://cdn.example.com/base-ui/")) {
    return { ok: true, status: 200, json: async () => CORE_MANIFEST };
  }
  if (target.startsWith("https://cdn.example.com/auth-ui/")) {
    return { ok: true, status: 200, json: async () => AUTH_MANIFEST };
  }
  if (target.startsWith("http://127.0.0.1:") || target.startsWith("http://localhost:")) {
    return realFetch(url as Parameters<typeof realFetch>[0]);
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const fetchMock = vi.fn(cdnAwareFetch);
let cache = createUiComposeCacheState();
let disposeFederation: (() => Promise<void>) | undefined;

const compose = (config: RuntimeConfig) => Effect.runPromise(composeUi(config, cache));
const composeExit = (config: RuntimeConfig) => Effect.runPromiseExit(composeUi(config, cache));
const composeClient = (config: RuntimeConfig) =>
  Effect.runPromise(composeClientPayload(config, cache));

beforeEach(async () => {
  vi.clearAllMocks();
  cache = createUiComposeCacheState();
  const lifecycle = ManagedRuntime.make(FederationLifecycle.layer);
  await lifecycle.runPromise(FederationLifecycle);
  disposeFederation = () => lifecycle.dispose();
  fetchMock.mockImplementation(cdnAwareFetch);
  vi.stubGlobal("fetch", fetchMock);
  federationMocks.loadUiComposeModule.mockImplementation(() =>
    Effect.succeed({ constructTree: construct }),
  );
  federationMocks.loadCoreUiRouteConfig.mockImplementation(() => Effect.succeed(CORE_ROUTE_CONFIG));
  federationMocks.loadUiRouteConfig.mockImplementation(() => Effect.succeed(AUTH_ROUTE_CONFIG));
  federationMocks.loadRouterModule.mockImplementation(() => Effect.succeed(ROUTER_MODULE));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await disposeFederation?.();
  disposeFederation = undefined;
});

describe("uiSources", () => {
  it("resolves core plus plugin ui sources, sorted by key, with mfNames from config", () => {
    const sources = uiSources(configWithPlugin());
    expect(sources.map((source) => source.key)).toEqual(["auth", "ui"]);
    expect(sources.map((source) => source.mfName)).toEqual(["auth-ui", "ui"]);
    expect(sources.find((source) => source.key === "auth")?.webEntry).toBe(
      "https://cdn.example.com/auth-ui/remoteEntry.aaa.js",
    );
    expect(sources.find((source) => source.key === "ui")?.manifestUrl).toBe(
      "https://cdn.example.com/base-ui/manifest.gen.json",
    );
  });

  it("is empty of plugins when none declare ui", () => {
    expect(uiSources(createBaseRuntimeConfig()).map((source) => source.key)).toEqual(["ui"]);
  });

  it("skips plugin ui sources with no production URL", () => {
    const config = configWithPlugin();
    config.plugins!.auth!.ui = {
      name: "auth-ui",
      url: "",
      entry: "",
      source: "remote",
    };
    expect(uiSources(config).map((source) => source.key)).toEqual(["ui"]);
  });
});

describe("composeUi", () => {
  it("composes core + plugin manifests through the core engine, digest-cached", async () => {
    const config = configWithPlugin();
    const first = await compose(config);
    const second = await compose(config);

    expect(first.routeTree).toEqual({ id: "composed-tree" });
    expect(first.routerModule).toBe(ROUTER_MODULE);
    expect(second).toBe(first);
    expect(construct).toHaveBeenCalledTimes(1);

    const constructInput = construct.mock.calls[0]![0] as {
      plugins: Array<{ key: string; mfName: string }>;
      rootOptions: unknown;
    };
    expect(constructInput.plugins).toEqual([
      { key: "_everything_dev_auth_plugin", mfName: "auth-ui" },
      { key: "ui", mfName: "ui" },
    ]);
    expect(constructInput.rootOptions).toBe(CORE_ROUTE_CONFIG.rootMeta);

    const resolvedAuth = await (
      construct.mock.calls[0]![0] as { resolve: (ref: { key: string }) => Promise<unknown> }
    ).resolve({ key: "_everything_dev_auth_plugin" });
    expect(resolvedAuth).toMatchObject({
      key: "_everything_dev_auth_plugin",
      manifest: AUTH_MANIFEST,
      routeConfig: AUTH_ROUTE_CONFIG,
    });
  });

  it("manifest content changes invalidate the cached variant", async () => {
    const config = configWithPlugin();
    const first = await compose(config);

    const changed = {
      ...AUTH_MANIFEST,
      routes: [...AUTH_MANIFEST.routes, { id: "_public/signup", path: "/signup" }],
    };
    fetchMock.mockImplementation(async (url: unknown) => {
      const target = String(url);
      if (target.startsWith("https://cdn.example.com/auth-ui/")) {
        return { ok: true, status: 200, json: async () => changed };
      }
      return { ok: true, status: 200, json: async () => CORE_MANIFEST };
    });

    cache.remoteManifests.clear();

    const second = await compose(config);
    expect(second.digest).not.toBe(first.digest);
    expect(second).not.toBe(first);
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it("deployment-only changes (integrity bumps) keep the hydration digest but recompose the variant", async () => {
    const config = configWithPlugin();
    const first = await compose(config);

    const bumped = structuredClone(config);
    (bumped.plugins!.auth!.ui as { ssrIntegrity: string }).ssrIntegrity = "sha384-rebuilt";
    const second = await compose(bumped);

    expect(second.digest).toBe(first.digest);
    expect(second).not.toBe(first);
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it("builds the client payload with plugin web entries and embedded manifests", async () => {
    const variant = await compose(configWithPlugin());

    expect(variant.clientPayload.digest).toBe(variant.digest);
    expect(variant.clientPayload.remotes).toEqual([
      {
        key: "_everything_dev_auth_plugin",
        name: "auth-ui",
        entry: "https://cdn.example.com/auth-ui/remoteEntry.aaa.js",
        manifestUrl: "https://cdn.example.com/auth-ui/mf-manifest.json",
      },
    ]);
    expect(variant.clientPayload.manifests).toEqual([AUTH_MANIFEST, CORE_MANIFEST]);
  });

  it("local plugin ui slots carry no manifestUrl — a relative entry resolves against the page origin and registers the wrong container", async () => {
    const config = configWithPlugin();
    // a local plugin ui slot only exists in development (dev targets resolve
    // only there) — and the fixed-name fallback is the dev contract
    config.env = "development";
    config.plugins!.auth!.ui = {
      name: "auth-ui",
      url: "http://localhost:4111",
      entry: "/mf-manifest.json",
      source: "local",
      ssrUrl: "http://localhost:4111/ssr",
    } as never;

    fetchMock.mockImplementation(async (url: unknown) => {
      const target = String(url);
      if (target === "http://localhost:4111/manifest.gen.json") {
        return { ok: true, status: 200, json: async () => AUTH_MANIFEST };
      }
      return { ok: true, status: 200, json: async () => CORE_MANIFEST };
    });
    cache.remoteManifests.clear();

    const client = await composeClient(config);

    expect(client?.clientPayload.remotes).toEqual([
      {
        key: "_everything_dev_auth_plugin",
        name: "auth-ui",
        entry: "http://localhost:4111/remoteEntry.js",
      },
    ]);
  });

  it("local dev composes through the same MF loaders via the local dist container", async () => {
    const localRoot = await mkdtemp(path.join(tmpdir(), "ui-compose-local-"));
    const fixture = async (name: string, manifestName: string) => {
      const root = path.join(localRoot, name);
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(path.join(root, "dist", "ssr"), { recursive: true });
      await writeFile(
        path.join(root, "src", "manifest.gen.json"),
        JSON.stringify({
          name: manifestName,
          manifestVersion: 1,
          routes: [{ id: "_public", isLayout: true, mount: "public", file: "_public.tsx" }],
        }),
      );
      await writeFile(path.join(root, "dist", "ssr", "remoteEntry.server.js"), "");
      return root;
    };
    const coreFixture = await fixture("core-ui", "ui");
    const authFixture = await fixture("auth-ui", "auth-ui");

    const config = {
      ...configWithPlugin(),
      env: "development",
      ui: { ...createBaseRuntimeConfig().ui, source: "local", localPath: coreFixture },
    } as RuntimeConfig;
    config.plugins!.auth!.ui!.localPath = authFixture;

    const variant = await compose(config);

    expect(federationMocks.loadUiComposeModule).toHaveBeenCalledTimes(1);
    expect(federationMocks.loadCoreUiRouteConfig).toHaveBeenCalledTimes(1);
    expect(federationMocks.loadRouterModule).toHaveBeenCalledTimes(1);
    expect(federationMocks.loadUiRouteConfig).toHaveBeenCalledTimes(1);

    const composeEntry = federationMocks.loadUiComposeModule.mock.calls[0]![0] as {
      ssrUrl?: string;
      containerVersion?: string;
      localPath?: string;
    };
    expect(composeEntry.ssrUrl).toContain("/ssr");
    expect(composeEntry.containerVersion).toBeDefined();
    expect(composeEntry.localPath).toContain("ui");

    expect(variant.routerModule).toBe(ROUTER_MODULE);
    expect(variant.clientPayload.remotes).toEqual([
      {
        key: "auth-ui",
        name: "auth-ui",
        entry: "https://cdn.example.com/auth-ui/remoteEntry.aaa.js",
      },
    ]);

    await rm(localRoot, { recursive: true, force: true });
  });

  it("fails loudly when a manifest cannot be fetched", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await composeExit(configWithPlugin());
    expect(Exit.isFailure(result)).toBe(true);
    expect(construct).not.toHaveBeenCalled();
  });

  it("the client config embeds the compose payload verbatim", async () => {
    const config = configWithPlugin();
    const variant = await compose(config);
    const request = new Request("https://linktree.com/");
    const clientConfig = buildRuntimeClientConfig(
      config,
      request,
      resolveActiveRuntime(config, request),
      false,
      variant.clientPayload,
    );
    expect(clientConfig.ui?.compose).toEqual(variant.clientPayload);
  });
});

describe("composeClientPayload", () => {
  it("mirrors the SSR variant's client payload and digest exactly", async () => {
    const config = configWithPlugin();
    const variant = await compose(config);
    const client = await composeClient(config);

    expect(client).toEqual({ digest: variant.digest, clientPayload: variant.clientPayload });
    expect(client?.clientPayload.remotes).toEqual([
      {
        key: "_everything_dev_auth_plugin",
        name: "auth-ui",
        entry: "https://cdn.example.com/auth-ui/remoteEntry.aaa.js",
        manifestUrl: "https://cdn.example.com/auth-ui/mf-manifest.json",
      },
    ]);
    expect(client?.clientPayload.manifests).toEqual([AUTH_MANIFEST, CORE_MANIFEST]);
  });

  it("returns undefined when no plugin declares a ui — the bundled core-only tree is already complete", async () => {
    const client = await composeClient(createBaseRuntimeConfig());
    expect(client).toBeUndefined();
  });

  it("builds the payload without touching any MF loader or the construction engine", async () => {
    await composeClient(configWithPlugin());

    expect(federationMocks.loadUiComposeModule).not.toHaveBeenCalled();
    expect(federationMocks.loadCoreUiRouteConfig).not.toHaveBeenCalled();
    expect(federationMocks.loadUiRouteConfig).not.toHaveBeenCalled();
    expect(federationMocks.loadRouterModule).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });

  it("fails when a manifest cannot be fetched (no silent plugin loss)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    cache.remoteManifests.clear();
    const result = await Effect.runPromiseExit(composeClientPayload(configWithPlugin(), cache));
    expect(Exit.isFailure(result)).toBe(true);
  });
});
