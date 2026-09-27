// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NearMethod } from "./-near-method";

const harness = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listUserPasskeys: vi.fn(),
  link: vi.fn(),
  linkPasskeyWallet: vi.fn(),
  setPrimaryAccount: vi.fn(),
  unlink: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  passkeyWalletAvailable: true,
}));

vi.mock("everything-dev/ui/auth", () => ({
  sessionQueryKey: ["session"],
  useAuthClient: () => ({
    near: {
      listAccounts: harness.listAccounts,
      link: harness.link,
      linkPasskeyWallet: harness.linkPasskeyWallet,
      setPrimaryAccount: harness.setPrimaryAccount,
      unlink: harness.unlink,
    },
    passkey: { listUserPasskeys: harness.listUserPasskeys },
  }),
}));

vi.mock("better-near-auth/client", () => ({
  isPasskeyWalletAvailable: () => harness.passkeyWalletAvailable,
}));

vi.mock("sonner", () => ({
  toast: { success: harness.success, error: harness.error },
}));

afterEach(() => {
  cleanup();
  harness.passkeyWalletAvailable = true;
  vi.clearAllMocks();
});

function account(overrides: Record<string, unknown>) {
  return {
    id: "na-1",
    userId: "user-1",
    accountId: "alice.near",
    network: "mainnet",
    publicKey: "ed25519:key",
    isPrimary: false,
    createdAt: new Date("2026-01-01"),
    providerId: "siwn",
    isActive: false,
    isAvailable: true,
    ...overrides,
  };
}

function renderNearMethod(networkId: "mainnet" | "testnet" = "mainnet") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NearMethod networkId={networkId} />
    </QueryClientProvider>,
  );
}

describe("near method settings", () => {
  it("offers both linking a named account and creating one from a passkey", async () => {
    harness.listAccounts.mockResolvedValue({ data: { accounts: [] }, error: null });
    harness.listUserPasskeys.mockResolvedValue({
      data: [{ id: "pk-1", name: "Laptop" }],
      error: null,
    });
    harness.linkPasskeyWallet.mockImplementation(async (callbacks?: { onSuccess?: () => void }) => {
      callbacks?.onSuccess?.();
    });

    renderNearMethod();

    expect(await screen.findByTestId("settings.create-near-from-passkey")).toBeTruthy();
    fireEvent.click(screen.getByTestId("settings.create-near-from-passkey-button"));
    await waitFor(() => expect(harness.linkPasskeyWallet).toHaveBeenCalledOnce());
    expect(harness.success).toHaveBeenCalledWith("NEAR account created from your passkey");
  });

  it("hides the passkey creation path on networks without a passkey wallet", async () => {
    harness.listAccounts.mockResolvedValue({ data: { accounts: [] }, error: null });
    harness.listUserPasskeys.mockResolvedValue({ data: [{ id: "pk-1" }], error: null });
    harness.passkeyWalletAvailable = false;

    renderNearMethod("testnet");

    await screen.findByTestId("settings.near-accounts-empty");
    expect(screen.queryByTestId("settings.create-near-from-passkey")).toBeNull();
  });

  it("lists linked accounts and swaps the primary", async () => {
    harness.listAccounts.mockResolvedValue({
      data: {
        accounts: [
          account({ id: "na-1", isPrimary: true, isActive: true, isAvailable: false }),
          account({ id: "na-2", accountId: "bob.near", network: "testnet" }),
        ],
      },
      error: null,
    });
    harness.listUserPasskeys.mockResolvedValue({ data: [{ id: "pk-1" }], error: null });
    harness.setPrimaryAccount.mockResolvedValue({ data: {}, error: null });

    renderNearMethod();

    expect(await screen.findByText("alice.near")).toBeTruthy();
    expect(screen.getByTestId("settings.near-primary-na-1").textContent).toBe("Primary");
    expect(screen.getByTestId("settings.link-near-button").textContent).toContain(
      "Link another account",
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for bob.near" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make primary" }));

    await waitFor(() =>
      expect(harness.setPrimaryAccount).toHaveBeenCalledWith({
        accountId: "bob.near",
        network: "testnet",
      }),
    );
  });

  it("does not offer the primary account a make-primary action", async () => {
    harness.listAccounts.mockResolvedValue({
      data: {
        accounts: [account({ id: "na-1", isPrimary: true, isActive: true, isAvailable: false })],
      },
      error: null,
    });
    harness.listUserPasskeys.mockResolvedValue({ data: [{ id: "pk-1" }], error: null });

    renderNearMethod();

    fireEvent.click(await screen.findByRole("button", { name: "Actions for alice.near" }));
    expect(await screen.findByRole("menuitem", { name: "Unlink" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Make primary" })).toBeNull();
  });

  it("surfaces a load failure instead of the empty state", async () => {
    harness.listAccounts.mockResolvedValue({ data: null, error: { message: "boom" } });
    harness.listUserPasskeys.mockResolvedValue({ data: [{ id: "pk-1" }], error: null });

    renderNearMethod();

    expect(await screen.findByTestId("settings.near-accounts-error")).toBeTruthy();
    expect(screen.queryByTestId("settings.near-accounts-empty")).toBeNull();
  });

  it("unlinks an account after confirmation", async () => {
    harness.listAccounts.mockResolvedValue({
      data: { accounts: [account({ id: "na-1" })] },
      error: null,
    });
    harness.listUserPasskeys.mockResolvedValue({ data: [], error: null });
    harness.unlink.mockResolvedValue({ data: {}, error: null });

    renderNearMethod();

    fireEvent.click(await screen.findByRole("button", { name: "Actions for alice.near" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unlink" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unlink" }));

    await waitFor(() =>
      expect(harness.unlink).toHaveBeenCalledWith({ accountId: "alice.near", network: "mainnet" }),
    );
  });

  it("links a named account through the wallet flow", async () => {
    harness.listAccounts.mockResolvedValue({ data: { accounts: [] }, error: null });
    harness.listUserPasskeys.mockResolvedValue({ data: [], error: null });
    harness.link.mockImplementation(async (callbacks?: { onSuccess?: () => void }) => {
      callbacks?.onSuccess?.();
    });

    renderNearMethod();

    fireEvent.click(await screen.findByTestId("settings.link-near-button"));
    await waitFor(() => expect(harness.link).toHaveBeenCalledOnce());
    expect(harness.success).toHaveBeenCalledWith("NEAR account linked");
  });
});
