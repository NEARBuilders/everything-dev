/**
 * Regression tests for the post-sign-in redirect loop ("Too many redirects").
 *
 * The loop chain: the login route's beforeLoad redirects authed users to the
 * redirect target, while the authed route guard redirects users it cannot see
 * back to /login. If the two ever read different session values, they
 * ping-pong until the router trips its redirect limit. The invariant under
 * test: every session read in the app goes through one authoritative queryFn
 * (disableCookieCache) and a post-sign-in refresh overrides even a fresh
 * signed-out cache entry, so the guard and the login route can never disagree.
 */
import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { AuthClient, SessionData } from "everything-dev/ui/auth";
import { refreshSessionCache, sessionQueryKey, sessionQueryOptions } from "everything-dev/ui/auth";
import { describe, expect, it, vi } from "vitest";
import { Route as LoginRoute } from "./login/index";

const signedInSession = {
  user: { id: "user-1", name: "Tester", banned: false },
  session: { id: "session-1", activeOrganizationId: null },
} as unknown as SessionData;

const bannedSession = {
  user: { id: "user-1", name: "Tester", banned: true },
  session: { id: "session-1", activeOrganizationId: null },
} as unknown as SessionData;

type SessionResponse = { data: SessionData | null; error: null };

/**
 * better-auth client mock whose getSession serves the given responses in
 * order — lets a test simulate the cookie cache serving a stale signed-out
 * snapshot right after sign-in, then the fresh session.
 */
function createAuthClientMock(responses: Array<SessionData | null>): AuthClient {
  let call = 0;
  return {
    getSession: vi.fn(async (): Promise<SessionResponse> => {
      const data = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { data, error: null };
    }),
  } as unknown as AuthClient;
}

interface TestContext {
  queryClient: QueryClient;
  authClient: AuthClient;
  session: SessionData | null | undefined;
}

/**
 * Stand-in for the core `_authenticated` guard (ui/src/lib/auth-guards.ts,
 * requireSession) — the plugin test tree cannot import core sources, so the
 * guard semantics (queryClient.query over sessionQueryOptions, banned
 * redirect) are mirrored.
 */
function createAuthedGuard(root: ReturnType<typeof createRootRouteWithContext<TestContext>>) {
  return createRoute({
    getParentRoute: () => root,
    id: "_authenticated",
    beforeLoad: async ({ context }: { context: TestContext }) => {
      const session = await context.queryClient.query(sessionQueryOptions(context.authClient));
      if (!session?.user) {
        throw redirect({ href: `/login?redirect=%2Fdashboard` });
      }
      if (session.user.banned) {
        throw redirect({ href: "/login#banned" });
      }
      return { session };
    },
    component: Outlet,
  });
}

async function buildRouter(initialUrl: string, queryClient: QueryClient, authClient: AuthClient) {
  const context: TestContext = { queryClient, authClient, session: undefined };

  const root = createRootRouteWithContext<TestContext>()({ component: Outlet });

  const guardRoute = createAuthedGuard(root);
  const dashboardRoute = createRoute({
    getParentRoute: () => guardRoute as never,
    path: "/dashboard",
    component: () => <div>dashboard</div>,
  });

  const loginRoute = LoginRoute.update({
    ...LoginRoute.options,
    getParentRoute: () => root,
    path: "/login",
    id: undefined,
  });

  const deviceApprovalRoute = createRoute({
    getParentRoute: () => root,
    path: "/login/device",
    component: () => <div>device approval</div>,
  });

  const router = createRouter({
    routeTree: root.addChildren([
      guardRoute.addChildren([dashboardRoute]),
      loginRoute,
      deviceApprovalRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
    context,
  });
  return router;
}

describe("login redirect flow", () => {
  it("sends an authenticated visitor from /login to the redirect target", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, signedInSession);
    const authClient = createAuthClientMock([signedInSession]);

    const router = await buildRouter("/login?redirect=%2Fdashboard", queryClient, authClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("returns a phone that signs in to device approval with its user code intact", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, signedInSession);
    const authClient = createAuthClientMock([signedInSession]);

    const router = await buildRouter(
      `/login?redirect=${encodeURIComponent("/login/device?user_code=ABCD2345")}`,
      queryClient,
      authClient,
    );
    await router.load();

    expect(router.state.location.pathname).toBe("/login/device");
    expect(router.state.location.search).toEqual({ user_code: "ABCD2345" });
  });

  it("still refuses to redirect a signed-in visitor back into the login page", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, signedInSession);
    const authClient = createAuthClientMock([signedInSession]);

    const router = await buildRouter(
      `/login?redirect=${encodeURIComponent("/login?redirect=/login")}`,
      queryClient,
      authClient,
    );
    await router.load();

    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("awaits a fresh session fetch in the guard instead of trusting a stale signed-out cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, null);
    // The sign-in flow marks the session stale before navigating; the fresh
    // session is only available from the (mocked) server fetch.
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    const authClient = createAuthClientMock([signedInSession]);

    const router = await buildRouter("/dashboard", queryClient, authClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("does not loop when the signed-in user is banned", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, bannedSession);
    const authClient = createAuthClientMock([bannedSession]);

    const router = await buildRouter("/dashboard", queryClient, authClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.hash).toContain("banned");
  });

  it("never reads the session without disabling the cookie cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const authClient = createAuthClientMock([null]);

    await buildRouter("/login", queryClient, authClient).then((router) => router.load());
    await refreshSessionCache(authClient, queryClient);

    expect(authClient.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  });
});

describe("refreshSessionCache", () => {
  it("writes the authoritative session into the cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, null);
    const authClient = createAuthClientMock([signedInSession]);

    const session = await refreshSessionCache(authClient, queryClient);

    expect(session?.user.id).toBe("user-1");
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(signedInSession);
    expect(authClient.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  });

  it("overrides a fresh signed-out cache entry left by the login page's observer", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Fresh (just-written) signed-out entry: a plain fetchQuery would return
    // it without fetching and the post-sign-in navigation would bounce.
    queryClient.setQueryData(sessionQueryKey, null);
    const authClient = createAuthClientMock([signedInSession]);

    const session = await refreshSessionCache(authClient, queryClient);

    expect(session?.user.id).toBe("user-1");
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(signedInSession);
  });

  it("lets the authed guard through after the post-sign-in refresh without bouncing", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, null);
    const authClient = createAuthClientMock([signedInSession]);

    const router = await buildRouter("/dashboard", queryClient, authClient);
    await router.load();
    expect(router.state.location.pathname).toBe("/login");

    await refreshSessionCache(authClient, queryClient);
    await router.navigate({ to: "/dashboard" } as never);

    expect(router.state.location.pathname).toBe("/dashboard");
  });
});
