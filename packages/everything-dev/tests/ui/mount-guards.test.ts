import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import type { AuthClient, SessionData } from "../../src/ui/auth";
import { sessionQueryKey } from "../../src/ui/auth";
import { constructTree, SUPPORTED_MANIFEST_VERSION } from "../../src/ui/manifest/index";

type MountId = "authenticated" | "admin";

const sessionOf = (user: Record<string, unknown>) =>
  ({ user, session: { id: "s1", activeOrganizationId: null } }) as unknown as SessionData;

const authClientOf = (session: SessionData | null) =>
  ({
    getSession: vi.fn(async () => ({ data: session, error: null })),
  }) as unknown as AuthClient;

const construct = (mount: MountId, guards?: Parameters<typeof constructTree>[0]["guards"]) =>
  constructTree({
    name: "app",
    plugins: [{ key: "ui", mfName: "ui" }],
    resolve: async () => {
      const routes = [
        { id: `_${mount}`, type: "layout", mount },
        { id: `_${mount}/page`, type: "route", path: "/page", parentId: `_${mount}` },
      ] as const;
      return {
        key: "ui",
        manifest: { name: "ui", manifestVersion: SUPPORTED_MANIFEST_VERSION, routes },
        routeConfig: {
          routeConfigLoaders: Object.fromEntries(
            routes.map((record) => [record.id, async () => ({})]),
          ),
        },
      };
    },
    ...(guards ? { guards } : {}),
  });

const mountBeforeLoad = async (
  mount: MountId,
  guards?: Parameters<typeof constructTree>[0]["guards"],
) => {
  const tree = await construct(mount, guards);
  return (tree.rootRoute as unknown as { children: Array<{ options: Record<string, unknown> }> })
    .children[0]!.options.beforeLoad as (args: unknown) => Promise<unknown>;
};

const redirectOf = async (beforeLoad: (args: unknown) => Promise<unknown>, args: unknown) => {
  try {
    await beforeLoad(args);
    return undefined;
  } catch (error) {
    expect(isRedirect(error)).toBe(true);
    return (error as { options: { href?: string; to?: string } }).options;
  }
};

describe("mount guards wired through the composition shim", () => {
  it("resolves an unresolved session through the query cache instead of redirecting a signed-in full page load (#818)", async () => {
    const beforeLoad = await mountBeforeLoad("authenticated");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const authClient = authClientOf(sessionOf({ id: "user-1" }));

    await expect(
      beforeLoad({
        context: { queryClient, authClient },
        location: { href: "/dashboard" },
      }),
    ).resolves.toBeUndefined();
    expect(authClient.getSession).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(sessionOf({ id: "user-1" }));
  });

  it("redirects to /login with the return path when the session is authoritatively signed out, without fetching", async () => {
    const beforeLoad = await mountBeforeLoad("authenticated");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, null);
    const authClient = authClientOf(sessionOf({ id: "user-1" }));

    const redirect = await redirectOf(beforeLoad, {
      context: { queryClient, authClient },
      location: { href: "/dashboard?tab=1" },
    });
    expect(redirect?.href).toBe("/login?redirect=%2Fdashboard%3Ftab%3D1");
    expect(authClient.getSession).not.toHaveBeenCalled();
  });

  it("redirects banned users to /login#banned", async () => {
    const beforeLoad = await mountBeforeLoad("authenticated");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, sessionOf({ id: "user-1", banned: true }));

    const redirect = await redirectOf(beforeLoad, {
      context: { queryClient, authClient: authClientOf(null) },
      location: { href: "/dashboard" },
    });
    expect(redirect?.href).toBe("/login#banned");
  });

  it("guards the admin mount with requireAdmin — non-admins to /dashboard, admins through", async () => {
    const beforeLoad = await mountBeforeLoad("admin");
    const member = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    member.setQueryData(sessionQueryKey, sessionOf({ id: "user-1", role: "user" }));
    const redirect = await redirectOf(beforeLoad, {
      context: { queryClient: member, authClient: authClientOf(null) },
      location: { href: "/admin" },
    });
    expect(redirect?.to).toBe("/dashboard");

    const admin = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    admin.setQueryData(sessionQueryKey, sessionOf({ id: "user-1", role: "admin" }));
    await expect(
      beforeLoad({
        context: { queryClient: admin, authClient: authClientOf(null) },
        location: { href: "/admin" },
      }),
    ).resolves.toBeUndefined();
  });

  it("lets the caller override a mount's guard via input.guards", async () => {
    const override = vi.fn(async () => undefined);
    const beforeLoad = await mountBeforeLoad("authenticated", { authenticated: override });

    await expect(beforeLoad({ context: {}, location: { href: "/x" } })).resolves.toBeUndefined();
    expect(override).toHaveBeenCalledOnce();
  });
});
