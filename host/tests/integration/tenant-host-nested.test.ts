import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAvailablePort } from "../helpers/ports";

const loadRemoteConfigMock = vi.fn();
const buildRuntimeConfigMock = vi.fn();
const verifySriForUrlMock = vi.fn();

vi.mock("everything-dev/config", async () => {
  const actual =
    await vi.importActual<typeof import("everything-dev/config")>("everything-dev/config");
  return {
    ...actual,
    loadRemoteConfig: loadRemoteConfigMock,
    buildRuntimeConfig: buildRuntimeConfigMock,
  };
});

vi.mock("everything-dev/integrity", async () => {
  const actual = await vi.importActual<typeof import("everything-dev/integrity")>(
    "everything-dev/integrity",
  );
  return {
    ...actual,
    verifySriForUrl: verifySriForUrlMock,
  };
});

vi.mock("../../src/services/binding-resolver", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/binding-resolver")>(
    "../../src/services/binding-resolver",
  );
  return {
    ...actual,
    createBindingResolver: () => ({
      resolve: async (hostname: string) =>
        hostname === "chicago.alice.linktree.com"
          ? {
              hostname: "chicago.alice.linktree.com",
              accountId: "chicago.alice.linktree.near",
              allowUiOverrides: true,
              allowBackendOverrides: false,
              allowSsr: false,
              status: "active",
            }
          : null,
      clear: () => {},
    }),
  };
});

const { runServer } = await import("../../src/program");

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

describe("tenant host nested integration", () => {
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
    vi.clearAllMocks();
    verifySriForUrlMock.mockResolvedValue(undefined);
    const baseConfig = createBaseConfig();

    loadRemoteConfigMock.mockResolvedValue({
      source: "bos://chicago.alice.linktree.near/linktree.com",
      rawConfig: {
        extends: "bos://linktree.near/linktree.com",
      },
      config: {
        account: "chicago.alice.linktree.near",
        title: "Chicago Alice",
        description: "Nested tenant",
        repository: "https://github.com/example/chicago-alice",
        app: {
          host: { development: "local:host", production: "https://host.example.com" },
          ui: { name: "ui", production: "https://cdn.example.com/chicago-alice-ui" },
          api: { name: "api", production: "https://api.example.com" },
        },
        plugins: {
          apps: {
            production: "https://plugins.example.com/apps",
          },
        },
      },
      extendsChain: [
        "bos://chicago.alice.linktree.near/linktree.com",
        "bos://linktree.near/linktree.com",
      ],
    });

    buildRuntimeConfigMock.mockResolvedValue({
      ...baseConfig,
      account: "chicago.alice.linktree.near",
      title: "Chicago Alice",
      description: "Nested tenant",
      repository: "https://github.com/example/chicago-alice",
      ui: {
        ...baseConfig.ui,
        url: `${assetServer.baseUrl}/chicago-ui`,
        entry: `${assetServer.baseUrl}/chicago-ui/mf-manifest.json`,
        integrity: "sha384-chicago-ui",
      },
      api: {
        ...baseConfig.api,
        proxy: assetServer.baseUrl,
      },
      plugins: {
        apps: {
          ...baseConfig.plugins.apps,
        },
      },
    });
  });

  it("renders nested descendant UI remotes using the actual tenant resolver", async () => {
    const response = await fetch(`${baseUrl}/`, {
      headers: { "x-forwarded-host": "chicago.alice.linktree.com", "x-forwarded-proto": "https" },
    });

    const html = await response.text();

    expect(response.status).toBe(200);
    expect(loadRemoteConfigMock).toHaveBeenCalledWith(
      "bos://chicago.alice.linktree.near/linktree.com",
      "production",
    );
    expect(html).toContain(`${assetServer.baseUrl}/chicago-ui/remoteEntry.js`);
  });
});
