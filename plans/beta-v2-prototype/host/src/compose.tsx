import type { AnyRoute } from "@tanstack/react-router";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { createMountRegistry, MOUNT_ALIASES } from "./mount-registry";

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
 * Generic host composition — registry-driven mounts.
 *
 * The host knows NOTHING about plugin internals. It walks each plugin's tree
 * root children, treats every `_<mount>` pathless layout as a mount
 * declaration, resolves the mount through the mount registry (static pathless
 * layouts + parameterized routes like `_organization`), auto-namespaces the
 * subtree root id (`<plugin>__<mount>`) to keep route ids globally unique,
 * reparents it onto the graft target, and grafts.
 *
 * The registry is the ONLY place a mount type is defined: its layout, its auth
 * `beforeLoad`, its `ssr` behavior, and its URL footprint (pathless vs
 * `$orgSlug`). Adding `_billing` later is one registry entry.
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
          <Link to="/admin/users">Admin</Link>{" "}
          <Link to="/organization/acme/dashboard">Org</Link>
        </header>
        <Outlet />
      </div>
    ),
  });

  const mountRegistry = createMountRegistry(rootRoute);
  const mountIds = Object.keys(mountRegistry);

  const subtreesByMount: Record<string, AnyRoute[]> = {};
  const pluginTreeChildren: Record<string, number> = {};

  for (const plugin of plugins) {
    const children = (plugin.tree as unknown as { children?: AnyRoute[] }).children ?? [];
    pluginTreeChildren[plugin.name] = children.length;
    for (const child of children) {
      const mountId = deriveMountId(child);
      if (!mountId) continue;
      const canonicalId = MOUNT_ALIASES[mountId] ?? mountId;
      const entry = mountRegistry[canonicalId];
      if (!entry) continue;
      const graftTarget = entry.kind === "parameterized" ? entry.paramRoute : entry.route;
      // Auto-namespace the subtree ROOT id (invisible: pathless, not a URL) +
      // reparent onto the mount. Descendants reference this same root
      // object, so the chain below stays intact — one shallow mutation.
      const rootOptions = (child as any).options ?? {};
      (child as any).options = {
        ...rootOptions,
        id: `${plugin.name}__${canonicalId}`,
        getParentRoute: () => graftTarget,
      };
      (subtreesByMount[canonicalId] ??= []).push(child);
    }
  }

  const populatedMounts = mountIds.map((id) => {
    const entry = mountRegistry[id];
    const subtrees = subtreesByMount[id] ?? [];
    if (entry.kind === "parameterized") {
      // parameterized mount: parentRoute → paramRoute → grafted subtrees
      return entry.parentRoute.addChildren([entry.paramRoute.addChildren(subtrees)]);
    }
    return entry.route.addChildren(subtrees);
  });

  return {
    routeTree: rootRoute.addChildren(populatedMounts),
    mountCounts: Object.fromEntries(mountIds.map((id) => [id, subtreesByMount[id]?.length ?? 0])),
    pluginTreeChildren,
  };
}
