// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "@/app";
import { stakePoolQueryKeys } from "@/lib/queries/stake-pool";
import { useStakeMutation } from "./-stake-mutations";
import { StakeOnramp } from "./-stake-onramp";

const harness = vi.hoisted(() => ({
  close: vi.fn(),
  initiate: vi.fn(),
  options: null as { destinationAddress?: string; onPopupClose: () => void } | null,
  accountId: "alice.near" as string | null,
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: harness.error,
    success: harness.success,
    warning: harness.warning,
  },
}));

vi.mock("@/lib/use-near-account", () => ({
  useNearAccount: () => harness.accountId,
}));

vi.mock("@pingpay/onramp-sdk", () => ({
  PingpayOnramp: class {
    constructor(options: { destinationAddress?: string; onPopupClose: () => void }) {
      harness.options = options;
    }

    initiateOnramp = harness.initiate;

    close = harness.close;
  },
  PingpayOnrampError: class extends Error {},
}));

afterEach(() => {
  cleanup();
  harness.close.mockReset();
  harness.initiate.mockReset();
  harness.options = null;
  harness.accountId = "alice.near";
  harness.success.mockReset();
  harness.error.mockReset();
  harness.warning.mockReset();
});

function authWithTransaction(
  send: ReturnType<typeof vi.fn>,
  network: "mainnet" | "testnet" = "testnet",
) {
  const functionCall = vi.fn(() => ({ send }));
  const transaction = vi.fn(() => ({ functionCall }));
  const getNearClient = vi.fn(() => ({ transaction }));
  const auth = {
    near: {
      ensureConnected: vi.fn(async () => true),
      getAccountId: vi.fn(() => "alice.near"),
      getNetwork: vi.fn(() => network),
      getNearClient,
    },
  } as unknown as AuthClient;
  return { auth, functionCall, transaction, getNearClient };
}

function withQueryClient(queryClient: QueryClient) {
  return function QueryClientHarness({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("stake transaction behavior", () => {
  it("captures the selected pool and network and refreshes every affected pool query", async () => {
    const send = vi.fn(async () => ({ transaction: { hash: "stake-tx" } }));
    const { auth, functionCall, transaction } = authWithTransaction(send);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const affectedStats = stakePoolQueryKeys.stats("pool.testnet", "testnet");
    const affectedTopHolders = stakePoolQueryKeys.topHolders("pool.testnet", "testnet", 10);
    const unrelatedStats = stakePoolQueryKeys.stats("pool.mainnet", "mainnet");
    queryClient.setQueryData(affectedStats, { totalStaked: 1n });
    queryClient.setQueryData(affectedTopHolders, []);
    queryClient.setQueryData(unrelatedStats, { totalStaked: 2n });

    const { result } = renderHook(() => useStakeMutation(auth, queryClient), {
      wrapper: withQueryClient(queryClient),
    });
    await act(async () => {
      result.current.mutate({
        amount: 2_000_000_000_000_000_000_000_000n,
        network: "testnet",
        poolAccountId: "pool.testnet",
        protocol: "near",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(transaction).toHaveBeenCalledWith("alice.near");
    expect(functionCall).toHaveBeenCalledWith(
      "pool.testnet",
      "deposit_and_stake",
      {},
      { gas: "300000000000000", attachedDeposit: 2_000_000_000_000_000_000_000_000n },
    );
    expect(send).toHaveBeenCalledWith({ waitUntil: "FINAL" });
    expect(queryClient.getQueryState(affectedStats)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(affectedTopHolders)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelatedStats)?.isInvalidated).toBe(false);
    expect(harness.success).toHaveBeenCalledWith("Staked", { description: "tx: stake-tx" });
  });

  it("does not invalidate pool queries when the wallet transaction is rejected", async () => {
    const send = vi.fn(async () => {
      throw new Error("User rejected the transaction");
    });
    const { auth } = authWithTransaction(send);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const poolStats = stakePoolQueryKeys.stats("pool.testnet", "testnet");
    queryClient.setQueryData(poolStats, { totalStaked: 1n });
    const { result } = renderHook(() => useStakeMutation(auth, queryClient), {
      wrapper: withQueryClient(queryClient),
    });

    await act(async () => {
      result.current.mutate({
        amount: 1n,
        network: "testnet",
        poolAccountId: "pool.testnet",
        protocol: "near",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryState(poolStats)?.isInvalidated).toBe(false);
    expect(harness.error).toHaveBeenCalledWith("User rejected the transaction");
  });

  it("does not send a transaction when the wallet network differs from the selected pool", async () => {
    const send = vi.fn(async () => ({ transaction: { hash: "stake-tx" } }));
    const { auth, getNearClient } = authWithTransaction(send, "mainnet");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useStakeMutation(auth, queryClient), {
      wrapper: withQueryClient(queryClient),
    });

    await act(async () => {
      result.current.mutate({
        amount: 1n,
        network: "testnet",
        poolAccountId: "pool.testnet",
        protocol: "near",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getNearClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith("Switch your wallet to testnet before staking.");
  });

  it("rejects unsupported validators before connecting or sending", async () => {
    const send = vi.fn(async () => ({ transaction: { hash: "stake-tx" } }));
    const { auth, getNearClient } = authWithTransaction(send);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useStakeMutation(auth, queryClient), {
      wrapper: withQueryClient(queryClient),
    });

    await act(async () => {
      result.current.mutate({
        amount: 1n,
        network: "testnet",
        poolAccountId: "pool.testnet",
        protocol: "ethereum",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(auth.near.ensureConnected).not.toHaveBeenCalled();
    expect(getNearClient).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith("Only NEAR validators can receive NEAR stakes.");
  });

  it("rejects non-positive stake amounts before connecting", async () => {
    const send = vi.fn(async () => ({ transaction: { hash: "stake-tx" } }));
    const { auth, getNearClient } = authWithTransaction(send);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useStakeMutation(auth, queryClient), {
      wrapper: withQueryClient(queryClient),
    });

    await act(async () => {
      result.current.mutate({
        amount: 0n,
        network: "testnet",
        poolAccountId: "pool.testnet",
        protocol: "near",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(auth.near.ensureConnected).not.toHaveBeenCalled();
    expect(getNearClient).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith("Enter a positive stake amount.");
  });
});

describe("stake onramp", () => {
  it("passes the connected account to PingPay and closes the SDK on unmount", async () => {
    harness.initiate.mockResolvedValue({ depositAddress: "alice.near" });
    const queryClient = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <StakeOnramp />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buy NEAR with PingPay" }));
    await waitFor(() =>
      expect(harness.initiate).toHaveBeenCalledWith({ chain: "NEAR", asset: "NEAR" }),
    );
    expect(harness.options?.destinationAddress).toBe("alice.near");
    unmount();
    expect(harness.close).toHaveBeenCalledTimes(1);
  });
});
