/**
 * Regression tests for the authed route guard's session read.
 *
 * The guard used `ensureQueryData`, which returns a stale cached value
 * immediately (fire-and-forget prefetch) — right after sign-in that stale
 * value is the pre-sign-in signed-out session, so the guard redirected the
 * just-signed-in user back to /login and ping-ponged with the login route's
 * own redirect until TanStack Router threw "Too many redirects". `query()`
 * awaits the refetch when the cached value is stale.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../src/ui/api";
import type { AuthClient, SessionData } from "../../src/ui/auth";
import { sessionQueryKey } from "../../src/ui/auth";
import { clearAuthenticatedQueries, requireSession } from "../../src/ui/auth-guards";

const signedInSession = {
  user: { id: "user-1", name: "Tester", banned: false, role: "user" },
  session: { id: "session-1", activeOrganizationId: null },
} as unknown as SessionData;

const bannedSession = {
  user: { id: "user-1", name: "Tester", banned: true, role: "user" },
  session: { id: "session-1", activeOrganizationId: null },
} as unknown as SessionData;

function createAuthClientMock(responses: Array<SessionData | null>): AuthClient {
  let call = 0;
  return {
    getSession: vi.fn(async () => {
      const data = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { data, error: null };
    }),
  } as unknown as AuthClient;
}

function createContext(queryClient: QueryClient, authClient: AuthClient) {
  return {
    queryClient,
    authClient,
    apiClient: {} as ApiClient,
    session: undefined as SessionData | null | undefined,
  };
}

describe("requireSession", () => {
  it("awaits a fresh session fetch instead of trusting a stale signed-out cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, null);
    // The sign-in flow invalidates before navigating; the fresh session is
    // only available from the (mocked) server fetch.
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    const authClient = createAuthClientMock([signedInSession]);

    const result = await requireSession({
      context: createContext(queryClient, authClient),
      location: { href: "/dashboard" },
    });

    expect(result.auth.isAuthenticated).toBe(true);
  });

  it("redirects to /login with the current href when no session resolves", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const authClient = createAuthClientMock([null]);

    let thrown: unknown;
    try {
      await requireSession({
        context: createContext(queryClient, authClient),
        location: { href: "/dashboard?tab=stuff" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { options: { href?: string } }).options.href).toBe(
      "/login?redirect=%2Fdashboard%3Ftab%3Dstuff",
    );
  });

  it("redirects banned users to /login#banned instead of the dashboard", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, bannedSession);
    const authClient = createAuthClientMock([bannedSession]);

    let thrown: unknown;
    try {
      await requireSession({
        context: createContext(queryClient, authClient),
        location: { href: "/dashboard" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { options: { href?: string } }).options.href).toBe("/login#banned");
  });
});

describe("clearAuthenticatedQueries", () => {
  it("clears private and public query data while leaving an explicit signed-out session", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sessionQueryKey, { user: { id: "user-1" } });
    queryClient.setQueryData(["private-data"], { secret: true });
    queryClient.setQueryData(["public-data"], { title: "City Node" });

    await clearAuthenticatedQueries(queryClient);

    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
    expect(queryClient.getQueryData(["private-data"])).toBeUndefined();
    expect(queryClient.getQueryData(["public-data"])).toBeUndefined();
  });
});
