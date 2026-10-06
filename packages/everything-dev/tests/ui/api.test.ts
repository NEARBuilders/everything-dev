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
  notifyError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: contextHolder.notifyError } }));

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
  contextHolder.notifyError.mockClear();
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

  it("resolves connection notices when the request fails so language changes are respected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    let language = "es";
    const connectionError = vi.fn(() => ({
      title: language === "es" ? "Conexión no disponible" : "Connexion indisponible",
      description: language === "es" ? "Inténtalo de nuevo." : "Réessayez.",
    }));
    const client = createApiClient({
      hostUrl: "https://translated.test",
      rpcBase: "/api/rpc",
      connectionError,
    });
    expect(connectionError).not.toHaveBeenCalled();
    await pingClient(client);
    await vi.waitFor(() =>
      expect(contextHolder.notifyError).toHaveBeenLastCalledWith("Conexión no disponible", {
        id: "api-connection-error",
        description: "Inténtalo de nuevo.",
      }),
    );
    language = "fr";
    await pingClient(client);
    await vi.waitFor(() =>
      expect(contextHolder.notifyError).toHaveBeenLastCalledWith("Connexion indisponible", {
        id: "api-connection-error",
        description: "Réessayez.",
      }),
    );
  });

  it("keeps the default connection notice for apps without a message resolver", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await pingClient(createApiClient({ hostUrl: "https://offline.test", rpcBase: "/api/rpc" }));
    await vi.waitFor(() =>
      expect(contextHolder.notifyError).toHaveBeenCalledWith("Unable to connect to API", {
        id: "api-connection-error",
        description: "The API is currently unavailable. Please try again later.",
      }),
    );
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

describe("rate-limit retry", () => {
  it("retries a 429 with backoff until the request succeeds", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ json: "pong" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const clients = createServiceClients(cfg, ["api"]);
    await pingClient(clients.api);
    expect(calls).toBe(3);
  });

  it("gives up after the retry budget and surfaces the 429", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    }) as unknown as typeof fetch;

    const clients = createServiceClients(cfg, ["api"]);
    await expect((clients.api as { ping(): Promise<unknown> }).ping()).rejects.toThrow();
    expect(calls).toBe(4);
  });
});
