import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBindingResolverCache,
  createBindingResolver,
  FAILURE_TTL_MS,
  type TenantBinding,
} from "../../src/services/binding-resolver";
import type { RuntimeConfig } from "../../src/services/config";

const config: RuntimeConfig = {
  env: "production",
  account: "citynode.near",
  domain: "citynode.app",
  networkId: "mainnet",
  host: {
    name: "host",
    url: "https://citynode.app",
    entry: "https://citynode.app/mf-manifest.json",
    source: "remote",
  },
  ui: {
    name: "ui",
    url: "https://ui.example.com",
    entry: "https://ui.example.com/mf-manifest.json",
    source: "remote",
  },
  api: {
    name: "api",
    url: "https://api.example.com",
    entry: "https://api.example.com/mf-manifest.json",
    source: "remote",
  },
  plugins: {},
};

function binding(hostname: string): TenantBinding {
  return {
    hostname,
    tenantId: hostname,
    accountId: "chicago.near",
    allowUiOverrides: true,
    allowBackendOverrides: false,
    allowSsr: false,
    status: "active",
  };
}

describe("tenant binding hostnames", () => {
  beforeEach(() => clearBindingResolverCache());
  afterEach(() => vi.unstubAllGlobals());

  it("resolves aliases under the gateway and custom domains by their full hostname", async () => {
    const bindings = [binding("chicago"), binding("nyc.gov"), binding("full.citynode.app")];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(bindings))));
    const resolver = createBindingResolver(config);
    expect(await resolver.resolve("chicago.citynode.app")).toMatchObject({ hostname: "chicago" });
    expect(await resolver.resolve("NYC.GOV")).toMatchObject({ hostname: "nyc.gov" });
    expect(await resolver.resolve("full.citynode.app")).toMatchObject({
      hostname: "full.citynode.app",
    });
    expect(await resolver.resolve("nyc.gov.citynode.app")).toBeNull();
    expect(await resolver.resolve("citynode.app")).toBeNull();
  });
});

describe("tenant resolution over localhost", () => {
  beforeEach(() => clearBindingResolverCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.NODE_ENV = "production";
  });

  it("maps <label>.localhost onto the gateway alias in development", async () => {
    process.env.NODE_ENV = "development";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([binding("chicago")]))),
    );
    const resolver = createBindingResolver(config);

    expect(await resolver.resolve("chicago.localhost")).toMatchObject({ hostname: "chicago" });
    expect(await resolver.resolve("localhost")).toBeNull();
    expect(await resolver.resolve("unknown.localhost")).toBeNull();
    expect(await resolver.resolve("a.b.localhost")).toBeNull();
  });

  it("ignores the localhost alias in production", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([binding("chicago")]))),
    );
    const resolver = createBindingResolver(config);

    expect(await resolver.resolve("chicago.localhost")).toBeNull();
  });
});

describe("binding resolver failure handling", () => {
  beforeEach(() => {
    clearBindingResolverCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports API-unavailable responses clearly and caches the failure briefly", async () => {
    const failingFetch = vi
      .fn()
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", failingFetch);
    const resolver = createBindingResolver(config);

    await expect(resolver.resolve("chicago.citynode.app")).rejects.toThrow(
      /API plugin is not available on this host/,
    );
    expect(failingFetch).toHaveBeenCalledTimes(1);

    await expect(resolver.resolve("chicago.citynode.app")).rejects.toThrow(/cached failure/);
    expect(failingFetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + FAILURE_TTL_MS + 1_000);
    const recoveringFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([binding("chicago")])));
    vi.stubGlobal("fetch", recoveringFetch);

    expect(await resolver.resolve("chicago.citynode.app")).toMatchObject({
      hostname: "chicago",
    });
  });

  it("serves stale bindings and keeps refetching when a previous snapshot exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([binding("chicago")])))
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const resolver = createBindingResolver(config);

    expect(await resolver.resolve("chicago.citynode.app")).toMatchObject({
      hostname: "chicago",
    });

    vi.setSystemTime(Date.now() + 31_000);
    await expect(resolver.resolve("chicago.citynode.app")).resolves.toMatchObject({
      hostname: "chicago",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
