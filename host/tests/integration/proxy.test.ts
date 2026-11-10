import { Context as EffectContext, Redacted } from "effect";
import { type Context, Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AuthVariables } from "../../src/lib/auth";
import { proxyRequest } from "../../src/middleware/static-proxy";
import { setupApiRoutes } from "../../src/routes/api";
import { registerAuthHandler } from "../../src/services/auth";
import type { PluginResult } from "../../src/services/plugins";

const authServicesTag = EffectContext.Service<{
  handler: (req: Request) => Promise<Response>;
}>("test/AuthServices");

type HonoEnv = { Variables: AuthVariables };

const createMockResponse = (body: string, status = 200, headers: Record<string, string> = {}) => {
  return new Response(body, {
    status,
    headers: new Headers(headers),
  });
};

describe("API Proxy", () => {
  describe("proxyRequest", () => {
    let fetchMock: Mock;
    const originalFetch = globalThis.fetch;

    beforeAll(() => {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
    });

    beforeEach(() => {
      fetchMock.mockClear();
    });

    it("forwards request to target URL with path preserved", async () => {
      const targetBase = "https://api.example.com";
      const originalUrl = "http://localhost:3000/api/users?page=1";

      fetchMock.mockResolvedValueOnce(createMockResponse('{"users":[]}'));

      const req = new Request(originalUrl, { method: "GET" });
      await proxyRequest(req, targetBase);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
      expect(proxiedRequest.url).toBe("https://api.example.com/api/users?page=1");
    });

    it("removes host header from forwarded request", async () => {
      const targetBase = "https://api.example.com";

      fetchMock.mockResolvedValueOnce(createMockResponse("ok"));

      const req = new Request("http://localhost:3000/api/test", {
        method: "GET",
        headers: { Host: "localhost:3000" },
      });
      await proxyRequest(req, targetBase);

      const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
      expect(proxiedRequest.headers.has("host")).toBe(false);
    });

    it("sets accept-encoding to identity", async () => {
      const targetBase = "https://api.example.com";

      fetchMock.mockResolvedValueOnce(createMockResponse("ok"));

      const req = new Request("http://localhost:3000/api/test", {
        method: "GET",
        headers: { "accept-encoding": "gzip, deflate" },
      });
      await proxyRequest(req, targetBase);

      const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
      expect(proxiedRequest.headers.get("accept-encoding")).toBe("identity");
    });

    it("forwards POST body correctly", async () => {
      const targetBase = "https://api.example.com";
      const body = JSON.stringify({ name: "test" });

      fetchMock.mockResolvedValueOnce(createMockResponse('{"id":1}'));

      const req = new Request("http://localhost:3000/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      await proxyRequest(req, targetBase);

      const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
      expect(proxiedRequest.method).toBe("POST");
      expect(await proxiedRequest.text()).toBe(body);
    });

    it("preserves response status code", async () => {
      const targetBase = "https://api.example.com";

      fetchMock.mockResolvedValueOnce(createMockResponse("Not Found", 404));

      const req = new Request("http://localhost:3000/api/missing");
      const response = await proxyRequest(req, targetBase);

      expect(response.status).toBe(404);
    });

    it("removes content-encoding and content-length from response", async () => {
      const targetBase = "https://api.example.com";

      fetchMock.mockResolvedValueOnce(
        createMockResponse("ok", 200, {
          "content-encoding": "gzip",
          "content-length": "100",
        }),
      );

      const req = new Request("http://localhost:3000/api/test");
      const response = await proxyRequest(req, targetBase);

      expect(response.headers.has("content-encoding")).toBe(false);
      expect(response.headers.has("content-length")).toBe(false);
    });

    describe("cookie rewriting", () => {
      it("rewrites better-auth cookies in request when enabled", async () => {
        const targetBase = "https://api.example.com";

        fetchMock.mockResolvedValueOnce(createMockResponse("ok"));

        const req = new Request("http://localhost:3000/api/auth/session", {
          headers: {
            cookie: "better-auth.session_token=abc123; other-cookie=value",
          },
        });
        await proxyRequest(req, targetBase, true);

        const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
        expect(proxiedRequest.headers.get("cookie")).toBe(
          "__Secure-better-auth.session_token=abc123; other-cookie=value",
        );
      });

      it("does not rewrite cookies when disabled", async () => {
        const targetBase = "https://api.example.com";

        fetchMock.mockResolvedValueOnce(createMockResponse("ok"));

        const req = new Request("http://localhost:3000/api/data", {
          headers: {
            cookie: "better-auth.session_token=abc123",
          },
        });
        await proxyRequest(req, targetBase, false);

        const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
        expect(proxiedRequest.headers.get("cookie")).toBe("better-auth.session_token=abc123");
      });

      it("strips Secure and Domain from response cookies when rewriting", async () => {
        const targetBase = "https://api.example.com";

        const mockResponse = new Response("ok", {
          status: 200,
          headers: new Headers(),
        });

        Object.defineProperty(mockResponse.headers, "getSetCookie", {
          value: () => [
            "__Secure-better-auth.session_token=xyz; Domain=api.example.com; Secure; Path=/; HttpOnly",
          ],
        });

        fetchMock.mockResolvedValueOnce(mockResponse);

        const req = new Request("http://localhost:3000/api/auth/login");
        const response = await proxyRequest(req, targetBase, true);

        const setCookie = response.headers.get("set-cookie");
        expect(setCookie).toBeDefined();
        expect(setCookie).toContain("better-auth.session_token=xyz");
        expect(setCookie).not.toContain("__Secure-");
        expect(setCookie).not.toContain("Domain=");
        expect(setCookie).not.toContain("; Secure");
      });
    });
  });

  describe("setupApiRoutes with proxy mode", () => {
    let fetchMock: Mock;
    const originalFetch = globalThis.fetch;

    beforeAll(() => {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
    });

    beforeEach(() => {
      fetchMock.mockClear();
    });

    it("proxies /api/* routes when proxy is configured", async () => {
      const app = new Hono();

      const config = {
        hostUrl: "http://localhost:3000",
        api: {
          name: "api",
          url: "http://localhost:3001",
          source: "local" as const,
          proxy: "https://production-api.example.com",
        },
        ui: {
          name: "ui",
          url: "http://localhost:3003",
          source: "local" as const,
        },
      };

      app.all("/api/*", async (c: Context) => {
        const response = await proxyRequest(c.req.raw, config.api.proxy!, true);
        return response;
      });

      fetchMock.mockResolvedValueOnce(createMockResponse('{"status":"ok"}'));

      await app.fetch(new Request("http://localhost:3000/api/health"));
      expect(fetchMock).toHaveBeenCalled();

      const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
      expect(proxiedRequest.url).toBe("https://production-api.example.com/api/health");
    });

    it("handles RPC requests through proxy", async () => {
      const app = new Hono();

      app.all("/api/*", async (c: Context) => {
        const response = await proxyRequest(c.req.raw, "https://production-api.example.com", true);
        return response;
      });

      const rpcBody = JSON.stringify({
        method: "getValue",
        params: { key: "test" },
      });
      fetchMock.mockResolvedValueOnce(createMockResponse('{"result":"value"}'));

      await app.fetch(
        new Request("http://localhost:3000/api/rpc/getValue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: rpcBody,
        }),
      );

      expect(fetchMock).toHaveBeenCalled();
      const proxiedRequest = fetchMock.mock.calls[0][0] as Request;
      expect(proxiedRequest.url).toBe("https://production-api.example.com/api/rpc/getValue");
      expect(proxiedRequest.method).toBe("POST");
    });
  });

  describe("setupApiRoutes auth route precedence", () => {
    it("handles /api/auth before the generic API router", async () => {
      const app = new Hono<HonoEnv>();
      const authHandler = vi.fn(async () => new Response("auth ok", { status: 200 }));

      const config = {
        hostUrl: "http://localhost:3000",
        api: {
          name: "api",
          url: "http://localhost:3001",
          source: "local" as const,
        },
        ui: {
          name: "ui",
          url: "http://localhost:3003",
          source: "local" as const,
        },
      } as any;

      const plugins: PluginResult = {
        runtime: null,
        auth: {
          key: "auth",
          name: "auth",
          createClient: () => ({}),
          router: {},
          metadata: { remoteUrl: "local" },
          initialized: {
            effectContext: EffectContext.make(authServicesTag, {
              handler: authHandler,
              auth: { api: { getSession: vi.fn() } },
              db: {} as any,
            } as any),
            plugin: { servicesTag: authServicesTag },
          },
        } as any,
        api: null,
        plugins: {},
        authClient: null,
        status: {
          available: false,
          pluginName: null,
          error: null,
          errorDetails: null,
          loadedPlugins: [],
          rpcPlugins: [],
          failures: [],
          warnings: [],
        },
      };

      registerAuthHandler(app, plugins);

      await setupApiRoutes(app, config, plugins, async (_c, next) => next(), {
        status: "ready",
        startTime: Date.now(),
        milestones: [],
        error: null,
        ssrEnabled: false,
      });

      const response = await app.fetch(new Request("http://localhost:3000/api/auth/session"));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("auth ok");
      expect(authHandler).toHaveBeenCalledTimes(1);
    });

    it("routes every method on /api/auth/* to the auth handler (no SSR/404 swallow)", async () => {
      const app = new Hono<HonoEnv>();
      const authHandler = vi.fn(async () => new Response("auth ok", { status: 200 }));

      const config = {
        hostUrl: "http://localhost:3000",
        api: {
          name: "api",
          url: "http://localhost:3001",
          source: "local" as const,
        },
        ui: {
          name: "ui",
          url: "http://localhost:3003",
          source: "local" as const,
        },
      } as any;

      const plugins: PluginResult = {
        runtime: null,
        auth: {
          key: "auth",
          name: "auth",
          createClient: () => ({}),
          router: {},
          metadata: { remoteUrl: "local" },
          initialized: {
            effectContext: EffectContext.make(authServicesTag, {
              handler: authHandler,
              auth: { api: { getSession: vi.fn() } },
              db: {} as any,
            } as any),
            plugin: { servicesTag: authServicesTag },
          },
        } as any,
        api: null,
        plugins: {},
        authClient: null,
        status: {
          available: false,
          pluginName: null,
          error: null,
          errorDetails: null,
          loadedPlugins: [],
          rpcPlugins: [],
          failures: [],
          warnings: [],
        },
      };

      registerAuthHandler(app, plugins);

      await setupApiRoutes(app, config, plugins, async (_c, next) => next(), {
        status: "ready",
        startTime: Date.now(),
        milestones: [],
        error: null,
        ssrEnabled: false,
      });

      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const response = await app.fetch(
          new Request("http://localhost:3000/api/auth/session", { method }),
        );
        expect(response.status, method).toBe(200);
        expect(await response.text()).toBe("auth ok");
      }
      expect(authHandler).toHaveBeenCalledTimes(3);
    });

    it("a failed api plugin keeps auth mounted and returns 503 on /api/*", async () => {
      const app = new Hono<HonoEnv>();
      const authHandler = vi.fn(async () => new Response("auth ok", { status: 200 }));

      const config = {
        hostUrl: "http://localhost:3000",
        api: { name: "api", url: "http://localhost:3001", source: "local" as const },
        ui: { name: "ui", url: "http://localhost:3003", source: "local" as const },
      } as any;

      const plugins: PluginResult = {
        runtime: null,
        auth: {
          key: "auth",
          name: "auth",
          createClient: () => ({}),
          router: {},
          metadata: { remoteUrl: "local" },
          initialized: {
            effectContext: EffectContext.make(authServicesTag, {
              handler: authHandler,
              auth: { api: { getSession: vi.fn() } },
              db: {} as any,
            } as any),
            plugin: { servicesTag: authServicesTag },
          },
        } as any,
        api: null,
        plugins: {},
        authClient: null,
        status: {
          available: false,
          pluginName: "api",
          error: "Plugin api failed: unreachable",
          errorDetails: null,
          loadedPlugins: [],
          rpcPlugins: [],
          failures: [
            {
              pluginKey: "api",
              pluginUrl: "http://localhost:3001",
              kind: "load",
              retryable: true,
              message: "Plugin api failed: unreachable",
            },
          ],
          warnings: [],
        },
      };

      registerAuthHandler(app, plugins);

      await setupApiRoutes(app, config, plugins, async (_c, next) => next(), {
        status: "ready",
        startTime: Date.now(),
        milestones: [],
        error: null,
        ssrEnabled: false,
      });

      const authResponse = await app.fetch(new Request("http://localhost:3000/api/auth/session"));
      expect(authResponse.status).toBe(200);
      expect(await authResponse.text()).toBe("auth ok");

      const rpcResponse = await app.fetch(
        new Request("http://localhost:3000/api/rpc/ping", { method: "POST" }),
      );
      expect(rpcResponse.status).toBe(503);

      const restResponse = await app.fetch(new Request("http://localhost:3000/api/ping"));
      expect(restResponse.status).toBe(503);
    });

    it("a failed auth plugin unmounts /api/auth/* but the composed api still serves", async () => {
      const app = new Hono<HonoEnv>();
      const fetchMock = vi.fn(async () => createMockResponse("{}"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const config = {
          hostUrl: "http://localhost:3000",
          api: { name: "api", url: "http://localhost:3001", source: "local" as const },
          ui: { name: "ui", url: "http://localhost:3003", source: "local" as const },
        } as any;

        const plugins: PluginResult = {
          runtime: null,
          auth: null,
          api: {
            key: "api",
            name: "api",
            createClient: () => ({}),
            router: await makeMinimalApiRouter(),
            metadata: { remoteUrl: "local" },
          } as any,
          plugins: {},
          authClient: null,
          status: {
            available: true,
            pluginName: "api",
            error: null,
            errorDetails: null,
            loadedPlugins: [],
            rpcPlugins: [],
            failures: [
              {
                pluginKey: "auth",
                pluginUrl: "http://localhost:3002",
                kind: "load",
                retryable: true,
                message: "Plugin auth failed: unreachable",
              },
            ],
            warnings: [],
          },
        };

        registerAuthHandler(app, plugins);

        await setupApiRoutes(app, config, plugins, async (_c, next) => next(), {
          status: "ready",
          startTime: Date.now(),
          milestones: [],
          error: null,
          ssrEnabled: false,
        });

        const authResponse = await app.fetch(new Request("http://localhost:3000/api/auth/session"));
        expect(authResponse.status).toBe(404);

        const pingResponse = await app.fetch(
          new Request("http://localhost:3000/api/rpc/ping", { method: "POST" }),
        );
        expect(pingResponse.status).toBe(200);
        expect(await pingResponse.json()).toEqual({ json: { status: "ok" } });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("a failed plugin key is unmounted; its prefix falls through without poisoning siblings", async () => {
      const app = new Hono<HonoEnv>();
      const fetchMock = vi.fn(async () => createMockResponse("{}"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const plugins = makePlugins(await makeMinimalApiRouter(), {
          feedback: {
            key: "feedback",
            name: "feedback-plugin",
            createClient: () => ({}),
            router: undefined,
            metadata: { remoteUrl: "https://feedback.example.com" },
            proxy: { target: "https://feedback.example.com" },
          },
        });

        await setupApiRoutes(app, makeConfig(), plugins, async (_c, next) => next(), loadingState);

        const absent = await app.fetch(
          new Request("http://localhost:3000/api/rpc/broken/getThing", { method: "POST" }),
        );
        expect(absent.status).toBe(404);

        const sibling = await app.fetch(
          new Request("http://localhost:3000/api/rpc/feedback/getThing", {
            method: "POST",
          }),
        );
        expect(sibling.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  const makeMinimalApiRouter = async () => {
    await import("@orpc/openapi/extensions/route");
    const { implement } = await import("@orpc/server");
    const { oc } = await import("@orpc/contract");
    const { z } = await import("zod");
    const contract = oc.router({
      ping: oc
        .route({ method: "GET", path: "/ping" })
        .output(z.object({ status: z.literal("ok") })),
    });
    return {
      ping: implement(contract, {}).ping.handler(() => ({ status: "ok" })),
    };
  };

  const makePlugins = (apiRouter: unknown, extraPlugins: Record<string, unknown>): PluginResult =>
    ({
      runtime: null,
      auth: null,
      api: {
        key: "api",
        name: "api",
        createClient: () => ({}),
        router: apiRouter,
        metadata: { remoteUrl: "local" },
      },
      plugins: extraPlugins,
      authClient: null,
      status: {
        available: Boolean(apiRouter),
        pluginName: "api",
        error: null,
        errorDetails: null,
        loadedPlugins: Object.keys(extraPlugins),
        rpcPlugins: Object.keys(extraPlugins),
        failures: [],
        warnings: [],
      },
    }) as unknown as PluginResult;

  const loadingState = {
    status: "ready" as const,
    startTime: Date.now(),
    milestones: [],
    error: null,
    ssrEnabled: false,
  };

  const makeConfig = () =>
    ({
      hostUrl: "http://localhost:3000",
      api: { name: "api", url: "http://localhost:3001", source: "local" as const },
      ui: { name: "ui", url: "http://localhost:3003", source: "local" as const },
    }) as any;

  describe("setupApiRoutes rpc-mode plugin proxy (#848)", () => {
    it("forwards /api/rpc/{key}/* to the attachment target with its credential", async () => {
      const app = new Hono<HonoEnv>();
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        createMockResponse('{"json":{"slug":"my-project"}}', 200, {
          "content-type": "application/json",
        }),
      );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const plugins = makePlugins(await makeMinimalApiRouter(), {
          feedback: {
            key: "feedback",
            name: "feedback-plugin",
            createClient: () => ({}),
            router: undefined,
            metadata: { remoteUrl: "https://feedback.example.com" },
            proxy: {
              target: "https://feedback.example.com",
              apiKey: Redacted.make("api_secret_123"),
            },
          },
        });

        await setupApiRoutes(app, makeConfig(), plugins, async (_c, next) => next(), loadingState);

        const response = await app.fetch(
          new Request("http://localhost:3000/api/rpc/feedback/getProjectBySlug?depth=1", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ json: { slug: "my-project" } }),
          }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ json: { slug: "my-project" } });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const forwarded = fetchMock.mock.calls[0]?.[0] as unknown as Request;
        expect(forwarded.url).toBe("https://feedback.example.com/api/rpc/getProjectBySlug?depth=1");
        expect(forwarded.method).toBe("POST");
        expect(forwarded.headers.get("x-api-key")).toBe("api_secret_123");
        expect(forwarded.headers.has("host")).toBe(false);
        expect(await forwarded.json()).toEqual({ json: { slug: "my-project" } });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("still serves composed plugin routers when an rpc attachment is present", async () => {
      const app = new Hono<HonoEnv>();
      const fetchMock = vi.fn(async () => createMockResponse("{}"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const plugins = makePlugins(await makeMinimalApiRouter(), {
          feedback: {
            key: "feedback",
            name: "feedback-plugin",
            createClient: () => ({}),
            router: undefined,
            metadata: { remoteUrl: "https://feedback.example.com" },
            proxy: { target: "https://feedback.example.com" },
          },
        });

        await setupApiRoutes(app, makeConfig(), plugins, async (_c, next) => next(), loadingState);

        const response = await app.fetch(
          new Request("http://localhost:3000/api/rpc/ping", { method: "POST" }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ json: { status: "ok" } });
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
