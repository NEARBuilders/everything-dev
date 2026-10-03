// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecurityTab } from "./-security-tab";

const harness = vi.hoisted(() => ({
  changePassword: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeSessions: vi.fn(),
  signOut: vi.fn(),
  disconnect: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("everything-dev/ui/auth", () => ({
  sessionQueryKey: ["session"],
  clearAuthenticatedQueries: async (queryClient: QueryClient) => {
    await queryClient.cancelQueries();
    queryClient.clear();
    queryClient.setQueryData(["session"], null);
  },
  useAuthClient: () => ({
    changePassword: harness.changePassword,
    revokeOtherSessions: harness.revokeOtherSessions,
    revokeSessions: harness.revokeSessions,
    signOut: harness.signOut,
    near: { disconnect: harness.disconnect },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => harness.navigate,
}));

vi.mock("sonner", () => ({
  toast: { success: harness.success, error: harness.error },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("security settings", () => {
  it("revokes only other sessions through the preserving endpoint", async () => {
    harness.revokeOtherSessions.mockResolvedValue({ data: { success: true }, error: null });
    harness.revokeSessions.mockResolvedValue({ data: { success: true }, error: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <SecurityTab user={{ email: "person@example.com" }} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out others" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out other devices" }));

    await waitFor(() => expect(harness.revokeOtherSessions).toHaveBeenCalledOnce());
    expect(harness.revokeSessions).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(harness.success).toHaveBeenCalledWith("Other sessions revoked");
  });

  it("rejects mismatched passwords before calling the auth endpoint", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SecurityTab user={{ email: "person@example.com" }} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    fireEvent.change(await screen.findByLabelText("Current password"), {
      target: { value: "old-password" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(harness.error).toHaveBeenCalledWith("Passwords do not match"));
    expect(harness.changePassword).not.toHaveBeenCalled();
  });

  it("clears password fields after a successful password change", async () => {
    harness.changePassword.mockResolvedValue({ data: null, error: null });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SecurityTab user={{ email: "person@example.com" }} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const currentPassword = await screen.findByLabelText("Current password");
    const newPassword = screen.getByLabelText("New password");
    const confirmPassword = screen.getByLabelText("Confirm new password");
    fireEvent.change(currentPassword, { target: { value: "old-password" } });
    fireEvent.change(newPassword, { target: { value: "new-password" } });
    fireEvent.change(confirmPassword, { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(harness.changePassword).toHaveBeenCalledWith({
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    );
    expect(currentPassword).toHaveProperty("value", "");
    expect(newPassword).toHaveProperty("value", "");
    expect(confirmPassword).toHaveProperty("value", "");
    expect(harness.success).toHaveBeenCalledWith("Password changed");
  });

  it("clears authenticated caches, disconnects the wallet, and returns home on sign out", async () => {
    harness.signOut.mockResolvedValue({ data: null, error: null });
    harness.disconnect.mockResolvedValue(undefined);
    harness.navigate.mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["session"], { user: { id: "user-1" } });
    queryClient.setQueryData(["passkeys"], [{ id: "passkey-1" }]);
    queryClient.setQueryData(["organizations"], [{ id: "org-1" }]);

    render(
      <QueryClientProvider client={queryClient}>
        <SecurityTab user={{ email: "person@example.com" }} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(harness.signOut).toHaveBeenCalledOnce());
    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(queryClient.getQueryData(["session"])).toBeNull();
    expect(queryClient.getQueryData(["passkeys"])).toBeUndefined();
    expect(queryClient.getQueryData(["organizations"])).toBeUndefined();
  });
});
