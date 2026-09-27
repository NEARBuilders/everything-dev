import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Exit } from "effect";
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

const {
  composeUi,
  composeClientPayload,
  resetUiComposeCache,
  resetRemoteManifestCache,
  uiSources,
} = await import("../../src/services/ui-compose");

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

const AUTH_MANIFEST = {
  name: "auth",
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
      source: "remote",
      integrity: "sha384-base",
      ssrUrl: "https://cdn.example.com/base-ui-ssr",
      ssrIntegrity: "sha384-base-ssr",
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
        source: "remote",
        ssrUrl: "https://cdn.example.com/auth-ui-ssr",
        ssrIntegrity: "sha384-a",
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

beforeEach(() => {
  vi.clearAllMocks();
  resetUiComposeCache();
  fetchMock.mockImplementation(cdnAwareFetch);
  vi.stubGlobal("fetch", fetchMock);
  federationMocks.loadUiComposeModule.mockImplementation(() =>
    Effect.succeed({ constructTree: construct }),
  );
  federationMocks.loadCoreUiRouteConfig.mockImplementation(() => Effect.succeed(CORE_ROUTE_CONFIG));
  federationMocks.loadUiRouteConfig.mockImplementation(() => Effect.succeed(AUTH_ROUTE_CONFIG));
  federationMocks.loadRouterModule.mockImplementation(() => Effect.succeed(ROUTER_MODULE));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uiSources", () => {
  it("resolves core plus plugin ui sources, sorted by key, with mfNames from config", () => {
    const sources = uiSources(configWithPlugin());
    expect(sources.map((source) => source.key)).toEqual(["auth", "ui"]);
    expect(sources.map((source) => source.mfName)).toEqual(["auth-ui", "ui"]);
    expect(sources.find((source) => source.key === "auth")?.webEntry).toBe(
      "https://cdn.example.com/auth-ui/remoteEntry.js",
    );
    expect(sources.find((source) => source.key === "ui")?.manifestUrl).toBe(
      "https://cdn.example.com/base-ui/manifest.gen.json",
    );
  });

  it("is empty of plugins when none declare ui", () => {
    expect(uiSources(createBaseRuntimeConfig()).map((source) => source.key)).toEqual(["ui"]);
  });
});

describe("composeUi", () => {
  it("composes core + plugin manifests through the core engine, digest-cached", async () => {
    const config = configWithPlugin();
    const first = await Effect.runPromise(composeUi(config));
    const second = await Effect.runPromise(composeUi(config));

    expect(first.routeTree).toEqual({ id: "composed-tree" });
    expect(first.routerModule).toBe(ROUTER_MODULE);
    expect(second).toBe(first);
    expect(construct).toHaveBeenCalledTimes(1);

    const constructInput = construct.mock.calls[0]![0] as {
      plugins: Array<{ key: string; mfName: string }>;
      rootOptions: unknown;
    };
    expect(constructInput.plugins).toEqual([
      { key: "auth", mfName: "auth-ui" },
      { key: "ui", mfName: "ui" },
    ]);
    expect(constructInput.rootOptions).toBe(CORE_ROUTE_CONFIG.rootMeta);

    const resolvedAuth = await (
      construct.mock.calls[0]![0] as { resolve: (ref: { key: string }) => Promise<unknown> }
    ).resolve({ key: "auth" });
    expect(resolvedAuth).toMatchObject({
      key: "auth",
      manifest: AUTH_MANIFEST,
      routeConfig: AUTH_ROUTE_CONFIG,
    });
  });

  it("manifest content changes invalidate the cached variant", async () => {
    const config = configWithPlugin();
    const first = await Effect.runPromise(composeUi(config));

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

    resetRemoteManifestCache();

    const second = await Effect.runPromise(composeUi(config));
    expect(second.digest).not.toBe(first.digest);
    expect(second).not.toBe(first);
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it("deployment-only changes (integrity bumps) keep the hydration digest but recompose the variant", async () => {
    const config = configWithPlugin();
    const first = await Effect.runPromise(composeUi(config));

    const bumped = structuredClone(config);
    (bumped.plugins!.auth!.ui as { ssrIntegrity: string }).ssrIntegrity = "sha384-rebuilt";
    const second = await Effect.runPromise(composeUi(bumped));

    expect(second.digest).toBe(first.digest);
    expect(second).not.toBe(first);
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it("builds the client payload with plugin web entries and embedded manifests", async () => {
    const variant = await Effect.runPromise(composeUi(configWithPlugin()));

    expect(variant.clientPayload.digest).toBe(variant.digest);
    expect(variant.clientPayload.remotes).toEqual([
      { key: "auth", name: "auth-ui", entry: "https://cdn.example.com/auth-ui/remoteEntry.js" },
    ]);
    expect(variant.clientPayload.manifests).toEqual([AUTH_MANIFEST, CORE_MANIFEST]);
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
      ui: { ...createBaseRuntimeConfig().ui, source: "local", localPath: coreFixture },
    } as RuntimeConfig;
    config.plugins!.auth!.ui!.localPath = authFixture;

    const variant = await Effect.runPromise(composeUi(config));

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
      { key: "auth", name: "auth-ui", entry: "https://cdn.example.com/auth-ui/remoteEntry.js" },
    ]);

    await rm(localRoot, { recursive: true, force: true });
  });

  it("fails loudly when a manifest cannot be fetched", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await Effect.runPromiseExit(composeUi(configWithPlugin()));
    expect(Exit.isFailure(result)).toBe(true);
    expect(construct).not.toHaveBeenCalled();
  });

  it("the client config embeds the compose payload verbatim", async () => {
    const config = configWithPlugin();
    const variant = await Effect.runPromise(composeUi(config));
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
    const variant = await Effect.runPromise(composeUi(config));
    const client = await Effect.runPromise(composeClientPayload(config));

    expect(client).toEqual({ digest: variant.digest, clientPayload: variant.clientPayload });
    expect(client?.clientPayload.remotes).toEqual([
      { key: "auth", name: "auth-ui", entry: "https://cdn.example.com/auth-ui/remoteEntry.js" },
    ]);
    expect(client?.clientPayload.manifests).toEqual([AUTH_MANIFEST, CORE_MANIFEST]);
  });

  it("returns undefined when no plugin declares a ui — the bundled core-only tree is already complete", async () => {
    const client = await Effect.runPromise(composeClientPayload(createBaseRuntimeConfig()));
    expect(client).toBeUndefined();
  });

  it("builds the payload without touching any MF loader or the construction engine", async () => {
    await Effect.runPromise(composeClientPayload(configWithPlugin()));

    expect(federationMocks.loadUiComposeModule).not.toHaveBeenCalled();
    expect(federationMocks.loadCoreUiRouteConfig).not.toHaveBeenCalled();
    expect(federationMocks.loadUiRouteConfig).not.toHaveBeenCalled();
    expect(federationMocks.loadRouterModule).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });

  it("fails when a manifest cannot be fetched (no silent plugin loss)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    resetRemoteManifestCache();
    const result = await Effect.runPromiseExit(composeClientPayload(configWithPlugin()));
    expect(Exit.isFailure(result)).toBe(true);
  });
});
