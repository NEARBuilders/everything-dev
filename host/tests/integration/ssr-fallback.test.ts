import { createServer } from "node:http";
import { Cause, Effect, Exit } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAvailablePort } from "../helpers/ports";

const loadUiComposeModuleMock = vi.fn();
const loadCoreUiRouteConfigMock = vi.fn();
const loadUiRouteConfigMock = vi.fn();
const loadRouterModuleMock = vi.fn();
const resolveRequestRuntimeMock = vi.fn();

vi.mock("../../src/services/federation.server", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/federation.server")>(
    "../../src/services/federation.server",
  );
  return {
    ...actual,
    loadUiComposeModule: loadUiComposeModuleMock,
    loadCoreUiRouteConfig: loadCoreUiRouteConfigMock,
    loadUiRouteConfig: loadUiRouteConfigMock,
    loadRouterModule: loadRouterModuleMock,
  };
});

vi.mock("../../src/services/tenant-runtime", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/tenant-runtime")>(
    "../../src/services/tenant-runtime",
  );
  return {
    ...actual,
    resolveRequestRuntime: resolveRequestRuntimeMock,
  };
});

const { FederationError } = await import("../../src/services/errors");
const { runServer } = await import("../../src/program");
const { resetUiComposeCache } = await import("../../src/services/ui-compose");

const CORE_MANIFEST = {
  name: "ui",
  manifestVersion: 1,
  routes: [{ id: "_public", isLayout: true, mount: "public", file: "_public.tsx" }],
};

function createBaseConfig(ssrUrl?: string) {
  return {
    env: "production",
    account: "linktree.near",
    domain: "linktree.com",
    networkId: "mainnet",
    title: "Linktree",
    description: "Base runtime",
    repository: "https://github.com/example/linktree",
    host: {
      name: "host",
      url: "http://127.0.0.1:0",
      entry: "http://127.0.0.1:0/mf-manifest.json",
      source: "remote",
    },
    ui: {
      name: "ui",
      url: "http://127.0.0.1:0/ui",
      entry: "http://127.0.0.1:0/ui/mf-manifest.json",
      source: "remote",
      integrity: "sha384-base",
      ssrUrl,
    },
    api: {
      name: "api",
      url: "http://127.0.0.1:0/api",
      entry: "http://127.0.0.1:0/api/mf-manifest.json",
      source: "remote",
      proxy: "http://127.0.0.1:9",
    },
    plugins: {},
  } as const;
}

async function startStaticServer(routes: Record<string, { body: string; contentType?: string }>) {
  const port = await getAvailablePort();
  const server = createServer((req, res) => {
    const route = routes[req.url ?? ""];
    if (!route) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", route.contentType ?? "text/plain");
    res.end(route.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const composeEngine = () => ({
  constructTree: async (input: {
    plugins: ReadonlyArray<{ key: string; mfName?: string }>;
    resolve: (ref: { key: string }) => Promise<{ manifest: unknown }>;
  }) => {
    const resolved = [];
    for (const ref of input.plugins) resolved.push(await input.resolve(ref));
    const { digestOf } = await import("everything-dev/ui/manifest");
    return {
      rootRoute: { id: "composed-tree" },
      routeTree: { id: "composed-tree" },
      nav: { items: [] },
      manifests: [CORE_MANIFEST],
      digest: await digestOf({
        plugins: input.plugins.map((p) => ({ key: p.key, mfName: p.mfName ?? p.key })),
        manifests: resolved.map((r) => r.manifest),
      }),
    };
  },
});

function mockCompositionSucceeds() {
  loadUiComposeModuleMock.mockReturnValue(Effect.succeed(composeEngine()));
  loadCoreUiRouteConfigMock.mockReturnValue(
    Effect.succeed({ routeConfigLoaders: {}, rootMeta: undefined }),
  );
  loadRouterModuleMock.mockReturnValue(
    Effect.succeed({
      renderToStream: vi.fn().mockResolvedValue({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                "<!DOCTYPE html><html><head><title>SSR</title></head><body></body></html>",
              ),
            );
            controller.close();
          },
        }),
        statusCode: 200,
        headers: new Headers(),
      }),
      getRouteHead: vi.fn(),
      createRouter: vi.fn(),
    }),
  );
}

