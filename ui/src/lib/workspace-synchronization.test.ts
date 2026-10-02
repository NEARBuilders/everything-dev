// @vitest-environment jsdom
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "@/app";
import { sessionQueryKey } from "@/lib/auth";
import { teamWorkspaceQueryKey } from "@/lib/team-workspace";
import { createWorkspaceSynchronization, WorkspaceRefreshError } from "./workspace-synchronization";

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace synchronization", () => {
  it("refreshes the session, affected management data, active workspace, and route guards in order", async () => {
    const queryClient = createClient();
    const events: string[] = [];
    const organizationQueryKey = ["organizations"] as const;
    const managementObserver = new QueryObserver(queryClient, {
      queryKey: organizationQueryKey,
      queryFn: async () => {
        events.push("organizations");
        return ["org-2"];
      },
      staleTime: Infinity,
    });
    const workspaceObserver = new QueryObserver(queryClient, {
      queryKey: teamWorkspaceQueryKey,
      queryFn: async () => {
        events.push("workspace");
        return { activeTeam: { id: "team-2" } };
      },
      staleTime: Infinity,
    });
    queryClient.setQueryData(organizationQueryKey, ["org-1"]);
    queryClient.setQueryData(teamWorkspaceQueryKey, { activeTeam: { id: "team-1" } });
    const unsubscribeManagement = managementObserver.subscribe(() => {});
    const unsubscribeWorkspace = workspaceObserver.subscribe(() => {});
    const auth = {
      getSession: vi.fn(async () => {
        events.push("session");
        return {
          data: { session: { activeOrganizationId: "org-2" }, user: { id: "user-1" } },
          error: null,
        };
      }),
    } as unknown as AuthClient;
    const router = {
      invalidate: vi.fn(async () => {
        events.push("router");
      }),
    };

    await createWorkspaceSynchronization({ auth, queryClient, router }).synchronize({
      queryKeys: [organizationQueryKey],
    });

    expect(queryClient.getQueryData(sessionQueryKey)).toEqual({
      session: { activeOrganizationId: "org-2" },
      user: { id: "user-1" },
    });
    expect(events).toEqual(["session", "organizations", "workspace", "router"]);
    expect(router.invalidate).toHaveBeenCalledOnce();
    unsubscribeManagement();
    unsubscribeWorkspace();
    queryClient.clear();
  });

  it("reports refresh failures separately and can retry the refresh without another mutation", async () => {
    const queryClient = createClient();
    let shouldFail = true;
    const workspaceObserver = new QueryObserver(queryClient, {
      queryKey: teamWorkspaceQueryKey,
      queryFn: async () => {
        if (shouldFail) throw new Error("workspace transport unavailable");
        return { activeTeam: null };
      },
      staleTime: Infinity,
    });
    queryClient.setQueryData(teamWorkspaceQueryKey, { activeTeam: { id: "team-1" } });
    const unsubscribe = workspaceObserver.subscribe(() => {});
    const auth = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { activeOrganizationId: "org-1" }, user: { id: "user-1" } },
        error: null,
      }),
    } as unknown as AuthClient;
    const router = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const synchronization = createWorkspaceSynchronization({ auth, queryClient, router });

    await expect(synchronization.synchronize()).rejects.toMatchObject({
      name: "WorkspaceRefreshError",
      stage: "workspace",
      message: "Workspace refresh failed: workspace transport unavailable",
    });
    expect(auth.getSession).toHaveBeenCalledOnce();
    expect(router.invalidate).not.toHaveBeenCalled();

    shouldFail = false;
    await synchronization.synchronize();

    expect(auth.getSession).toHaveBeenCalledTimes(2);
    expect(router.invalidate).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    unsubscribe();
    queryClient.clear();
  });

  it("wraps a session refresh failure without invalidating stale workspace data", async () => {
    const queryClient = createClient();
    queryClient.setQueryData(teamWorkspaceQueryKey, { activeTeam: { id: "team-1" } });
    const auth = {
      getSession: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "session transport unavailable" },
      }),
    } as unknown as AuthClient;
    const router = { invalidate: vi.fn().mockResolvedValue(undefined) };
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await expect(
      createWorkspaceSynchronization({ auth, queryClient, router }).synchronize(),
    ).rejects.toEqual(expect.any(WorkspaceRefreshError));

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(router.invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(teamWorkspaceQueryKey)).toEqual({
      activeTeam: { id: "team-1" },
    });
    queryClient.clear();
  });
});
