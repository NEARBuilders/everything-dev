import {
  type RegistryClientShape,
  type RegistryEntry,
  type RegistryKey,
  type RegistryListInput,
  type RegistryListResult,
  registryNamespaceForNetwork,
} from "everything-dev/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REGISTRY_NAMESPACE, type RegistryConfig } from "../services/config";
import { createRegistryMethods, resolvePublishedRuntime } from "../services/registry";

function listResult(entries: Array<{ key: string; value: unknown }>): RegistryListResult {
  const mapped: RegistryEntry[] = entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    blockHeight: 1,
    blockTimestampNs: "0",
  }));
  return { entries: mapped, pageToken: null };
}

function fakeClient(
  impl: {
    read?: (key: RegistryKey) => Promise<unknown>;
    readOrNull?: (key: RegistryKey) => Promise<unknown>;
    list?: (input: RegistryListInput) => Promise<RegistryListResult>;
  } = {},
): RegistryClientShape {
  const unexpected = async () => {
    throw new Error("unexpected read");
  };
  const read = vi.fn(impl.read ?? unexpected) as RegistryClientShape["read"];
  const readOrNull = vi.fn(
    impl.readOrNull ?? impl.read ?? unexpected,
  ) as RegistryClientShape["readOrNull"];
  const list = vi.fn(impl.list ?? (async () => listResult([]))) as RegistryClientShape["list"];
  return { read, readOrNull, list, history: vi.fn(async () => []) };
}

const registryConfig: RegistryConfig = { namespace: "dev.everything.near" };

describe("resolvePublishedRuntime", () => {
  it("treats a runtime with no extends as its own lineage root", async () => {
    const client = fakeClient();
    const result = await resolvePublishedRuntime(
      "pingpayio.near",
      "pingpay.io",
      {
        account: "pingpayio.near",
        domain: "pingpay.io",
      },
      registryConfig,
      client,
    );

    expect(result.lineage).toEqual({
      parent: null,
      root: "bos://pingpayio.near/pingpay.io",
      depth: 0,
      extendsChain: ["bos://pingpayio.near/pingpay.io"],
    });
    expect(client.read).not.toHaveBeenCalled();
  });

  it("derives lineage from production extends refs and merges inherited config", async () => {
    const client = fakeClient({
      read: vi.fn(async (key) => {
        if (key.ref === "bos://pingpayio.near/pingpay.io") {
          return {
            account: "pingpayio.near",
            domain: "pingpay.io",
            title: "PingPay",
            description: "Parent runtime",
            app: {
              ui: { production: "https://cdn.example.com/pingpay-ui" },
            },
          };
        }
        throw new Error(`Unexpected ref ${key.ref}`);
      }),
    });

    const result = await resolvePublishedRuntime(
      "pizza.pingpayio.near",
      "pizza.com",
      {
        extends: {
          development: "bos://local-parent.near/dev.local",
          production: "bos://pingpayio.near/pingpay.io",
        },
        account: "pizza.pingpayio.near",
        domain: "pizza.com",
        title: "Pizza",
      },
      registryConfig,
      client,
    );

    expect(result.lineage).toEqual({
      parent: "bos://pingpayio.near/pingpay.io",
      root: "bos://pingpayio.near/pingpay.io",
      depth: 1,
      extendsChain: ["bos://pizza.pingpayio.near/pizza.com", "bos://pingpayio.near/pingpay.io"],
    });
    expect(result.resolvedConfig.title).toBe("Pizza");
    expect(result.resolvedConfig.description).toBe("Parent runtime");
    expect(result.resolvedConfig.app?.ui).toEqual({
      production: "https://cdn.example.com/pingpay-ui",
    });
  });

  it("computes nested depth and root for grandchild runtimes", async () => {
    const configs: Record<string, unknown> = {
      "bos://pizza.pingpayio.near/pizza.com": {
        extends: "bos://pingpayio.near/pingpay.io",
        account: "pizza.pingpayio.near",
        domain: "pizza.com",
      },
      "bos://pingpayio.near/pingpay.io": {
        account: "pingpayio.near",
        domain: "pingpay.io",
      },
    };
    const client = fakeClient({
      read: vi.fn(async (key) => {
        const hit = configs[key.ref as string];
        if (!hit) throw new Error(`Unexpected ref ${key.ref}`);
        return hit;
      }),
    });

    const result = await resolvePublishedRuntime(
      "chicago.pizza.pingpayio.near",
      "pizza.com",
      {
        extends: "bos://pizza.pingpayio.near/pizza.com",
        account: "chicago.pizza.pingpayio.near",
        domain: "pizza.com",
      },
      registryConfig,
      client,
    );

    expect(result.lineage).toEqual({
      parent: "bos://pizza.pingpayio.near/pizza.com",
      root: "bos://pingpayio.near/pingpay.io",
      depth: 2,
      extendsChain: [
        "bos://chicago.pizza.pingpayio.near/pizza.com",
        "bos://pizza.pingpayio.near/pizza.com",
        "bos://pingpayio.near/pingpay.io",
      ],
    });
  });
});