describe("SSR fallback paths", () => {
  let assetServer: Awaited<ReturnType<typeof startStaticServer>>;
  let handle: ReturnType<typeof runServer>;
  let baseUrl: string;
  let requestConfig: ReturnType<typeof createBaseConfig>;
  const envSnapshot = { ...process.env };

  beforeAll(async () => {
    assetServer = await startStaticServer({
      "/ui/manifest.gen.json": {
        body: JSON.stringify(CORE_MANIFEST),
        contentType: "application/json",
      },
    });

    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    process.env.NODE_ENV = "production";
    process.env.HOST = "127.0.0.1";
    process.env.PORT = String(port);
    process.env.CSP_STRICT = "false";
    process.argv.push("--proxy");

    mockCompositionSucceeds();

    const base = createBaseConfig(`${assetServer.baseUrl}/ui-ssr`);
    requestConfig = {
      ...base,
      ui: {
        ...base.ui,
        url: `${assetServer.baseUrl}/ui`,
        entry: `${assetServer.baseUrl}/ui/mf-manifest.json`,
        ssrUrl: `${assetServer.baseUrl}/ui-ssr`,
      },
      api: { ...base.api, proxy: assetServer.baseUrl },
    } as ReturnType<typeof createBaseConfig>;

    resolveRequestRuntimeMock.mockResolvedValue({
      tenantAccountId: null,
      gatewayId: "linktree.com",
      ssrAllowed: true,
      config: requestConfig,
    });

    handle = runServer({
      config: {
        ...requestConfig,
        host: {
          name: "host",
          url: baseUrl,
          entry: `${baseUrl}/mf-manifest.json`,
          source: "remote",
        },
      } as any,
    });

    await handle.ready;
  });

  afterAll(async () => {
    await handle?.shutdown();
    await assetServer?.stop();
    process.env = { ...envSnapshot };

    const proxyIdx = process.argv.indexOf("--proxy");
    if (proxyIdx !== -1) {
      process.argv.splice(proxyIdx, 1);
    }
  });

  beforeEach(() => {
    loadUiComposeModuleMock.mockReset();
    loadCoreUiRouteConfigMock.mockReset();
    loadUiRouteConfigMock.mockReset();
    loadRouterModuleMock.mockReset();
    resolveRequestRuntimeMock.mockReset();

    resolveRequestRuntimeMock.mockResolvedValue({
      tenantAccountId: null,
      gatewayId: "linktree.com",
      ssrAllowed: true,
      config: requestConfig,
    });
  });

  describe("composition fails", () => {
    it("fails LOUD with 500 — never a silent wrong-tree render", async () => {
      const federationError = new FederationError({
        remoteName: "ui",
        remoteUrl: `${assetServer.baseUrl}/ui-ssr`,
        cause: new Error("An error has occurred"),
      });

      loadUiComposeModuleMock.mockReturnValue(
        Effect.gen(function* () {
          return yield* Effect.fail(federationError);
        }),
      );
      resetUiComposeCache();

      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("SSR composition failed");
      expect(loadUiComposeModuleMock).toHaveBeenCalled();
    });

    it("recovers on the next request after a transient composition failure", async () => {
      const federationError = new FederationError({
        remoteName: "ui",
        remoteUrl: `${assetServer.baseUrl}/ui-ssr`,
        cause: new Error("Transient network error"),
      });

      loadUiComposeModuleMock.mockReturnValueOnce(
        Effect.gen(function* () {
          return yield* Effect.fail(federationError);
        }),
      );
      loadUiComposeModuleMock.mockReturnValueOnce(Effect.succeed(composeEngine()));
      loadCoreUiRouteConfigMock.mockReturnValue(
        Effect.succeed({ routeConfigLoaders: {}, rootMeta: undefined }),
      );
      loadRouterModuleMock.mockReturnValue(
        Effect.succeed({
          renderToStream: vi.fn().mockResolvedValue({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("<!DOCTYPE html><html></html>"));
                controller.close();
              },
            }),
            statusCode: 200,
            headers: new Headers(),
          }),
          getRouteHead: vi.fn(),
          createRouter: vi.fn(),
        }),
      );
      resetUiComposeCache();

      const firstResponse = await fetch(`${baseUrl}/`);
      expect(firstResponse.status).toBe(500);

      const secondResponse = await fetch(`${baseUrl}/`);
      expect(secondResponse.status).toBe(200);
    });
  });

  describe("SSR URL not configured", () => {
    it("renders client shell without SSR", async () => {
      resolveRequestRuntimeMock.mockResolvedValue({
        tenantAccountId: null,
        gatewayId: "linktree.com",
        ssrAllowed: false,
        config: createBaseConfig(undefined),
      });

      const response = await fetch(`${baseUrl}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("Loading...");
      expect(html).toContain("remoteEntry.js");
    });
  });

  describe("renderToStream throws", () => {
    it("falls back to client shell with SSR unavailable message", async () => {
      mockCompositionSucceeds();
      const failingModule = {
        renderToStream: vi.fn().mockRejectedValue(new Error("React render error")),
        getRouteHead: vi.fn().mockRejectedValue(new Error("head error")),
        createRouter: vi.fn(),
      };

      loadRouterModuleMock.mockReturnValue(Effect.succeed(failingModule));
      resetUiComposeCache();

      const response = await fetch(`${baseUrl}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("SSR unavailable");
      expect(html).toContain("React render error");
      expect(html).toContain("remoteEntry.js");
    });
  });

  describe("FederationError message propagation bug", () => {
    it("FederationError.message is empty when passed through runPromiseExit", async () => {
      const federationError = new FederationError({
        remoteName: "ui",
        remoteUrl: `${assetServer.baseUrl}/ui-ssr`,
        cause: new Error("An error has occurred"),
      });

      expect(federationError._tag).toBe("FederationError");
      expect(federationError.remoteName).toBe("ui");
      expect(federationError.cause).toBeDefined();

      const result = await Effect.runPromiseExit(Effect.fail(federationError));

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) throw new Error("Expected Left");
      const leftError = Cause.squash(result.cause) as InstanceType<typeof FederationError>;
      expect(leftError._tag).toBe("FederationError");

      expect(leftError.message.length).toBeGreaterThan(0);
    });
  });
});
