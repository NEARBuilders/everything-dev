import type { AnyRoute } from "@tanstack/react-router";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { createMountRegistry, MOUNT_ALIASES } from "./mount-registry";

/**
 * Plugin contract v2 — a UI plugin exports its route tree and nothing else.
 * The host composes any set of these, source-agnostic. The mount declaration
 * lives IN the plugin's routes: a pathless layout whose id's last segment
 * starts with `_` is a mount declaration (`_public` → `public`).
 */
export interface WebPluginModule {
  /** host-side identifier (remote name). Used ONLY to namespace route ids. */
  name: string;
  /** the plugin's full route tree (generated `routeTree` or code-built `tree`). */
  tree: AnyRoute;
}

export interface ComposedApp {
  routeTree: AnyRoute;
  mountCounts: Record<string, number>;
  pluginTreeChildren: Record<string, number>;
}

function deriveMountId(route: AnyRoute): string | undefined {
  const raw = (route as unknown as { options?: { id?: string } }).options?.id ?? "";
  const seg = raw.split("/").filter(Boolean).at(-1) ?? "";
  return seg.startsWith("_") ? seg.slice(1) : undefined;
}

/**
 * Generic host composition — the SAME composeApp the web-grafting prototype
 * proved. It never references plugin names ("dashboard", "landing"): it walks
 * each tree's root children, derives mounts from `_<mount>` roots, resolves
 * through the mount registry, auto-namespaces ids (`<plugin>__<mount>`),
 * reparents the subtree root, and grafts. Which UI remote provided the tree
 * (base or tenant) is invisible to it.
 */
export function composeApp(plugins: WebPluginModule[]): ComposedApp {
  const rootRoute = createRootRoute({
    component: () => (
      <div style={{ fontFamily: "system-ui, sans-serif" }}>
        <header style={{ padding: 8, borderBottom: "1px solid #333" }}>
          <Link to="/">Home</Link>{" "}
          <Link to="/about">About</Link>{" "}
          <Link to="/dashboard">Dashboard</Link>{" "}
          <Link to="/dashboard/analytics">Analytics</Link>{" "}
          <Link to="/dashboard/revenue">Revenue</Link>
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
