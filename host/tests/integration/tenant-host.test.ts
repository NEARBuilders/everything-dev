import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAvailablePort } from "../helpers/ports";

const resolveRequestRuntimeMock = vi.fn();

vi.mock("../../src/services/tenant-runtime", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/tenant-runtime")>(
    "../../src/services/tenant-runtime",
  );
  return {
    ...actual,
    resolveRequestRuntime: resolveRequestRuntimeMock,
  };
});

const { runServer } = await import("../../src/program");
const { TenantRuntimeError } = await import("../../src/services/tenant-runtime");

function createBaseConfig() {
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
    },
    api: {
      name: "api",
      url: "http://127.0.0.1:0/api",
      entry: "http://127.0.0.1:0/api/mf-manifest.json",
      source: "remote",
      proxy: "http://127.0.0.1:9",
    },
    plugins: {
      apps: {
        name: "apps",
        url: "http://127.0.0.1:0/apps",
        entry: "http://127.0.0.1:0/apps/mf-manifest.json",
        source: "remote",
      },
    },
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

describe("tenant host integration", () => {
  let assetServer: Awaited<ReturnType<typeof startStaticServer>>;
  let handle: ReturnType<typeof runServer>;
  let baseUrl: string;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHost = process.env.HOST;
  const previousPort = process.env.PORT;

  beforeAll(async () => {
    assetServer = await startStaticServer({});

    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    process.env.NODE_ENV = "production";
    process.env.HOST = "127.0.0.1";
    process.env.PORT = String(port);
    process.argv.push("--proxy");

    const config = createBaseConfig();
    handle = runServer({
      config: {
        ...config,
        host: { ...config.host, url: baseUrl, entry: `${baseUrl}/mf-manifest.json` },
        ui: {
          ...config.ui,
          url: `${assetServer.baseUrl}/ui`,
          entry: `${assetServer.baseUrl}/ui/mf-manifest.json`,
        },
        api: { ...config.api, proxy: assetServer.baseUrl },
        plugins: {
          apps: {
            ...config.plugins.apps,
          },
        },
      } as any,
    });

    await handle.ready;
  });

  afterAll(async () => {
    await handle?.shutdown();
    await assetServer?.stop();
    process.env.NODE_ENV = previousNodeEnv;
    process.env.HOST = previousHost;
    process.env.PORT = previousPort;

    const proxyIdx = process.argv.indexOf("--proxy");
    if (proxyIdx !== -1) {
      process.argv.splice(proxyIdx, 1);
    }
  });

  beforeEach(() => {
    resolveRequestRuntimeMock.mockReset();
    resolveRequestRuntimeMock.mockResolvedValue({
      tenantAccountId: "alice.near",
      gatewayId: "linktree.com",
      ssrAllowed: false,
      config: {
        ...createBaseConfig(),
        account: "alice.near",
        title: "Alice",
        description: "Alice links",
        repository: "https://github.com/example/alice",
        ui: {
          ...createBaseConfig().ui,
          url: `${assetServer.baseUrl}/alice-ui`,
          entry: `${assetServer.baseUrl}/alice-ui/mf-manifest.json`,
          integrity: "sha384-alice",
        },
        api: {
          ...createBaseConfig().api,
          proxy: assetServer.baseUrl,
        },
        plugins: {
          apps: {
            ...createBaseConfig().plugins.apps,
          },
        },
      },
    });
  });

  it("returns 502 for upstream tenant runtime failures", async () => {
    resolveRequestRuntimeMock.mockRejectedValueOnce(
      new TenantRuntimeError("Failed to load tenant config for bos://alice.near/linktree.com", 502),
    );

    const response = await fetch(`${baseUrl}/`, {
      headers: { "x-forwarded-host": "alice.linktree.com", "x-forwarded-proto": "https" },
    });

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Failed to load tenant config");
  });
});
