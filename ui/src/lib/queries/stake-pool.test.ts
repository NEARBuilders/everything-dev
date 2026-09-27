import { QueryClient } from "@tanstack/react-query";
import { Near } from "near-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "@/app";
import {
  formatNearBalance,
  formatPoolFee,
  invalidateStakePoolQueries,
  resolveTeamStakeTarget,
  stakePoolAccountQueryOptions,
  stakePoolStatsQueryOptions,
  stakePoolTopHoldersQueryOptions,
} from "./stake-pool";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The app's auth client owns the per-network near clients; the tests hand a
 * lightweight stand-in whose getNearClient returns real (wallet-less) Near
 * instances so the Near.prototype.view spy intercepts every call. */
function fakeAuthClient(): AuthClient {
  const clients = new Map<string, Near>();
  return {
    near: {
      getNearClient: (network?: "mainnet" | "testnet") => {
        const net = network ?? "mainnet";
        let client = clients.get(net);
        if (!client) {
          client = new Near({ network: net });
          clients.set(net, client);
        }
        return client;
      },
    },
  } as unknown as AuthClient;
}

describe("stake pool queries", () => {
  it("fetches at most 50 standard pool accounts and sorts their bigint stakes descending", async () => {
    const accounts = Array.from({ length: 55 }, (_, i) => ({
      account_id: `staker-${i}.near`,
      staked_balance: String(BigInt(i) * 10n ** 24n),
    }));
    const view = vi.spyOn(Near.prototype, "view").mockResolvedValue(accounts);
    const client = new QueryClient();
    const holders = await client.fetchQuery(
      stakePoolTopHoldersQueryOptions({
        accountId: "pool.near",
        authClient: fakeAuthClient(),
        limit: 80,
      }),
    );
    expect(holders).toHaveLength(50);
    expect(holders[0]).toEqual({
      accountId: "staker-49.near",
      stakedBalance: 49000000000000000000000000n,
    });
    expect(holders.at(-1)).toEqual({ accountId: "staker-0.near", stakedBalance: 0n });
    expect(view).toHaveBeenCalledWith("pool.near", "get_accounts", { from_index: 0, limit: 50 });
    client.clear();
  });

  it("isolates network and page-limit caches and disables unsupported pools", () => {
    const options = {
      accountId: "pool.near",
      authClient: fakeAuthClient(),
      network: "mainnet" as const,
    };
    expect(stakePoolStatsQueryOptions(options).queryKey).toEqual([
      "stake-pool",
      "pool.near",
      "mainnet",
      "stats",
    ]);
    expect(stakePoolTopHoldersQueryOptions(options).queryKey).toEqual([
      "stake-pool",
      "pool.near",
      "mainnet",
      "top-holders",
    ]);
    expect(stakePoolTopHoldersQueryOptions({ ...options, limit: 5 }).queryKey).not.toEqual(
      stakePoolTopHoldersQueryOptions(options).queryKey,
    );
    expect(stakePoolStatsQueryOptions({ ...options, network: "testnet" }).queryKey).not.toEqual(
      stakePoolStatsQueryOptions(options).queryKey,
    );
    for (const makeOptions of [stakePoolStatsQueryOptions, stakePoolTopHoldersQueryOptions]) {
      expect(makeOptions(options).staleTime).toBe(300_000);
      expect(makeOptions({ ...options, protocol: "ethereum" }).enabled).toBe(false);
      expect(makeOptions({ ...options, accountId: "" }).enabled).toBe(false);
      expect(makeOptions({ ...options, network: "localnet" as never }).enabled).toBe(false);
    }
  });

  it("invalidates every page variant for the executed pool and network only", async () => {
    const client = new QueryClient();
    const affected = [
      ["stake-pool", "pool.near", "mainnet", "stats"],
      ["stake-pool", "pool.near", "mainnet", "top-holders"],
      ["stake-pool", "pool.near", "mainnet", "top-holders", 5],
      ["stake-pool", "pool.near", "mainnet", "account", "india.sputnik-dao.near"],
    ];
    const untouched = [
      ["stake-pool", "pool.near", "testnet", "stats"],
      ["stake-pool", "other.near", "mainnet", "stats"],
    ];
    for (const key of [...affected, ...untouched]) client.setQueryData(key, []);

    await invalidateStakePoolQueries(client, "pool.near", "mainnet");

    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of untouched) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("keeps unavailable stats distinct from a valid empty account list", async () => {
    const view = vi.spyOn(Near.prototype, "view").mockRejectedValue(new Error("Unavailable"));
    const client = new QueryClient();
    await expect(
      client.fetchQuery(
        stakePoolStatsQueryOptions({ accountId: "pool.near", authClient: fakeAuthClient() }),
      ),
    ).rejects.toThrow();
    await expect(
      client.fetchQuery(
        stakePoolTopHoldersQueryOptions({ accountId: "pool.near", authClient: fakeAuthClient() }),
      ),
    ).rejects.toThrow();
    view.mockResolvedValue([]);
    expect(
      await client.fetchQuery(
        stakePoolTopHoldersQueryOptions({ accountId: "pool.near", authClient: fakeAuthClient() }),
      ),
    ).toEqual([]);
    client.clear();
  });

  it("reads and formats standard pool stats without losing balance precision", async () => {
    const responses: Record<string, unknown> = {
      get_total_staked_balance: "12345678900000000000000000000",
      get_reward_fee_fraction: { numerator: 5, denominator: 100 },
      get_number_of_accounts: 60,
    };
    const view = vi
      .spyOn(Near.prototype, "view")
      .mockImplementation((_contractId: string, methodName: string) =>
        Promise.resolve(responses[methodName]),
      );
    const client = new QueryClient();
    const stats = await client.fetchQuery(
      stakePoolStatsQueryOptions({
        accountId: "pool.near",
        authClient: fakeAuthClient(),
        network: "mainnet",
      }),
    );
    expect(stats).toEqual({
      totalStaked: 12345678900000000000000000000n,
      feeNumerator: 5,
      feeDenominator: 100,
      stakerCount: 60,
    });
    expect(formatNearBalance(stats.totalStaked)).toBe("12,345.6789 NEAR");
    expect(formatNearBalance(9007199254740993123456789000000000000000n)).toBe(
      "9,007,199,254,740,993.1235 NEAR",
    );
    expect(formatNearBalance(999999999999999999999999n)).toBe("1 NEAR");
    expect(formatNearBalance(0n)).toBe("0 NEAR");
    expect(formatPoolFee(stats.feeNumerator, stats.feeDenominator)).toBe("5%");
    expect(view).toHaveBeenCalledTimes(3);
    client.clear();
  });
});

const pools = [
  {
    accountId: "other.poolv1.near",
    network: "testnet",
    protocol: "near",
    isDefault: false,
  },
  {
    accountId: "india.poolv1.near",
    network: "mainnet",
    protocol: "near",
    isDefault: true,
  },
];

describe("team stake target", () => {
  it("prefers the org DAO and the default staking pool", () => {
    expect(
      resolveTeamStakeTarget({
        daoAccountId: "india.sputnik-dao.near",
        tenantAccountId: "tenant.near",
        tenantOwnerKind: "dao",
        validators: pools,
      }),
    ).toEqual({
      teamAccountId: "india.sputnik-dao.near",
      poolAccountId: "india.poolv1.near",
      network: "mainnet",
      protocol: "near",
    });
  });

  it("falls back to a DAO-owned tenant account and the first pool when none is default", () => {
    expect(
      resolveTeamStakeTarget({
        daoAccountId: "  ",
        tenantAccountId: "india.sputnik-dao.near",
        tenantOwnerKind: "dao",
        validators: pools.filter((pool) => !pool.isDefault),
      }),
    ).toEqual({
      teamAccountId: "india.sputnik-dao.near",
      poolAccountId: "other.poolv1.near",
      network: "testnet",
      protocol: "near",
    });
  });

  it("does not treat a platform tenant account as the team and needs both a team and a pool", () => {
    expect(
      resolveTeamStakeTarget({
        tenantAccountId: "platform.near",
        tenantOwnerKind: "platform",
        validators: pools,
      }),
    ).toBeNull();
    expect(
      resolveTeamStakeTarget({
        daoAccountId: "india.sputnik-dao.near",
        validators: [],
      }),
    ).toBeNull();
  });
});

describe("team stake pool account query", () => {
  it("reads the team account's stake from get_account, not the pool total", async () => {
    vi.spyOn(Near.prototype, "view").mockImplementation(
      (_contractId: string, methodName: string, args?: object) => {
        expect(methodName).toBe("get_account");
        expect(args).toEqual({ account_id: "india.sputnik-dao.near" });
        return Promise.resolve({
          account_id: "india.sputnik-dao.near",
          staked_balance: "2500000000000000000000000",
          unstaked_balance: "1000000000000000000000000",
          can_withdraw: false,
        });
      },
    );
    const client = new QueryClient();
    const account = await client.fetchQuery(
      stakePoolAccountQueryOptions({
        poolAccountId: "india.poolv1.near",
        stakerAccountId: "india.sputnik-dao.near",
        authClient: fakeAuthClient(),
        network: "mainnet",
      }),
    );
    expect(account).toEqual({
      accountId: "india.sputnik-dao.near",
      stakedBalance: 2500000000000000000000000n,
      unstakedBalance: 1000000000000000000000000n,
      canWithdraw: false,
    });
    expect(formatNearBalance(account.stakedBalance)).toBe("2.5 NEAR");
    client.clear();
  });

  it("isolates staker caches and stays disabled without a pool or team account", () => {
    const options = {
      poolAccountId: "india.poolv1.near",
      stakerAccountId: "india.sputnik-dao.near",
      authClient: fakeAuthClient(),
      network: "mainnet" as const,
    };
    expect(stakePoolAccountQueryOptions(options).queryKey).toEqual([
      "stake-pool",
      "india.poolv1.near",
      "mainnet",
      "account",
      "india.sputnik-dao.near",
    ]);
    expect(
      stakePoolAccountQueryOptions({ ...options, stakerAccountId: "other.near" }).queryKey,
    ).not.toEqual(stakePoolAccountQueryOptions(options).queryKey);
    expect(stakePoolAccountQueryOptions(options).staleTime).toBe(300_000);
    expect(stakePoolAccountQueryOptions({ ...options, protocol: "ethereum" }).enabled).toBe(false);
    expect(stakePoolAccountQueryOptions({ ...options, poolAccountId: "" }).enabled).toBe(false);
    expect(stakePoolAccountQueryOptions({ ...options, stakerAccountId: "" }).enabled).toBe(false);
    expect(stakePoolAccountQueryOptions({ ...options, network: "localnet" as never }).enabled).toBe(
      false,
    );
  });
});
