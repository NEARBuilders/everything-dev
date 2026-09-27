// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./relayer";

const mocks = vi.hoisted(() => ({
  auth: null as RelayerHarness["auth"] | null,
  nearAccount: "wallet.near" as string | null,
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/app", () => ({
  useAuthClient: () => mocks.auth,
}));

vi.mock("@/lib/auth", () => ({
  useAuthClient: () => mocks.auth,
}));

vi.mock("@/lib/use-near-account", () => ({
  useNearAccount: () => mocks.nearAccount,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.success(...args),
    error: (...args: unknown[]) => mocks.error(...args),
  },
}));

type HistoryResponse = {
  data: {
    transactions: Array<{
      id: string;
      userId: string;
      txHash: string;
      senderId: string;
      receiverId: string;
      network: string;
      status: "completed" | "failed" | "pending";
      createdAt: string;
    }>;
  };
};

type RelayerHarness = {
  auth: {
    near: {
      ensureConnected: ReturnType<typeof vi.fn>;
      getAccountId: ReturnType<typeof vi.fn>;
      getNearClient: ReturnType<typeof vi.fn>;
      getRelayerInfo: ReturnType<typeof vi.fn>;
      relayHistory: ReturnType<typeof vi.fn>;
    };
  };
  history: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  transfer: ReturnType<typeof vi.fn>;
  getNearClient: ReturnType<typeof vi.fn>;
  queryClient: QueryClient;
};

const relayerInfo = {
  accountId: "relayer.near",
  enabled: false,
  mode: "ephemeral",
};

const fundedHistory: HistoryResponse = {
  data: {
    transactions: [
      {
        id: "relay-1",
        userId: "admin-1",
        txHash: "abcdef1234567890",
        senderId: "wallet.near",
        receiverId: "relayer.near",
        network: "mainnet",
        status: "completed",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ],
  },
};

function createHarness({
  ensureConnected = true,
  sendResult = { transaction: { hash: "funding-hash" } },
  sendError,
}: {
  ensureConnected?: boolean;
  sendResult?: { transaction?: { hash?: string } };
  sendError?: Error;
} = {}): RelayerHarness {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = vi.fn<() => Promise<HistoryResponse>>();
  history.mockResolvedValueOnce({ data: { transactions: [] } }).mockResolvedValue(fundedHistory);
  const send = vi.fn(async () => {
    if (sendError) throw sendError;
    return sendResult;
  });
  const transfer = vi.fn(() => ({ send }));
  const getNearClient = vi.fn(() => ({
    transaction: vi.fn(() => ({ transfer })),
  }));
  const auth = {
    near: {
      ensureConnected: vi.fn(async () => ensureConnected),
      getAccountId: vi.fn(() => "wallet.near"),
      getNearClient,
      getRelayerInfo: vi.fn(async () => ({ data: relayerInfo, error: null })),
      relayHistory: history,
    },
  };
  return { auth, history, send, transfer, getNearClient, queryClient };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderRelayer(current: RelayerHarness) {
  mocks.auth = current.auth;
  const Component = Route.options.component;
  if (!Component) throw new Error("Relayer route has no component");
  render(
    <QueryClientProvider client={current.queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.auth = null;
  mocks.nearAccount = "wallet.near";
  vi.clearAllMocks();
});

describe("relayer funding flow", () => {
  it("does not transfer or refresh caches when wallet connection is declined", async () => {
    const current = createHarness({ ensureConnected: false });
    const invalidateQueries = vi.spyOn(current.queryClient, "invalidateQueries");
    renderRelayer(current);

    await screen.findByText("relayer.near");
    await screen.findByRole("button", { name: "Fund relayer" });
    const initialHistoryCalls = current.history.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Fund relayer" }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Connect a NEAR wallet first"));
    expect(current.getNearClient).not.toHaveBeenCalled();
    expect(current.transfer).not.toHaveBeenCalled();
    expect(current.history).toHaveBeenCalledTimes(initialHistoryCalls);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("sends the exact transfer with finality and refreshes relayer history", async () => {
    const current = createHarness();
    const invalidateQueries = vi.spyOn(current.queryClient, "invalidateQueries");
    renderRelayer(current);

    await screen.findByText("relayer.near");
    await screen.findByRole("button", { name: "Fund relayer" });
    fireEvent.click(screen.getByRole("button", { name: "Fund relayer" }));

    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Relayer funded", expect.anything()),
    );
    expect(current.transfer).toHaveBeenCalledWith(
      "relayer.near",
      "5000000000000000000000000 yocto",
    );
    expect(current.send).toHaveBeenCalledWith({ waitUntil: "FINAL" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["relay-history"] });
    expect(await screen.findByText("abcdef123456…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fund relayer" })).toHaveProperty("disabled", false);
  });

  it("reports a rejected send and clears the pending state", async () => {
    const current = createHarness();
    const pendingSend = deferred<{ transaction: { hash: string } }>();
    current.send.mockImplementation(() => pendingSend.promise);
    const invalidateQueries = vi.spyOn(current.queryClient, "invalidateQueries");
    renderRelayer(current);

    await screen.findByText("relayer.near");
    await screen.findByRole("button", { name: "Fund relayer" });
    fireEvent.click(screen.getByRole("button", { name: "Fund relayer" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toHaveProperty(
      "disabled",
      true,
    );

    pendingSend.reject(new Error("wallet rejected"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("wallet rejected"));
    expect(screen.getByRole("button", { name: "Fund relayer" })).toHaveProperty("disabled", false);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
