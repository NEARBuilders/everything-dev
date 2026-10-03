import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRouterContext } from "../../src/ui/api";
import {
  createApiClient,
  createPluginApiClient,
  createServiceClients,
  useApiClient,
  usePluginClients,
} from "../../src/ui/api";

const contextHolder = vi.hoisted(() => ({
  context: {} as ClientRouterContext,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ options: { context: contextHolder.context } }),
}));

const cfg = { hostUrl: "https://host.test", rpcBase: "/api/rpc" };

const urls: string[] = [];

function stubFetch() {
  urls.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify({ json: "pong" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function drain(promise: Promise<unknown>) {
  try {
    await promise;
  } catch {}
}

function pingClient(client: unknown) {
  return drain((client as { ping(): Promise<unknown> }).ping());
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createServiceClients", () => {
  it("targets the flat rpcBase for the api service", async () => {
    const clients = createServiceClients(cfg, ["api"]);
    await pingClient(clients.api);
    expect(urls[0]).toBe("https://host.test/api/rpc/ping");
  });

  it("targets rpcBase/<pluginKey> for plugin services", async () => {
    const clients = createServiceClients(cfg, ["api", "registry"]);
    await pingClient(clients.registry);
    expect(urls[0]).toBe("https://host.test/api/rpc/registry/ping");
  });
});

describe("createPluginApiClient", () => {
  it("targets rpcBase/<pluginKey>", async () => {
    const client = createPluginApiClient("registry", cfg);
    await pingClient(client);
    expect(urls[0]).toBe("https://host.test/api/rpc/registry/ping");
  });
});

describe("browser singleton", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("memoizes per endpoint", () => {
    const first = createApiClient(cfg);
    const second = createApiClient(cfg);
    const other = createApiClient({ hostUrl: "https://other.test", rpcBase: "/api/rpc" });

    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("memoizes plugin clients per endpoint key", () => {
    const first = createPluginApiClient("registry", cfg);
    const second = createPluginApiClient("registry", cfg);
    const other = createPluginApiClient("votes", cfg);

    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("does not memoize when request headers are passed", () => {
    const headers = new Headers({ "x-test": "1" });

    const first = createApiClient(cfg, headers);
    const second = createApiClient(cfg, headers);

    expect(second).not.toBe(first);
  });
});

describe("context hooks", () => {
  it("useApiClient reads the router context apiClient", () => {
    contextHolder.context = { apiClient: "API_CLIENT" };
    expect(useApiClient()).toBe("API_CLIENT");
  });

  it("usePluginClients reads the router context pluginClients", () => {
    contextHolder.context = { pluginClients: { registry: "REGISTRY_CLIENT" } };
    expect(usePluginClients()).toEqual({ registry: "REGISTRY_CLIENT" });
  });

  it("usePluginClients falls back to an empty object", () => {
    contextHolder.context = {};
    expect(usePluginClients()).toEqual({});
  });
});
