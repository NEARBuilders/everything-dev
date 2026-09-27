// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnableGaslessWrites } from "./enable-gasless-writes";

const wallet = vi.hoisted(() => ({
  getGasKeyScope: vi.fn(),
  isGasKeyWalletSupported: vi.fn(),
  addSessionGasKey: vi.fn(),
  ensureGasKeyFunded: vi.fn(),
  refreshGasKeyInfo: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

const atoms = vi.hoisted(() => {
  function makeAtom(initial: unknown) {
    let value = initial;
    return {
      get: () => value,
      set: (next: unknown) => {
        value = next;
      },
      subscribe: () => () => {},
    };
  }
  return {
    nearState: makeAtom(null),
    walletConnected: makeAtom(false),
    activeNetwork: makeAtom("mainnet"),
    gasKeyState: makeAtom(null),
  };
});

vi.mock("@/app", () => ({
  useAuthClient: () => ({
    near: {
      getGasKeyScope: wallet.getGasKeyScope,
      isGasKeyWalletSupported: wallet.isGasKeyWalletSupported,
      addSessionGasKey: wallet.addSessionGasKey,
      ensureGasKeyFunded: wallet.ensureGasKeyFunded,
      refreshGasKeyInfo: wallet.refreshGasKeyInfo,
    },
    $store: { atoms },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: wallet.success, error: wallet.error, warning: wallet.warning },
}));

const clients: QueryClient[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  atoms.gasKeyState.set(null);
  wallet.getGasKeyScope.mockResolvedValue({ data: { enabled: true }, error: null });
  wallet.isGasKeyWalletSupported.mockResolvedValue(true);
  wallet.addSessionGasKey.mockResolvedValue(undefined);
  wallet.ensureGasKeyFunded.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

function renderComponent(nearAccountId: string | null = "owner.near") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <EnableGaslessWrites nearAccountId={nearAccountId} />
    </QueryClientProvider>,
  );
}

describe("EnableGaslessWrites", () => {
  it("offers the opt-in for gas-key-capable wallets when scope is enabled", async () => {
    renderComponent();
    const button = await screen.findByTestId("enable-gasless-writes");
    expect(button).toBeTruthy();

    button.click();
    await waitFor(() => expect(wallet.addSessionGasKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(wallet.ensureGasKeyFunded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(wallet.success).toHaveBeenCalledWith("Gasless writes enabled"));
  });

  it("shows the ready status once a key is bootstrapped", async () => {
    atoms.gasKeyState.set({
      accountId: "owner.near",
      publicKey: "ed25519:gaskey",
      networkId: "mainnet",
      balance: "50000000000000000000000",
      numNonces: 4,
    });
    renderComponent();

    expect(await screen.findByTestId("gasless-writes-status")).toBeTruthy();
    expect(screen.queryByTestId("enable-gasless-writes")).toBeNull();
  });

  it("explains the refusal when the wallet cannot sign gas-key actions", async () => {
    wallet.isGasKeyWalletSupported.mockResolvedValue(false);
    renderComponent();

    const note = await screen.findByTestId("gasless-writes-unsupported");
    expect(note.textContent).toMatch(/doesn't support gas keys/);
    expect(note.textContent).toMatch(/falls back to the relayer/);
    expect(screen.queryByTestId("enable-gasless-writes")).toBeNull();
  });

  it("renders nothing while the scope query is unconfigured", async () => {
    wallet.getGasKeyScope.mockResolvedValue({ data: { enabled: false }, error: null });
    renderComponent();

    await waitFor(() => expect(wallet.getGasKeyScope).toHaveBeenCalled());
    expect(screen.queryByTestId("enable-gasless-writes")).toBeNull();
    expect(screen.queryByTestId("gasless-writes-status")).toBeNull();
    expect(screen.queryByTestId("gasless-writes-unsupported")).toBeNull();
  });

  it("waits for the wallet capability check instead of flashing a refusal", async () => {
    wallet.isGasKeyWalletSupported.mockReturnValue(new Promise(() => {}));
    renderComponent();

    await waitFor(() => expect(wallet.isGasKeyWalletSupported).toHaveBeenCalled());
    expect(screen.queryByTestId("gasless-writes-unsupported")).toBeNull();
    expect(screen.queryByTestId("enable-gasless-writes")).toBeNull();
  });

  it("warns once and keeps the relayer fallback when funding hits the per-user cap", async () => {
    wallet.ensureGasKeyFunded.mockResolvedValue(false);
    renderComponent();

    const button = await screen.findByTestId("enable-gasless-writes");
    button.click();
    await waitFor(() => expect(wallet.warning).toHaveBeenCalledTimes(1));
    expect(wallet.success).not.toHaveBeenCalled();
    expect(wallet.error).not.toHaveBeenCalled();
  });
});
