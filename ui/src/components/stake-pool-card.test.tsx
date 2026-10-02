// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Near } from "near-kit";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StakePoolCard } from "./stake-pool-card";

vi.mock("@/app", () => ({
  useAuthClient: () => ({
    near: { getNearClient: () => new Near({ network: "mainnet" }) },
  }),
}));

const validator: ComponentProps<typeof StakePoolCard>["validator"] = {
  id: "pool",
  nodeId: "chicago",
  accountId: "chicago.poolv1.near",
  network: "mainnet",
  protocol: "near",
  role: "official",
  isDefault: true,
  metadata: { stakeUrl: "https://example.com/pool" },
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
};
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubPoolViews(
  values: Record<string, unknown>,
  failing: (method: string) => boolean = () => false,
) {
  return vi
    .spyOn(Near.prototype, "view")
    .mockImplementation((_contractId, method) =>
      failing(method)
        ? Promise.reject(new Error("RPC unavailable"))
        : Promise.resolve(values[method] === undefined ? null : values[method]),
    );
}

function renderCard(pool = validator) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <StakePoolCard validator={pool} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

describe("StakePoolCard", () => {
  it.each([
    "stats",
    "accounts",
  ])("replaces cached %s after a failed refresh and recovers when the RPC succeeds", async (failedQuery) => {
    const values: Record<string, unknown> = {
      get_total_staked_balance: "1000000000000000000000000",
      get_reward_fee_fraction: { numerator: 5, denominator: 100 },
      get_number_of_accounts: 1,
      get_accounts: [{ account_id: "staker.near", staked_balance: "2000000000000000000000000" }],
    };
    let failing = false;
    stubPoolViews(values, (method) => {
      const failMethod =
        failedQuery === "accounts" ? method === "get_accounts" : method !== "get_accounts";
      return failing && failMethod;
    });
    const { client } = renderCard();
    expect(await screen.findByText("1 NEAR")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "staker.near" })).toBeTruthy();

    failing = true;
    await act(() => client.invalidateQueries({ queryKey: ["stake-pool"] }));
    await waitFor(() =>
      expect(screen.getAllByText("—")).toHaveLength(failedQuery === "stats" ? 3 : 1),
    );
    expect(screen.getByRole("status")).toBeTruthy();
    if (failedQuery === "stats") {
      expect(screen.queryByText("1 NEAR")).toBeNull();
      expect(screen.queryByText("5%")).toBeNull();
      expect(screen.getByRole("link", { name: "staker.near" })).toBeTruthy();
    } else {
      expect(screen.getByText("1 NEAR")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "staker.near" })).toBeNull();
    }

    failing = false;
    await act(() => client.invalidateQueries({ queryKey: ["stake-pool"] }));
    expect(await screen.findByText("1 NEAR")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "staker.near" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByText("—")).toBeNull();
  });

  it.each([
    { ...validator, protocol: "ethereum" },
    { ...validator, network: "localnet" },
  ])("does not query unsupported protocol/network: $protocol/$network", (pool) => {
    const view = stubPoolViews({});
    renderCard({ ...pool, metadata: { stakeUrl: "javascript:alert(1)" } });
    expect(screen.getByText(/Live stats/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(view).not.toHaveBeenCalled();
  });

  it("shows unavailable metrics while keeping a successful empty account response", async () => {
    stubPoolViews({ get_accounts: [] }, (method) => method !== "get_accounts");
    renderCard();
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("Some pool data is unavailable"),
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("No stakers yet.")).toBeTruthy();
    expect(screen.queryByText("0 NEAR")).toBeNull();
  });

  it("preserves valid zero metrics when the account list fails and uses testnet links", async () => {
    const responses: Record<string, unknown> = {
      get_total_staked_balance: "0",
      get_reward_fee_fraction: { numerator: 0, denominator: 100 },
      get_number_of_accounts: 0,
    };
    stubPoolViews(responses, (method) => responses[method] === undefined);
    renderCard({ ...validator, network: "testnet" });
    expect(await screen.findByText("0 NEAR")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View account on Nearblocks" }).getAttribute("href"),
    ).toContain("https://testnet.nearblocks.io/");
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("moves from skeletons to live stats and shows five sorted accounts before expansion", async () => {
    const values: Record<string, unknown> = {
      get_total_staked_balance: "12345678900000000000000000000",
      get_reward_fee_fraction: { numerator: 5, denominator: 100 },
      get_number_of_accounts: 60,
      get_accounts: Array.from({ length: 6 }, (_, i) => ({
        account_id: `staker-${i}.near`,
        staked_balance: String(BigInt(i + 1) * 10n ** 24n),
      })),
    };
    stubPoolViews(values);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderCard();
    expect(screen.getByLabelText("Loading Total staked")).toBeTruthy();
    expect(await screen.findByText("12,345.6789 NEAR")).toBeTruthy();
    expect(screen.getByText("5%")).toBeTruthy();
    expect(screen.getByText("60")).toBeTruthy();
    const firstAccounts = screen.getByRole("list", { name: "Top stakers" });
    expect(within(firstAccounts).getAllByRole("listitem")).toHaveLength(5);
    expect(within(firstAccounts).getAllByRole("listitem")[0].textContent).toContain(
      "staker-5.near",
    );
    expect(screen.getByText("Show 1 more").closest("details")?.open).toBe(false);
    expect(screen.getByText(/Top 5 of 6 sampled from 60/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View account on Nearblocks" }).getAttribute("href"),
    ).toBe("https://nearblocks.io/address/chicago.poolv1.near");
    expect(screen.getByRole("link", { name: "View pool on explorer" }).getAttribute("href")).toBe(
      "https://example.com/pool",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy pool account" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(validator.accountId));
    expect(await screen.findByRole("button", { name: "Copied pool account" })).toBeTruthy();
  });
});
