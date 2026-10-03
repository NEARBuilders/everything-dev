import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchConfigHistory } from "../../src/fastkv";
import { clearHttpCache } from "../../src/http-client";

beforeEach(() => {
  clearHttpCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function historyResponse(entries: unknown[]) {
  return new Response(JSON.stringify({ entries }), { status: 200 });
}

describe("fetchConfigHistory", () => {
  it("parses history entries and returns them newest-first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        historyResponse([
          {
            block_height: 100,
            block_timestamp: "1700000000000000000",
            tx_hash: "tx-old",
            value: JSON.stringify({ account: "a.near", generation: 1 }),
          },
          {
            block_height: 200,
            block_timestamp: "1700000100000000000",
            tx_hash: "tx-new",
            value: JSON.stringify({ account: "a.near", generation: 2 }),
          },
        ]),
      ),
    );

    const history = await fetchConfigHistory({
      accountId: "v1.citynode.near",
      gatewayId: "citynode.app",
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.blockHeight).toBe(200);
    expect(history[0]?.txHash).toBe("tx-new");
    expect(history[1]?.value).toEqual({ account: "a.near", generation: 1 });
  });

  it("requests the exact-key history endpoint for the registry namespace with the limit param", async () => {
    const fetchMock = vi.fn(async () => historyResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchConfigHistory({
      accountId: "v1.citynode.near",
      gatewayId: "citynode.app",
      limit: 20,
      registry: "dev.custom.registry",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://kv.main.fastnear.com/v0/history/dev.custom.registry/v1.citynode.near/apps%2Fv1.citynode.near%2Fcitynode.app%2Fbos.config.json?limit=20",
    );
  });

  it("caps the requested limit at the API maximum of 200", async () => {
    const fetchMock = vi.fn(async () => historyResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchConfigHistory({
      accountId: "v1.citynode.near",
      gatewayId: "citynode.app",
      limit: 5000,
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.endsWith("limit=200")).toBe(true);
  });

  it("returns an empty list when the key has no history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("null", { status: 200 })),
    );

    const history = await fetchConfigHistory({
      accountId: "v1.citynode.near",
      gatewayId: "citynode.app",
    });

    expect(history).toEqual([]);
  });

  it("parses string-encoded config values into objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        historyResponse([
          { block_height: 300, block_timestamp: "1", value: JSON.stringify({ account: "a" }) },
        ]),
      ),
    );

    const history = await fetchConfigHistory({
      accountId: "v1.citynode.near",
      gatewayId: "citynode.app",
    });

    expect(history[0]?.value).toEqual({ account: "a" });
  });
});
