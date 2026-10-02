// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, AuthClient } from "@/app";
import { useOrganizationTeams } from "./-organization-teams";

const mocks = vi.hoisted(() => ({
  apiClient: null as ApiClient | null,
  auth: null as AuthClient | null,
  invalidateRouter: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/app", () => ({
  useApiClient: () => mocks.apiClient,
  useAuthClient: () => mocks.auth,
  sessionQueryKey: ["session"],
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidateRouter }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

function renderTeams(membershipsEnabled = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = renderHook(
    ({ enabled }: { enabled: boolean }) => useOrganizationTeams("org-1", enabled),
    { initialProps: { enabled: membershipsEnabled }, wrapper },
  );
  return { ...result, queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useOrganizationTeams", () => {
  it.each([
    false,
    true,
  ])("deletes a team and refreshes the workspace only on success: fails=%s", async (fails) => {
    const deleteTeam = vi.fn(async () => {
      if (fails) throw new Error("Team deletion failed");
      return { success: true };
    });
    mocks.auth = {
      getSession: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as AuthClient;
    mocks.apiClient = {
      auth: {
        listTeams: vi.fn().mockResolvedValue([]),
        deleteTeam,
      },
    } as unknown as ApiClient;
    mocks.invalidateRouter.mockResolvedValue(undefined);
    const hook = renderTeams();
    await act(async () => {
      const deletion = hook.result.current.deleteTeam.mutateAsync("team-1");
      if (fails) await expect(deletion).rejects.toThrow("Team deletion failed");
      else await deletion;
    });
    expect(deleteTeam).toHaveBeenCalledWith({ teamId: "team-1", organizationId: "org-1" });
    expect(mocks.invalidateRouter).toHaveBeenCalledTimes(fails ? 0 : 1);
    hook.unmount();
    hook.queryClient.clear();
  });

  it("keeps team names available without loading memberships until the Teams tab is active", async () => {
    const teams = Array.from({ length: 20 }, (_, index) => ({
      id: `team-${index}`,
      name: `Team ${index}`,
      areas: ["things"],
    }));
    const listTeamMembers = vi.fn(async ({ teamId }: { teamId: string }) => [
      { userId: `${teamId}-member` },
    ]);
    mocks.apiClient = {
      auth: {
        listTeams: vi.fn().mockResolvedValue(teams),
        listTeamMembers,
      },
    } as unknown as ApiClient;
    mocks.auth = { getSession: vi.fn() } as unknown as AuthClient;

    const hook = renderTeams();
    await waitFor(() => expect(hook.result.current.teams).toHaveLength(20));
    expect(listTeamMembers).not.toHaveBeenCalled();
    expect(hook.result.current.teams[0]).toMatchObject({
      id: "team-0",
      name: "Team 0",
      memberStatus: "unloaded",
    });

    hook.rerender({ enabled: true });
    await waitFor(() => expect(listTeamMembers).toHaveBeenCalledTimes(20));
    await waitFor(() =>
      expect(hook.result.current.teams[0]).toMatchObject({
        memberStatus: "success",
        memberUserIds: ["team-0-member"],
      }),
    );

    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    await waitFor(() => expect(listTeamMembers).toHaveBeenCalledTimes(20));
    hook.unmount();
    hook.queryClient.clear();
  });

  it("reports a membership transport error and retries the membership query", async () => {
    let shouldFail = true;
    const listTeamMembers = vi.fn(async () => {
      if (shouldFail) throw new Error("membership transport unavailable");
      return [{ userId: "user-1" }];
    });
    mocks.apiClient = {
      auth: {
        listTeams: vi
          .fn()
          .mockResolvedValue([{ id: "team-1", name: "Operations", areas: ["things"] }]),
        listTeamMembers,
      },
    } as unknown as ApiClient;
    mocks.auth = { getSession: vi.fn() } as unknown as AuthClient;

    const hook = renderTeams(true);
    await waitFor(() =>
      expect(hook.result.current.teams[0]).toMatchObject({
        memberStatus: "error",
        memberUserIds: [],
      }),
    );
    expect(hook.result.current.teams[0].memberError).toBe("membership transport unavailable");

    shouldFail = false;
    await act(async () => {
      await hook.result.current.retryTeamMembers("team-1");
    });
    await waitFor(() =>
      expect(hook.result.current.teams[0]).toMatchObject({
        memberStatus: "success",
        memberUserIds: ["user-1"],
      }),
    );
    expect(listTeamMembers).toHaveBeenCalledTimes(2);
    hook.unmount();
    hook.queryClient.clear();
  });

  it("refreshes after a committed team change and can retry refresh without repeating it", async () => {
    let shouldFailRefresh = false;
    const updateTeam = vi.fn().mockResolvedValue({
      id: "team-1",
      name: "Renamed",
      areas: ["things"],
    });
    const listTeams = vi.fn(async () => {
      if (shouldFailRefresh) throw new Error("team list transport unavailable");
      return [{ id: "team-1", name: "Operations", areas: ["things"] }];
    });
    mocks.apiClient = {
      auth: {
        listTeams,
        listTeamMembers: vi.fn().mockResolvedValue([]),
        updateTeam,
      },
    } as unknown as ApiClient;
    mocks.auth = {
      getSession: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    } as unknown as AuthClient;
    mocks.invalidateRouter.mockResolvedValue(undefined);

    const hook = renderTeams();
    await waitFor(() => expect(hook.result.current.teams).toHaveLength(1));
    shouldFailRefresh = true;
    await expect(
      act(async () => {
        await hook.result.current.updateTeam.mutateAsync({ teamId: "team-1", name: "Renamed" });
      }),
    ).rejects.toThrow("Workspace refresh failed: team list transport unavailable");
    expect(updateTeam).toHaveBeenCalledOnce();

    shouldFailRefresh = false;
    await act(async () => {
      await hook.result.current.refreshWorkspace();
    });
    expect(updateTeam).toHaveBeenCalledOnce();
    expect(listTeams).toHaveBeenCalledTimes(3);
    expect(mocks.auth.getSession).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateRouter).toHaveBeenCalledTimes(1);
    hook.unmount();
    hook.queryClient.clear();
  });
});
