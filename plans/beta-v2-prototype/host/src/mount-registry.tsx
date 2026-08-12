import type { AnyRoute } from "@tanstack/react-router";
import { createRoute, Outlet, redirect, useLoaderData } from "@tanstack/react-router";

/**
 * Mount registry — the host's data-driven mount point contract.
 *
 * A plugin declares a mount point with a pathless `_<mountId>` layout route in
 * its own tree. The host looks that id up here, derives the graft target (a
 * static pathless layout, or a parameterized route like `$orgSlug` that owns a
 * URL segment), auto-namespaces the subtree root id, and reparents the subtree
 * onto the mount. The registry is the ONLY place a mount type is defined —
 * adding `_billing` later is one entry, no host routing code changes.
 *
 * Mount taxonomy (shaped by the everything.dev auth model — Better Auth):
 *
 *   public          pathless, no gate
 *   anon            pathless, rejects authenticated sessions (login/signup)
 *   authenticated   pathless, requires session            (alias: `auth`)
 *   admin           pathless, requires admin role
 *   organization    parameterized, owns `/organization/$orgSlug`, requires
 *                   session + org membership (mocked), provides org via loader
 *
 * Auth is enforced in `beforeLoad` on the MOUNT route — plugins under the mount
 * inherit the gate and never write auth code. `ssr: false` is applied to every
 * session-gated mount (authenticated, admin, organization): the server renders
 * nothing for those subtrees, so SSR never sees session-dependent content and
 * needs no server-side session resolution. Public and anon pages SSR normally.
 *
 * The prototype uses a MOCK auth context injected into the router (see
 * MOCK_ADMIN_USER in verify/main). Production swaps these guards for Better Auth
 * session/membership lookups behind the same interface.
 */

export interface MockUser {
  id: string;
  name: string;
  isAdmin?: boolean;
}

export type AuthContext = { user?: MockUser };

export const MOCK_ADMIN_USER: AuthContext = { user: { id: "u1", name: "Ada", isAdmin: true } };

type BeforeLoadArgs = { context: AuthContext; params: Record<string, unknown>; location: { pathname: string } };

const requireSession =
  () =>
  ({ context, location }: BeforeLoadArgs) => {
    if (!context.user) {
      throw redirect({ to: "/", search: { redirect: location.pathname } });
    }
  };

const requireAdmin =
  () =>
  ({ context, location }: BeforeLoadArgs) => {
    requireSession()({ context, location } as BeforeLoadArgs);
    if (!context.user?.isAdmin) {
      throw redirect({ to: "/" });
    }
  };

const rejectAuthed =
  () =>
  ({ context }: BeforeLoadArgs) => {
    if (context.user) {
      throw redirect({ to: "/" });
    }
  };

function MountChrome({
  mountId,
  accent,
  note,
}: {
  mountId: string;
  accent: string;
  note?: string;
}) {
  return (
    <div style={{ border: `2px dashed ${accent}`, padding: 12, borderRadius: 8, margin: 12 }}>
      <div
        style={{
          fontSize: 12,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 1,
          fontWeight: 700,
        }}
      >
        host · mount point: {mountId}
        {note ? ` · ${note}` : ""}
      </div>
      <Outlet />
    </div>
  );
}

export type MountEntry =
  | { kind: "static"; route: AnyRoute }
  | { kind: "parameterized"; parentRoute: AnyRoute; paramRoute: AnyRoute };

export const MOUNT_ALIASES: Record<string, string> = { auth: "authenticated" };

export function createMountRegistry(rootRoute: AnyRoute): Record<string, MountEntry> {
  const publicMount = createRoute({
    getParentRoute: () => rootRoute,
    id: "public",
    component: () => <MountChrome mountId="public" accent="#2563eb" />,
  });

  const anonMount = createRoute({
    getParentRoute: () => rootRoute,
    id: "anon",
    beforeLoad: rejectAuthed(),
    component: () => <MountChrome mountId="anon" accent="#0ea5e9" />,
  });

  const authenticatedMount = createRoute({
    getParentRoute: () => rootRoute,
    id: "authenticated",
    beforeLoad: requireSession(),
    ssr: false,
    component: () => <MountChrome mountId="authenticated" accent="#dc2626" />,
  });

  const adminMount = createRoute({
    getParentRoute: () => rootRoute,
    id: "admin",
    beforeLoad: requireAdmin(),
    ssr: false,
    component: () => <MountChrome mountId="admin" accent="#7c3aed" />,
  });

  // Parameterized org mount — the host owns `/organization/$orgSlug`. The
  // `beforeLoad` runs with the `$orgSlug` param resolved, so membership checks
  // (and, in production, SSO-derived org context) live HERE — one gate for every
  // plugin that mounts under `_organization`. The loader provides org context.
  // `ssr: false` because the org gate requires a session — the server renders
  // nothing for this subtree; the client hydrates it after session resolution.
  const organizationRoot = createRoute({
    getParentRoute: () => rootRoute,
    path: "/organization",
  });

  const orgSlugRoute = createRoute({
    getParentRoute: () => organizationRoot,
    path: "$orgSlug",
    beforeLoad: ({ context, params }) => {
      requireSession()({ context, params, location: { pathname: "/organization" } });
      const slug = String(params.orgSlug ?? "");
      if (slug === "forbidden") {
        throw redirect({ to: "/" });
      }
    },
    ssr: false,
    loader: ({ params }) => ({ org: { slug: String(params.orgSlug ?? ""), name: `Org "${params.orgSlug}"` } }),
    component: () => {
      const data = useLoaderData({ from: orgSlugRoute.id }) as {
        org: { slug: string; name: string };
      };
      return <MountChrome mountId="organization" accent="#10b981" note={data.org.name} />;
    },
  });

  return {
    public: { kind: "static", route: publicMount },
    anon: { kind: "static", route: anonMount },
    authenticated: { kind: "static", route: authenticatedMount },
    admin: { kind: "static", route: adminMount },
    organization: { kind: "parameterized", parentRoute: organizationRoot, paramRoute: orgSlugRoute },
  };
}
