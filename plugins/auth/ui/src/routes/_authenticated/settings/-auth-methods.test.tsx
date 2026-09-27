// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasskeysMethod } from "./-passkeys-method";

const harness = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("everything-dev/ui/auth", () => ({
  useAuthClient: () => ({
    passkey: {
      listUserPasskeys: harness.listPasskeys,
      addPasskey: harness.addPasskey,
      deletePasskey: harness.deletePasskey,
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: harness.success, error: harness.error },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPasskeys() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PasskeysMethod />
    </QueryClientProvider>,
  );
}

describe("passkey settings", () => {
  it("adds and removes passkeys through the auth client while refreshing the displayed list", async () => {
    let passkeys = [{ id: "passkey-1", name: "Phone" }];
    harness.listPasskeys.mockImplementation(async () => ({ data: passkeys, error: null }));
    harness.addPasskey.mockImplementation(async ({ name }: { name: string }) => {
      passkeys = [...passkeys, { id: "passkey-2", name }];
      return { data: passkeys[1], error: null };
    });
    harness.deletePasskey.mockImplementation(async ({ id }: { id: string }) => {
      passkeys = passkeys.filter((passkey) => passkey.id !== id);
      return { data: null, error: null };
    });

    renderPasskeys();
    expect(await screen.findByText("Phone")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Work laptop"), {
      target: { value: "Work laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create passkey" }));

    await waitFor(() => expect(harness.addPasskey).toHaveBeenCalledWith({ name: "Work laptop" }));
    expect(await screen.findByText("Work laptop")).toBeTruthy();
    expect(harness.listPasskeys.mock.calls.length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Phone" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove passkey" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(harness.deletePasskey).toHaveBeenCalledWith({ id: "passkey-1" }));
    await waitFor(() => expect(screen.queryByText("Phone")).toBeNull());
    expect(harness.listPasskeys.mock.calls.length).toBeGreaterThan(2);
  });
});