describe("listRegistryApps", () => {
  it("lists registry apps with derived parent/root filters and lineage fields", async () => {
    const discovered = listResult([
      {
        key: "apps/pingpayio.near/pingpay.io/bos.config.json",
        value: {
          account: "pingpayio.near",
          domain: "pingpay.io",
          app: {
            host: { production: "https://host.example.com" },
            ui: { production: "https://cdn.example.com/root-ui" },
            api: { production: "https://api.example.com/root" },
          },
        },
      },
      {
        key: "apps/pizza.pingpayio.near/pizza.com/bos.config.json",
        value: {
          extends: "bos://pingpayio.near/pingpay.io",
          account: "pizza.pingpayio.near",
          domain: "pizza.com",
          app: {
            host: { production: "https://pizza.example.com/host" },
            ui: { production: "https://cdn.example.com/pizza-ui" },
            api: { production: "https://api.example.com/pizza" },
          },
        },
      },
      {
        key: "apps/chicago.pizza.pingpayio.near/pizza.com/bos.config.json",
        value: {
          extends: "bos://pizza.pingpayio.near/pizza.com",
          account: "chicago.pizza.pingpayio.near",
          domain: "pizza.com",
          app: {
            host: { production: "https://chicago.example.com/host" },
            ui: { production: "https://cdn.example.com/chicago-ui" },
            api: { production: "https://api.example.com/chicago" },
          },
        },
      },
    ]);
    const configs: Record<string, unknown> = {
      "bos://pingpayio.near/pingpay.io": {
        account: "pingpayio.near",
        domain: "pingpay.io",
        app: {
          host: { production: "https://host.example.com" },
          ui: { production: "https://cdn.example.com/root-ui" },
          api: { production: "https://api.example.com/root" },
        },
      },
      "bos://pizza.pingpayio.near/pizza.com": {
        extends: "bos://pingpayio.near/pingpay.io",
        account: "pizza.pingpayio.near",
        domain: "pizza.com",
        app: {
          host: { production: "https://pizza.example.com/host" },
          ui: { production: "https://cdn.example.com/pizza-ui" },
          api: { production: "https://api.example.com/pizza" },
        },
      },
    };
    const client = fakeClient({
      list: vi.fn(async () => discovered),
      read: vi.fn(async (key) => {
        const hit = configs[key.ref as string];
        if (!hit) throw new Error(`Unexpected ref ${key.ref}`);
        return hit;
      }),
    });

    const service = createRegistryMethods(registryConfig, client);
    const byParent = await service.listRegistryApps({
      parent: "bos://pingpayio.near/pingpay.io",
    });

    expect(byParent.data).toHaveLength(1);
    expect(byParent.data[0]).toMatchObject({
      accountId: "pizza.pingpayio.near",
      parent: "bos://pingpayio.near/pingpay.io",
      root: "bos://pingpayio.near/pingpay.io",
      depth: 1,
    });

    const byRoot = await service.listRegistryApps({ root: "bos://pingpayio.near/pingpay.io" });

    expect(byRoot.data).toHaveLength(3);
    expect(byRoot.data.map((item) => item.accountId)).toEqual([
      "chicago.pizza.pingpayio.near",
      "pingpayio.near",
      "pizza.pingpayio.near",
    ]);
    expect(
      byRoot.data.find((item) => item.accountId === "chicago.pizza.pingpayio.near"),
    ).toMatchObject({
      parent: "bos://pizza.pingpayio.near/pizza.com",
      root: "bos://pingpayio.near/pingpay.io",
      depth: 2,
    });

    const byAncestor = await service.listRegistryApps({
      ancestor: "bos://pizza.pingpayio.near/pizza.com",
    });

    expect(byAncestor.data).toHaveLength(1);
    expect(byAncestor.data[0]).toMatchObject({
      accountId: "chicago.pizza.pingpayio.near",
      parent: "bos://pizza.pingpayio.near/pizza.com",
      root: "bos://pingpayio.near/pingpay.io",
      depth: 2,
    });

    const wholeTreeFromRoot = await service.listRegistryApps({
      ancestor: "bos://pingpayio.near/pingpay.io",
    });

    expect(wholeTreeFromRoot.data.map((item) => item.accountId)).toEqual([
      "chicago.pizza.pingpayio.near",
      "pizza.pingpayio.near",
    ]);
  });
});

