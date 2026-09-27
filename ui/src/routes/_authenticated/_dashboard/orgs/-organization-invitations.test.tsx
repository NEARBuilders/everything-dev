// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import { useOrganizationInvitationActions } from "./-organization-invitations";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));

function renderActions(apiClient: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOrganizationInvitationActions(apiClient, "org-1"), { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("organization invitation actions", () => {
  it("routes wallet invites through the wallet-aware auth contract", async () => {
    const apiClient = {
      auth: {
        inviteMember: vi.fn().mockResolvedValue({ id: "inv-1" }),
        cancelInvitation: vi.fn().mockResolvedValue({ success: true }),
      },
    } as unknown as ApiClient;
    const { result } = renderActions(apiClient);

    await act(async () => {
      await result.current.inviteMutation.mutateAsync({
        nearAccountId: "alice.near",
        nearNetwork: "testnet",
        role: "member",
        teamId: "team-ops",
      });
    });

    expect(apiClient.auth.inviteMember).toHaveBeenCalledWith({
      organizationId: "org-1",
      nearAccountId: "alice.near",
      nearNetwork: "testnet",
      role: "member",
      teamId: "team-ops",
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation created for alice.near");
  });

  it("preserves the wallet network on resend and refuses ambiguous legacy invitations", async () => {
    const inviteMember = vi.fn().mockResolvedValue({ id: "inv-1" });
    const apiClient = { auth: { inviteMember } } as unknown as ApiClient;
    const { result } = renderActions(apiClient);
    const invitation = {
      id: "inv-1",
      email: "wallet@near-wallet.invalid",
      nearAccountId: "alice.near",
      nearNetwork: "testnet" as const,
      role: "member",
      status: "pending",
      expiresAt: new Date(),
    };
    await act(async () => {
      await result.current.resendInvitationMutation.mutateAsync(invitation);
    });
    expect(inviteMember).toHaveBeenCalledWith({
      organizationId: "org-1",
      nearAccountId: "alice.near",
      nearNetwork: "testnet",
      role: "member",
      resend: true,
    });
    inviteMember.mockClear();
    await act(async () => {
      await expect(
        result.current.resendInvitationMutation.mutateAsync({
          ...invitation,
          nearNetwork: null,
        }),
      ).rejects.toThrow(/reissue/i);
    });
    expect(inviteMember).not.toHaveBeenCalled();
  });

  it("cancels through the wallet-aware auth contract", async () => {
    const apiClient = {
      auth: {
        inviteMember: vi.fn(),
        cancelInvitation: vi.fn().mockResolvedValue({ success: true }),
      },
    } as unknown as ApiClient;
    const { result } = renderActions(apiClient);

    await act(async () => {
      await result.current.cancelInvitationMutation.mutateAsync("inv-1");
    });

    expect(apiClient.auth.cancelInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
  });
});
