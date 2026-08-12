import type { AnyRoute } from "@tanstack/react-router";
import { createRoute, Outlet, redirect } from "@tanstack/react-router";

/**
 * Mount registry — trimmed to the mounts this prototype exercises (`public`,
 * `authenticated`). Full taxonomy (anon, admin, organization) is proven in the
 * web-grafting prototype; here we keep the auth-on-mount pattern to show the
 * apiClient + session context flows through the same injection point.
 */

export interface MockUser {
  id: string;
  name: string;
}

export const MOCK_USER: MockUser = { id: "u1", name: "Ada" };

type BeforeLoadArgs = {
  context: { user?: MockUser };
  location: { pathname: string };
};

const requireSession =
  () =>
  ({ context, location }: BeforeLoadArgs) => {
    if (!context.user) {
      throw redirect({ to: "/", search: { redirect: location.pathname } });
    }
  };

function MountChrome({ mountId, accent }: { mountId: string; accent: string }) {
  return (
    <div style={{ border: `2px dashed ${accent}`, padding: 12, borderRadius: 8, margin: 12 }}>
      <div style={{ fontSize: 12, color: accent, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        host · mount point: {mountId}
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

  const authenticatedMount = createRoute({
    getParentRoute: () => rootRoute,
    id: "authenticated",
    beforeLoad: requireSession(),
    ssr: false,
    component: () => <MountChrome mountId="authenticated" accent="#dc2626" />,
  });

  return {
    public: { kind: "static", route: publicMount },
    authenticated: { kind: "static", route: authenticatedMount },
  };
}
