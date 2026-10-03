// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, AuthClient } from "@/app";
import { teamWorkspaceQueryKey } from "@/lib/team-workspace";
import { WorkspaceRefreshError } from "@/lib/workspace-synchronization";
import { type InvitationActionInvitation, useInvitationActions } from "./-use-invitation-actions";

const mocks = vi.hoisted(() => ({
  invalidateRouter: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/app", () => ({ sessionQueryKey: ["session"] }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidateRouter }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

const emailInvitation: InvitationActionInvitation = {
  id: "inv-email",
  nearAccountId: null,
  organizationSlug: "city-nodes",
};

const walletInvitation: InvitationActionInvitation = {
  id: "inv-wallet",
  nearAccountId: "alice.near",
  organizationSlug: "wallet-org",
};

function renderActions(
  apiClient: ApiClient,
  auth: AuthClient,
  options: {
    onAccepted?: (invitation: InvitationActionInvitation) => Promise<void> | void;
    onRejected?: (invitation: InvitationActionInvitation) => Promise<void> | void;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = renderHook(() => useInvitationActions({ apiClient, auth, ...options }), {
    wrapper,
  });
  return { ...result, queryClient };
}

function createAuth() {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
  } as unknown as AuthClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useInvitationActions", () => {
  it("dispatches email and wallet acceptance through their matching endpoints", async () => {
    const acceptInvitation = vi.fn().mockResolvedValue({ success: true });
    const acceptNearInvitation = vi.fn().mockResolvedValue({ success: true });
    const apiClient = {
      auth: { acceptInvitation, acceptNearInvitation },
    } as unknown as ApiClient;
    const onAccepted = vi.fn();
    const hook = renderActions(apiClient, createAuth(), { onAccepted });

    await act(async () => {
      await hook.result.current.acceptMutation.mutateAsync(emailInvitation);
      await hook.result.current.acceptMutation.mutateAsync(walletInvitation);
    });

    expect(acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-email" });
    expect(acceptNearInvitation).toHaveBeenCalledWith({ invitationId: "inv-wallet" });
    expect(onAccepted).toHaveBeenNthCalledWith(1, emailInvitation);
    expect(onAccepted).toHaveBeenNthCalledWith(2, walletInvitation);
    expect(mocks.invalidateRouter).toHaveBeenCalledTimes(2);
    hook.unmount();
    hook.queryClient.clear();
  });

  it("dispatches email and wallet rejection without refreshing the session", async () => {
    const rejectInvitation = vi.fn().mockResolvedValue({ success: true });
    const rejectNearInvitation = vi.fn().mockResolvedValue({ success: true });
    const auth = createAuth();
    const apiClient = {
      auth: { rejectInvitation, rejectNearInvitation },
    } as unknown as ApiClient;
    const onRejected = vi.fn();
    const hook = renderActions(apiClient, auth, { onRejected });

    await act(async () => {
      await hook.result.current.rejectMutation.mutateAsync(emailInvitation);
      await hook.result.current.rejectMutation.mutateAsync(walletInvitation);
    });

    expect(rejectInvitation).toHaveBeenCalledWith({ invitationId: "inv-email" });
    expect(rejectNearInvitation).toHaveBeenCalledWith({ invitationId: "inv-wallet" });
    expect(onRejected).toHaveBeenNthCalledWith(1, emailInvitation);
    expect(onRejected).toHaveBeenNthCalledWith(2, walletInvitation);
    expect(auth.getSession).not.toHaveBeenCalled();
    hook.unmount();
    hook.queryClient.clear();
  });

  it("retries a failed rejection refresh without repeating the rejection", async () => {
    let shouldFail = true;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(["user-invitations"], []);
    const invitationObserver = new QueryObserver(queryClient, {
      queryKey: ["user-invitations"],
      queryFn: async () => {
        if (shouldFail) throw new Error("invitation refresh unavailable");
        return [];
      },
      staleTime: Infinity,
    });
    const unsubscribe = invitationObserver.subscribe(() => {});
    const rejectInvitation = vi.fn().mockResolvedValue({ success: true });
    const apiClient = { auth: { rejectInvitation } } as unknown as ApiClient;
    const onRejected = vi.fn();
    const auth = createAuth();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useInvitationActions({ apiClient, auth, onRejected }), {
      wrapper,
    });

    await expect(
      act(async () => hook.result.current.rejectMutation.mutateAsync(emailInvitation)),
    ).rejects.toEqual(expect.any(WorkspaceRefreshError));
    expect(rejectInvitation).toHaveBeenCalledOnce();
    expect(onRejected).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();

    const toastOptions = mocks.toastError.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void };
    };
    shouldFail = false;
    await act(async () => {
      toastOptions.action.onClick();
      await waitFor(() => expect(onRejected).toHaveBeenCalledWith(emailInvitation));
    });
    expect(rejectInvitation).toHaveBeenCalledOnce();
    unsubscribe();
    hook.unmount();
    queryClient.clear();
  });

  it("keeps acceptance committed when workspace refresh fails and retries refresh without accepting again", async () => {
    let shouldFail = true;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const workspaceObserver = new QueryObserver(queryClient, {
      queryKey: teamWorkspaceQueryKey,
      queryFn: async () => {
        if (shouldFail) throw new Error("workspace unavailable");
        return { activeTeam: null };
      },
      staleTime: Infinity,
    });
    queryClient.setQueryData(teamWorkspaceQueryKey, { activeTeam: { id: "team-1" } });
    const unsubscribe = workspaceObserver.subscribe(() => {});
    const acceptInvitation = vi.fn().mockResolvedValue({ success: true });
    const apiClient = { auth: { acceptInvitation } } as unknown as ApiClient;
    const onAccepted = vi.fn();
    const auth = createAuth();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useInvitationActions({ apiClient, auth, onAccepted }), {
      wrapper,
    });

    await expect(
      act(async () => hook.result.current.acceptMutation.mutateAsync(emailInvitation)),
    ).rejects.toEqual(expect.any(WorkspaceRefreshError));
    expect(acceptInvitation).toHaveBeenCalledOnce();
    expect(onAccepted).not.toHaveBeenCalled();

    shouldFail = false;
    await act(async () => {
      await hook.result.current.refreshWorkspace();
    });
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(emailInvitation));
    expect(acceptInvitation).toHaveBeenCalledOnce();
    expect(auth.getSession).toHaveBeenCalledTimes(2);
    unsubscribe();
    hook.unmount();
    queryClient.clear();
  });
});
