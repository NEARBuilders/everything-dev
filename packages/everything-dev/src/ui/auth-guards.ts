/**
 * The auth redirect policy — the single owner of the guard pair that decides
 * every session-driven redirect in the composed tree. The login route
 * (`_public/login` in the auth plugin ui) and the authenticated mounts read
 * through this module so both sides of the ping-pong loop live in one place,
 * tested as a pair.
 */

import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import type { AuthClient, SessionData } from "./auth";
import { sessionQueryKey, sessionQueryOptions } from "./auth";
import { pluginHref, pluginPath } from "./plugin-path";

export interface AuthContext {
  isAuthenticated: boolean;
  user: SessionData["user"] | null;
  session: SessionData["session"] | null;
  activeOrganizationId: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  isBanned: boolean;
}

interface AuthGuardContext {
  queryClient: QueryClient;
  authClient: AuthClient;
}

export interface AuthGuardArgs {
  context: AuthGuardContext;
  location: { href: string };
}

async function ensureSession(context: AuthGuardContext): Promise<SessionData | null> {
  const { queryClient, authClient } = context;
  return queryClient.query(sessionQueryOptions(authClient));
}

function buildAuthContext(session: SessionData | null | undefined): AuthContext {
  return {
    isAuthenticated: !!session?.user,
    user: session?.user ?? null,
    session: session?.session ?? null,
    activeOrganizationId: session?.session?.activeOrganizationId ?? null,
    isAnonymous: session?.user?.isAnonymous ?? false,
    isAdmin: session?.user?.role === "admin",
    isBanned: session?.user?.banned ?? false,
  };
}

export async function requireSession({ context, location }: AuthGuardArgs) {
  const session = await ensureSession(context);
  if (!session?.user) {
    throw redirect({ href: pluginHref("/login", { redirect: location.href }) });
  }
  if (session.user.banned) {
    throw redirect({ href: pluginPath("/login#banned") });
  }
  return { auth: buildAuthContext(session), session };
}

export async function requireAdmin(args: AuthGuardArgs) {
  const result = await requireSession(args);
  if (result.session.user?.role !== "admin") {
    throw redirect({ to: "/dashboard" });
  }
  return result;
}

/**
 * Clears private and public query data on sign-out while leaving an explicit
 * signed-out session entry — the cache must remember "signed out" so a late
 * router-context session cannot resurrect stale authed state.
 */
export async function clearAuthenticatedQueries(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.clear();
  queryClient.setQueryData(sessionQueryKey, null);
}
