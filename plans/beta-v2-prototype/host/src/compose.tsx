import type { AnyRoute } from "@tanstack/react-router";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";

/**
 * Plugin contract v2 — a plugin exports its route tree and nothing else.
 *
 * The mount declaration lives IN the plugin's own routes: any pathless layout
 * whose id's last segment starts with `_` is a mount declaration. A plugin
 * author writes `_public.tsx` (file-based) or `createRoute({ id: "_public" })`
 * (code-based) and the host derives mount id `public` from it. No `mounts`
 * map, no `name` export, no namespaced ids — the routes are the config.
 */
export interface WebPluginModule {
  /** host-side identifier (remote name). Used ONLY to namespace internal route ids. */
  name: string;
  /** the plugin's full route tree (generated `routeTree` or code-built `tree`). */
  tree: AnyRoute;
}

export interface ComposedApp {
  routeTree: AnyRoute;
  mountCounts: Record<string, number>;
  pluginTreeChildren: Record<string, number>;
}

function PublicLayout() {
  return (
    <div style={{ border: "2px dashed #2563eb", padding: 12, borderRadius: 8, margin: 12 }}>
      <div style={{ fontSize: 12, color: "#2563eb", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        host · mount point: public
      </div>
      <Outlet />
    </div>
  );
}

function AuthLayout() {
  return (
    <div style={{ border: "2px dashed #dc2626", padding: 12, borderRadius: 8, margin: 12 }}>
      <div style={{ fontSize: 12, color: "#dc2626", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        host · mount point: auth
      </div>
      <Outlet />
    </div>
  );
}

function AdminLayout() {
  return (
    <div style={{ border: "2px dashed #7c3aed", padding: 12, borderRadius: 8, margin: 12 }}>
      <div style={{ fontSize: 12, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        host · mount point: admin
      </div>
      <Outlet />
    </div>
  );
}

/**
 * Derive the host mount id from a plugin subtree root's id.
 * `/_public` or `_public` → `public`; `_auth` → `auth`. A route whose last
 * segment does not start with `_` is not a mount declaration → undefined.
 */
function deriveMountId(route: AnyRoute): string | undefined {
  const raw = (route as unknown as { options?: { id?: string } }).options?.id ?? "";
  const seg = raw.split("/").filter(Boolean).at(-1) ?? "";
  return seg.startsWith("_") ? seg.slice(1) : undefined;
}

/**
 * Generic host composition — mounts-only knowledge.
 *
 * The host knows NOTHING about plugin internals. It walks each plugin's tree
 * root children, treats every `_<mount>` pathless layout as a mount
 * declaration, auto-namespaces the subtree root id (`<plugin>__<mount>`) to
 * keep route ids globally unique, reparents it onto the host mount, and grafts.
 *
 * No plugin config exists: the plugin's own route files (`_public.tsx`) are the
 * mount declaration. Collisions between two plugins declaring the same mount
 * are resolved by the host's per-plugin id namespace — invisible to the author.
 *
 * Every mount point is a *pathless* layout, so grafting never changes URLs.
 */
export function composeApp(plugins: WebPluginModule[]): ComposedApp {
  const rootRoute = createRootRoute({
    component: () => (
      <div style={{ fontFamily: "system-ui, sans-serif" }}>
        <header style={{ padding: 8, borderBottom: "1px solid #333" }}>
          <Link to="/">Home</Link>{" "}
          <Link to="/about">About</Link>{" "}
          <Link to="/dashboard">Dashboard</Link>{" "}
          <Link to="/settings">Settings</Link>{" "}
          <Link to="/admin/users">Admin</Link>
        </header>
        <Outlet />
      </div>
    ),
  });

  const mountPoints = {
    public: createRoute({
      id: "public",
      component: PublicLayout,
      getParentRoute: () => rootRoute,
    }),
    auth: createRoute({
      id: "auth",
      component: AuthLayout,
      getParentRoute: () => rootRoute,
    }),
    admin: createRoute({
      id: "admin",
      component: AdminLayout,
      getParentRoute: () => rootRoute,
    }),
  };

  const subtreesByMount: Record<string, AnyRoute[]> = { public: [], auth: [], admin: [] };
  const pluginTreeChildren: Record<string, number> = {};

  for (const plugin of plugins) {
    const children = (plugin.tree as unknown as { children?: AnyRoute[] }).children ?? [];
    pluginTreeChildren[plugin.name] = children.length;
    for (const child of children) {
      const mountId = deriveMountId(child);
      if (!mountId) continue;
      const mount = mountPoints[mountId as keyof typeof mountPoints];
      if (!mount) continue;
      // Auto-namespace the subtree ROOT id (invisible: pathless, not a URL) +
      // reparent onto the host mount. Descendants reference this same root
      // object, so the chain below stays intact — one shallow mutation.
      const rootOptions = (child as any).options ?? {};
      (child as any).options = {
        ...rootOptions,
        id: `${plugin.name}__${mountId}`,
        getParentRoute: () => mount,
      };
      subtreesByMount[mountId].push(child);
    }
  }

  const populatedMounts = (Object.keys(mountPoints) as Array<keyof typeof mountPoints>).map(
    (id) => mountPoints[id].addChildren(subtreesByMount[id] ?? []),
  );

  return {
    routeTree: rootRoute.addChildren(populatedMounts),
    mountCounts: {
      public: subtreesByMount.public.length,
      auth: subtreesByMount.auth.length,
      admin: subtreesByMount.admin.length,
    },
    pluginTreeChildren,
  };
}