describe("registry listing resilience", () => {
  const good = {
    key: "apps/demo.near/good.dev/bos.config.json",
    value: {
      account: "demo.near",
      domain: "good.dev",
      extends: "bos://parent.near/root.dev",
    },
  };
  const bad = {
    key: "apps/demo.near/bad.dev/bos.config.json",
    value: { account: "demo.near", extends: "bos://missing.near/root.dev" },
  };
  const parent = { app: { host: { production: "https://good.dev" } } };

  function listingClient(
    discover: (input: RegistryListInput) => Promise<RegistryListResult>,
    read: (key: RegistryKey) => Promise<unknown> = async (key) => {
      if (key.ref === "bos://parent.near/root.dev") return parent;
      throw new Error("missing parent");
    },
  ) {
    return fakeClient({
      list: async (input) => (input.keyPrefix === "apps/" ? discover(input) : listResult([])),
      read,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    "list",
    "account",
    "host",
  ] as const)("isolates a broken runtime during %s lookup", async (method) => {
    const service = createRegistryMethods(
      registryConfig,
      listingClient(async () => listResult([bad, good])),
    );
    if (method === "host") {
      expect(await service.getRegistryAppByHost("https://good.dev")).toMatchObject({
        gatewayId: "good.dev",
      });
    } else {
      const result =
        method === "list"
          ? await service.listRegistryApps({ limit: 1 })
          : await service.getRegistryAppsByAccount("demo.near");
      expect(result.data.map((app) => app.gatewayId)).toEqual(["good.dev"]);
      expect(result.meta).toEqual({ total: 1, hasMore: false, nextCursor: null });
    }
    expect(console.warn).toHaveBeenCalled();
  });

  it("paginates and filters healthy apps after excluding broken runtimes", async () => {
    const second = {
      key: "apps/demo.near/next.dev/bos.config.json",
      value: { account: "demo.near", extends: good.value.extends },
    };
    const service = createRegistryMethods(
      registryConfig,
      listingClient(async () => listResult([bad, good, second])),
    );
    const first = await service.listRegistryApps({ parent: good.value.extends, limit: 1 });
    expect(first.data.map((app) => app.gatewayId)).toEqual(["good.dev"]);
    expect(first.meta).toEqual({ total: 2, hasMore: true, nextCursor: "1" });
    const next = await service.listRegistryApps({
      parent: good.value.extends,
      limit: 1,
      cursor: "1",
    });
    expect(next.data.map((app) => app.gatewayId)).toEqual(["next.dev"]);
    expect(next.meta).toEqual({ total: 2, hasMore: false, nextCursor: null });
  });

  it("returns an empty listing when every discovered runtime fails, including a circular extends chain", async () => {
    const cycle = {
      key: "apps/cycle.near/cycle.dev/bos.config.json",
      value: { extends: "bos://cycle.near/cycle.dev" },
    };
    const service = createRegistryMethods(
      registryConfig,
      listingClient(
        async () => listResult([bad, cycle]),
        async (key) => {
          if (key.ref === "bos://cycle.near/cycle.dev") return cycle.value;
          throw new Error("missing parent");
        },
      ),
    );
    expect(await service.listRegistryApps({})).toEqual({
      data: [],
      meta: { total: 0, hasMore: false, nextCursor: null },
    });
    expect(await service.getRegistryAppByHost("https://absent.dev")).toBeNull();
    await expect(service.getRegistryApp("demo.near", "bad.dev")).rejects.toThrow("missing parent");
  });

  it("deduplicates concurrent discovery and runtime resolution across listing paths", async () => {
    let release: (value: RegistryListResult) => void = () => {};
    const gate = new Promise<RegistryListResult>((resolve) => {
      release = resolve;
    });
    const discover = vi.fn(async () => gate);
    const client = listingClient(discover);
    const service = createRegistryMethods(registryConfig, client);
    const requests = [
      service.listRegistryApps({}),
      service.getRegistryAppsByAccount("demo.near"),
      service.getRegistryAppByHost("https://good.dev"),
    ];
    expect(discover).toHaveBeenCalledTimes(1);
    release(listResult([good]));
    await Promise.all(requests);
    await service.getRegistryApp("demo.near", "good.dev");
    await service.listRegistryApps({});
    expect(discover).toHaveBeenCalledTimes(1);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith({
      ref: "bos://dev.everything.near/dev.everything.near",
      keyPrefix: "apps/",
      limit: 200,
    });
  });

  it.each([
    registryConfig.namespace,
    "another.testnet",
  ])("keeps discovery and runtime caches scoped to each client instance (%s)", async (namespace) => {
    const first = createRegistryMethods(
      registryConfig,
      listingClient(async () => listResult([good])),
    );
    const otherEntry = {
      key: "apps/other.near/other.dev/bos.config.json",
      value: { account: "other.near", domain: "other.dev" },
    };
    const second = createRegistryMethods(
      { namespace },
      listingClient(async () => listResult([otherEntry])),
    );
    await first.listRegistryApps({});
    expect((await second.listRegistryApps({})).data.map((app) => app.accountId)).toEqual([
      "other.near",
    ]);
  });

  it("refreshes runtime parents after the TTL and serves last-good runtimes on transient failure", async () => {
    let fail = false;
    let host = "https://good.dev";
    const client = listingClient(
      async () => listResult([good]),
      async () => {
        if (fail) throw new Error("parent unavailable");
        return { app: { host: { production: host } } };
      },
    );
    const service = createRegistryMethods(registryConfig, client);
    expect((await service.listRegistryApps({})).data[0]?.hostUrl).toBe(host);
    await service.getRegistryAppsByAccount("demo.near");
    expect(client.read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    fail = true;
    expect((await service.listRegistryApps({})).data[0]?.hostUrl).toBe(host);
    expect(console.warn).toHaveBeenCalled();
    fail = false;
    host = "https://updated.dev";
    expect((await service.listRegistryApps({})).data[0]?.hostUrl).toBe(host);
    expect(client.read).toHaveBeenCalledTimes(3);
  });

  it("does not mask republished raw configuration with a still-fresh runtime cache", async () => {
    let entry = good;
    const client = listingClient(async () => listResult([entry]));
    const service = createRegistryMethods(registryConfig, client);
    await service.getRegistryStatus();
    vi.advanceTimersByTime(30_000);
    await service.listRegistryApps({});
    vi.advanceTimersByTime(30_001);
    entry = { ...good, value: { ...good.value, domain: "republished.dev" } };
    expect((await service.listRegistryApps({})).data[0]?.domain).toBe("republished.dev");
    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it("serves last-good discovery after refresh failure, without caching a partial page", async () => {
    let fail = false;
    const discover = vi.fn(async (input: RegistryListInput) => {
      if (fail) {
        if (input.pageToken) throw new Error("namespace unavailable");
        return { ...listResult([]), pageToken: "next" };
      }
      return listResult([good]);
    });
    const service = createRegistryMethods(registryConfig, listingClient(discover));
    await service.listRegistryApps({});
    vi.advanceTimersByTime(60_001);
    fail = true;
    expect((await service.listRegistryApps({})).data.map((app) => app.gatewayId)).toEqual([
      "good.dev",
    ]);
    expect(console.warn).toHaveBeenCalled();
    fail = false;
    expect((await service.listRegistryApps({})).data).toHaveLength(1);
    expect(discover).toHaveBeenCalledTimes(4);
  });

  it("does not turn a first-load discovery outage into an empty success or a permanently rejected refresh", async () => {
    let fail = true;
    const service = createRegistryMethods(
      registryConfig,
      listingClient(async () => {
        if (fail) throw new Error("namespace unavailable");
        return listResult([good]);
      }),
    );
    await expect(service.listRegistryApps({})).rejects.toThrow("namespace unavailable");
    fail = false;
    expect((await service.listRegistryApps({})).data).toHaveLength(1);
  });

  it("retries uncached broken runtimes without waiting for discovery to expire", async () => {
    let fail = true;
    const service = createRegistryMethods(
      registryConfig,
      listingClient(
        async () => listResult([good]),
        async () => {
          if (fail) throw new Error("parent unavailable");
          return parent;
        },
      ),
    );
    expect((await service.listRegistryApps({})).data).toEqual([]);
    fail = false;
    expect((await service.listRegistryApps({})).data).toHaveLength(1);
  });

  it("honors a successful empty refresh instead of serving removed apps", async () => {
    let entries = [good];
    const service = createRegistryMethods(
      registryConfig,
      listingClient(async () => listResult(entries)),
    );
    await service.listRegistryApps({});
    vi.advanceTimersByTime(60_001);
    entries = [];
    expect(await service.listRegistryApps({})).toEqual({
      data: [],
      meta: { total: 0, hasMore: false, nextCursor: null },
    });
    expect(await service.getRegistryApp("demo.near", "good.dev")).toBeNull();
    expect(await service.getRegistryAppByHost("https://good.dev")).toBeNull();
  });

  it("keeps empty discovery cached without fetching runtimes", async () => {
    const discover = vi.fn(async () => listResult([]));
    const client = listingClient(discover);
    const service = createRegistryMethods(registryConfig, client);
    expect((await service.listRegistryApps({})).data).toEqual([]);
    expect((await service.getRegistryAppsByAccount("absent.near")).data).toEqual([]);
    expect(await service.getRegistryAppByHost("https://absent.dev")).toBeNull();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(client.read).not.toHaveBeenCalled();
  });

  it("does not hide a healthy runtime when its optional metadata read fails", async () => {
    const client = listingClient(async () => listResult([good]));
    const list = client.list;
    client.list = vi.fn(async (input) => {
      if (input.keyPrefix !== "apps/") throw new Error("metadata unavailable");
      return list(input);
    });
    const service = createRegistryMethods(registryConfig, client);
    expect((await service.listRegistryApps({})).data[0]).toMatchObject({
      gatewayId: "good.dev",
      metadata: null,
    });
    expect(await service.getRegistryAppByHost("https://good.dev")).toMatchObject({
      metadata: null,
    });
  });
});

describe("prepareRegistryConfigWrite", () => {
  it("returns a prepared FastKV call matching the bos publish key and args", () => {
    const service = createRegistryMethods(registryConfig, fakeClient());
    const config = {
      account: "pingpayio.near",
      domain: "pingpay.io",
      app: {
        host: { production: "https://host.example.com" },
        ui: { production: "https://cdn.example.com/ui" },
        api: { production: "https://api.example.com" },
      },
    };

    const result = service.prepareRegistryConfigWrite({
      accountId: "pingpayio.near",
      gatewayId: "pingpay.io",
      config,
    });

    expect(result.contractId).toBe("dev.everything.near");
    expect(result.methodName).toBe("__fastdata_kv");
    expect(result.key).toBe("apps/pingpayio.near/pingpay.io/bos.config.json");
    expect(result.args[result.key]).toBe(JSON.stringify(config));
    expect(result.gas).toBe("300 Tgas");
    expect(result.attachedDeposit).toBe("0 yocto");
  });

  it("defaults the namespace to the primitive's mainnet default", () => {
    expect(DEFAULT_REGISTRY_NAMESPACE).toBe(registryNamespaceForNetwork("mainnet"));

    const service = createRegistryMethods({ namespace: DEFAULT_REGISTRY_NAMESPACE }, fakeClient());

    const result = service.prepareRegistryConfigWrite({
      accountId: "testing123.sputnik-dao.near",
      gatewayId: "citynode.app",
      config: { account: "testing123.sputnik-dao.near" },
    });

    expect(result.contractId).toBe(registryNamespaceForNetwork("mainnet"));
  });
});

describe("getManifest — the thin-tag read surface", () => {
  it("returns the manifest tag and, when asked, its version record", async () => {
    const tag = { version: "2.0.0-rc.31", digest: "abc123" };
    const record = { frameworkVersion: "2.0.0-rc.31" };
    const client = fakeClient({
      readOrNull: vi.fn(async (key) => {
        if (key.kind === "manifest") return tag;
        if (key.kind === "version" && key.version === "2.0.0-rc.31") return record;
        throw new Error(`Unexpected key ${key.kind}`);
      }),
    });
    const service = createRegistryMethods(registryConfig, client);

    const withoutRecord = await service.getManifest({ ref: "bos://a.everything.near/app.dev" });
    expect(withoutRecord).toEqual({
      ref: "bos://a.everything.near/app.dev",
      tag,
      versionRecord: null,
    });

    const withRecord = await service.getManifest({
      ref: "bos://a.everything.near/app.dev",
      includeVersionRecord: true,
    });
    expect(withRecord.versionRecord).toEqual(record);
  });

  it("a runtime with no manifest legs serves nulls — the dead-end shape", async () => {
    const client = fakeClient({ readOrNull: vi.fn(async () => null) });
    const service = createRegistryMethods(registryConfig, client);
    const result = await service.getManifest({
      ref: "bos://dev.everything.near/everything.dev",
      includeVersionRecord: true,
    });
    expect(result.tag).toBeNull();
    expect(result.versionRecord).toBeNull();
  });
});

describe("resolveRuntime — the resolution machine over the client", () => {
  it("Latest resolves from a thin tag + verified version record", async () => {
    const record = {
      schemaVersion: 1,
      kind: "everything-dev/platform-manifest",
      frameworkVersion: "2.0.0-rc.31",
      everyPluginVersion: "1.0.0",
      image: { ref: "ghcr.io/nearbuilders/everything-dev", tags: ["v2.0.0-rc.31"] },
      catalog: {},
      sharedDeps: {},
      templateInventory: [],
      compat: { minChild: "1.0.0" },
    };
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    const client = fakeClient({
      read: vi.fn(async () => ({ account: "a.everything.near", domain: "app.dev" })),
      readOrNull: vi.fn(async (key) => {
        if (key.kind === "runtimeConfig") {
          return { account: "a.everything.near", domain: "app.dev" };
        }
        if (key.kind === "manifest") return { version: "2.0.0-rc.31", digest };
        if (key.kind === "version") return record;
        return null;
      }),
    });
    const service = createRegistryMethods(registryConfig, client);

    const result = await service.resolveRuntime({ ref: "bos://a.everything.near/app.dev" });
    expect(result.outcome).toMatchObject({
      state: "Resolved",
      from: "manifest",
      provenance: "pointer",
    });
  });

  it("a pinned query names the release; a miss comes back Unresolved(absent)", async () => {
    const client = fakeClient({
      read: vi.fn(async () => ({ account: "a.everything.near", domain: "app.dev" })),
      readOrNull: vi.fn(async () => null),
    });
    const service = createRegistryMethods(registryConfig, client);

    const result = await service.resolveRuntime({
      ref: "bos://a.everything.near/app.dev",
      release: "9.9.9",
    });
    expect(result.outcome).toMatchObject({ state: "Unresolved", reason: "absent" });
    if (result.outcome.state === "Unresolved") {
      expect(result.outcome.detail).toContain("9.9.9");
    }
  });
});
