import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchBosConfigFromFastKvMock = vi.fn();
const listLatestValuesMock = vi.fn();
const readLatestValueMock = vi.fn();

vi.mock("../services/fastkv", async () => {
  const actual = await vi.importActual<typeof import("../services/fastkv")>("../services/fastkv");
  return {
    ...actual,
    fetchBosConfigFromFastKv: fetchBosConfigFromFastKvMock,
    listLatestValues: listLatestValuesMock,
    readLatestValue: readLatestValueMock,
  };
});

const { createRegistryMethods, resolvePublishedRuntime } = await import("../services/registry");

describe("resolvePublishedRuntime", () => {
  const registryConfig = { namespace: "dev.everything.near" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a runtime with no extends as its own lineage root", async () => {
    const result = await resolvePublishedRuntime(
      "pingpayio.near",
      "pingpay.io",
      {
        account: "pingpayio.near",
        domain: "pingpay.io",
      },
      registryConfig,
    );

    expect(result.lineage).toEqual({
      parent: null,
      root: "bos://pingpayio.near/pingpay.io",
      depth: 0,
      extendsChain: ["bos://pingpayio.near/pingpay.io"],
    });
    expect(fetchBosConfigFromFastKvMock).not.toHaveBeenCalled();
  });

  it("derives lineage from production extends refs and merges inherited config", async () => {
    fetchBosConfigFromFastKvMock.mockResolvedValueOnce({
      account: "pingpayio.near",
      domain: "pingpay.io",
      title: "PingPay",
      description: "Parent runtime",
      app: {
        ui: { production: "https://cdn.example.com/pingpay-ui" },
      },
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
    fetchBosConfigFromFastKvMock
      .mockResolvedValueOnce({
        extends: "bos://pingpayio.near/pingpay.io",
        account: "pizza.pingpayio.near",
        domain: "pizza.com",
      })
      .mockResolvedValueOnce({
        account: "pingpayio.near",
        domain: "pingpay.io",
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

  it("lists registry apps with derived parent/root filters and lineage fields", async () => {
    listLatestValuesMock
      .mockResolvedValueOnce({
        entries: [
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
        ],
        pageToken: null,
      })
      .mockResolvedValueOnce({ entries: [], pageToken: null });

    fetchBosConfigFromFastKvMock.mockImplementation(async (bosUrl: string) => {
      if (bosUrl === "bos://pingpayio.near/pingpay.io") {
        return {
          account: "pingpayio.near",
          domain: "pingpay.io",
          app: {
            host: { production: "https://host.example.com" },
            ui: { production: "https://cdn.example.com/root-ui" },
            api: { production: "https://api.example.com/root" },
          },
        };
      }

      if (bosUrl === "bos://pizza.pingpayio.near/pizza.com") {
        return {
          extends: "bos://pingpayio.near/pingpay.io",
          account: "pizza.pingpayio.near",
          domain: "pizza.com",
          app: {
            host: { production: "https://pizza.example.com/host" },
            ui: { production: "https://cdn.example.com/pizza-ui" },
            api: { production: "https://api.example.com/pizza" },
          },
        };
      }

      throw new Error(`Unexpected BOS URL ${bosUrl}`);
    });

    readLatestValueMock.mockResolvedValue(null);

    const service = createRegistryMethods(registryConfig);
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

describe("prepareRegistryConfigWrite", () => {
  const registryConfig = { namespace: "dev.everything.near" };

  it("returns a prepared FastKV call matching the bos publish key and args", () => {
    const service = createRegistryMethods(registryConfig);
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
});
