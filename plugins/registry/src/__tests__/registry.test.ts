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

const DISCOVERY_PREFIX = "apps/";

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

describe("listRegistryApps resilience", () => {
  const configEntry = (accountId: string, gatewayId: string, value: unknown) => ({
    key: `apps/${accountId}/${gatewayId}/bos.config.json`,
    value,
  });

  const readyApp = (accountId: string, gatewayId: string, extra: Record<string, unknown> = {}) => ({
    account: accountId,
    domain: gatewayId,
    app: {
      host: { production: `https://${gatewayId}/host` },
      ui: { production: `https://${gatewayId}/ui` },
    },
    ...extra,
  });

  const discoveryList = (entries: Array<{ key: string; value: unknown }>) =>
    vi.fn(async (input: RegistryListInput) =>
      input.keyPrefix === DISCOVERY_PREFIX ? listResult(entries) : listResult([]),
    );

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips an app whose parent cannot be resolved and returns the rest", async () => {
    const client = fakeClient({
      list: discoveryList([
        configEntry("good.near", "good.com", readyApp("good.near", "good.com")),
        configEntry(
          "bad.near",
          "bad.com",
          readyApp("bad.near", "bad.com", { extends: "bos://missing.near/x.com" }),
        ),
      ]),
      read: vi.fn(async () => {
        throw new Error("No config found");
      }),
    });

    const service = createRegistryMethods(registryConfig, client);
    const result = await service.listRegistryApps({});

    expect(result.data.map((item) => item.accountId)).toEqual(["good.near"]);
    expect(result.meta.total).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("bad.near/bad.com"));
  });

  it("dedupes concurrent discovery and caches resolved runtimes", async () => {
    const list = discoveryList([
      configEntry(
        "child.near",
        "child.com",
        readyApp("child.near", "child.com", { extends: "bos://parent.near/parent.com" }),
      ),
    ]);
    const read = vi.fn(async () => readyApp("parent.near", "parent.com"));
    const client = fakeClient({ list, read });

    const service = createRegistryMethods(registryConfig, client);
    const [first, second] = await Promise.all([
      service.listRegistryApps({}),
      service.listRegistryApps({}),
    ]);

    expect(first.data.map((item) => item.accountId)).toEqual(["child.near"]);
    expect(second.data.map((item) => item.accountId)).toEqual(["child.near"]);
    expect(list.mock.calls.filter(([input]) => input?.keyPrefix === DISCOVERY_PREFIX)).toHaveLength(
      1,
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("serves stale discovery when a later refresh fails", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    let sourceFails = false;
    const list = vi.fn(async (input: RegistryListInput) => {
      if (input.keyPrefix !== DISCOVERY_PREFIX) return listResult([]);
      if (sourceFails) throw new Error("listing flaked");
      return listResult([configEntry("good.near", "good.com", readyApp("good.near", "good.com"))]);
    });
    const client = fakeClient({ list });

    const service = createRegistryMethods(registryConfig, client);
    const first = await service.listRegistryApps({});
    expect(first.data.map((item) => item.accountId)).toEqual(["good.near"]);

    sourceFails = true;
    now.mockReturnValue(1_000_000 + 60_001);
    const second = await service.listRegistryApps({});

    expect(second.data.map((item) => item.accountId)).toEqual(["good.near"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("serving cached entries"));
  });

  it("serves the last good runtime when a re-resolve fails", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    let parentReadFails = false;
    const read = vi.fn(async () => {
      if (parentReadFails) throw new Error("parent read flaked");
      return readyApp("parent.near", "parent.com");
    });
    const client = fakeClient({
      list: discoveryList([
        configEntry(
          "child.near",
          "child.com",
          readyApp("child.near", "child.com", { extends: "bos://parent.near/parent.com" }),
        ),
      ]),
      read,
    });

    const service = createRegistryMethods(registryConfig, client);
    const first = await service.listRegistryApps({});
    expect(first.data.map((item) => item.accountId)).toEqual(["child.near"]);

    parentReadFails = true;
    now.mockReturnValue(2_000_000 + 60_001);
    const second = await service.listRegistryApps({});

    expect(second.data.map((item) => item.accountId)).toEqual(["child.near"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("serving cached runtime"));
  });

  it("rebuilds a cached runtime after the app republishes a new config", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(3_000_000);
    let republished = false;
    const list = vi.fn(async (input: RegistryListInput) => {
      if (input.keyPrefix !== DISCOVERY_PREFIX) return listResult([]);
      return listResult([
        configEntry(
          "child.near",
          "child.com",
          readyApp("child.near", "child.com", {
            extends: republished ? "bos://parent-b.near/b.com" : "bos://parent-a.near/a.com",
          }),
        ),
      ]);
    });
    const client = fakeClient({
      list,
      read: vi.fn(async (key) =>
        key.ref === "bos://parent-a.near/a.com"
          ? readyApp("parent-a.near", "a.com")
          : readyApp("parent-b.near", "b.com"),
      ),
    });

    const service = createRegistryMethods(registryConfig, client);
    const first = await service.listRegistryApps({});
    expect(first.data[0]?.parent).toBe("bos://parent-a.near/a.com");

    republished = true;
    now.mockReturnValue(3_000_000 + 60_001);
    const second = await service.listRegistryApps({});

    expect(second.data[0]?.parent).toBe("bos://parent-b.near/b.com");
  });

  it("does not serve a runtime cached from an older config when the republished one fails", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(4_000_000);
    let republished = false;
    const list = vi.fn(async (input: RegistryListInput) => {
      if (input.keyPrefix !== DISCOVERY_PREFIX) return listResult([]);
      return listResult([
        configEntry(
          "child.near",
          "child.com",
          readyApp("child.near", "child.com", {
            extends: republished ? "bos://missing.near/x.com" : "bos://parent-a.near/a.com",
          }),
        ),
      ]);
    });
    const client = fakeClient({
      list,
      read: vi.fn(async (key) => {
        if (key.ref === "bos://parent-a.near/a.com") {
          return readyApp("parent-a.near", "a.com");
        }
        throw new Error("No config found");
      }),
    });

    const service = createRegistryMethods(registryConfig, client);
    const first = await service.listRegistryApps({});
    expect(first.data[0]?.parent).toBe("bos://parent-a.near/a.com");

    republished = true;
    now.mockReturnValue(4_000_000 + 60_001);
    const second = await service.listRegistryApps({});

    expect(second.data).toEqual([]);
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("serving cached runtime"),
    );
    await expect(service.getRegistryApp("child.near", "child.com")).rejects.toThrow(
      "No config found",
    );
  });

  it("reports a discovery outage instead of not found for single-app lookups", async () => {
    const client = fakeClient({
      list: vi.fn(async (input: RegistryListInput) => {
        if (input.keyPrefix !== DISCOVERY_PREFIX) return listResult([]);
        throw new Error("listing down");
      }),
    });
    const service = createRegistryMethods(registryConfig, client);

    await expect(service.getRegistryApp("good.near", "good.com")).rejects.toThrow("listing down");
    await expect(service.getRegistryAppByHost("https://good.com/host")).rejects.toThrow(
      "listing down",
    );
    await expect(service.listRegistryApps({})).rejects.toThrow("listing down");
  });

  it("still returns not found when discovery succeeds and the app is absent", async () => {
    const service = createRegistryMethods(registryConfig, fakeClient());

    await expect(service.getRegistryApp("good.near", "good.com")).resolves.toBeNull();
    await expect(service.getRegistryAppByHost("https://good.com/host")).resolves.toBeNull();
  });

  it("returns the app with null metadata when the metadata read fails", async () => {
    const client = fakeClient({
      list: vi.fn(async (input: RegistryListInput) => {
        if (input.keyPrefix !== DISCOVERY_PREFIX) throw new Error("metadata read flaked");
        return listResult([
          configEntry("good.near", "good.com", readyApp("good.near", "good.com")),
        ]);
      }),
    });

    const service = createRegistryMethods(registryConfig, client);
    const result = await service.listRegistryApps({});

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.metadata).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("metadata read for good.near/good.com failed"),
    );
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
