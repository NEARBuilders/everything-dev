/**
 * Host-side route-graph construction (ADR 0008 §1): manifests in → host-built
 * tree out. The host constructs ITS OWN Route objects from validated manifest
 * data + generated route-config refs; gates are attached host-side; no
 * foreign route object is ever mutated.
 *
 * Resolution-agnostic: `PluginResolver` abstracts manifest/route-config
 * loading — disk-resolved (dev) or MF-resolved (production) — and the
 * digest deliberately excludes URLs/paths so the same effective composition
 * digests identically on both paths (hydration parity, gate 7).
 */
import {
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import {
  digestOf,
  MOUNT_REGISTRY,
  type PluginManifest,
  type PluginRef,
  type ResolvedApp,
  type RouteOptionsBundle,
} from "@manifest-compose/shared";

export interface HostContext {
  user?: { id: string; name: string; isAdmin?: boolean };
}

export interface ResolvedPlugin {
  key: string;
  mfName: string;
  manifest: PluginManifest;
  routeConfig: RouteOptionsModule;
}

export interface RouteOptionsModule {
  routeConfigLoaders: Record<string, () => Promise<RouteOptionsBundle>>;
  rootMeta?: RouteOptionsBundle;
}

export type PluginResolver = (ref: PluginRef) => Promise<ResolvedPlugin>;

// ---- gates (host policy; plugins never write auth code for mounts) ----

type GateArgs = { context: HostContext; location: { pathname: string } };

const GATES: Record<string, ((args: GateArgs) => void) | undefined> = {
  none: undefined,
  session: ({ context, location }) => {
    if (!context.user) throw redirect({ to: "/login", search: { redirect: location.pathname } });
  },
  admin: ({ context }) => {
    if (!context.user) throw redirect({ to: "/login" });
    if (!context.user.isAdmin) throw redirect({ to: "/" });
  },
};

export interface NavItem {
  path: string;
  label: string;
  order?: number;
}

export interface ConstructedTree {
  rootRoute: any;
  digest: string;
  manifests: PluginManifest[];
  /** Nav manifest assembled from composed routes' staticData (ADR 0008). */
  nav: NavItem[];
  /** Merged plugin __root head metas, lifted by construction. */
  headMetas: Array<Record<string, unknown>>;
}

function joinPath(a: string | undefined, b: string | undefined): string {
  const left = a && a !== "/" ? a.replace(/\/+$/, "") : "";
  const right = b && b !== "/" ? b.replace(/^\/+/, "") : "";
  if (!left) return right ? `/${right}` : "/";
  if (!right) return left;
  return `${left}/${right}`;
}

export async function constructTree(app: ResolvedApp, resolver: PluginResolver): Promise<ConstructedTree> {
  const keys = Object.keys(app.plugins).sort();
  const resolved: ResolvedPlugin[] = [];
  for (const key of keys) {
    resolved.push(await resolver(app.plugins[key]!));
  }

  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });

  const headMetas = resolved
    .map((p) => p.routeConfig.rootMeta?.head?.({})?.meta ?? [])
    .flat();
  rootRoute.options.head = () => ({ meta: headMetas });

  const usedMounts = new Set<string>(
    resolved.flatMap((p) => p.manifest.routes.map((r) => r.mount).filter((m): m is string => Boolean(m))),
  );
  const mountRoutes = new Map<string, any>();
  for (const [mountId, def] of Object.entries(MOUNT_REGISTRY)) {
    if (!usedMounts.has(mountId)) continue;
    const route = createRoute({
      id: `__mount_${mountId}`,
      getParentRoute: () => rootRoute,
      beforeLoad: GATES[def.gate],
      component: () => <Outlet />,
    });
    mountRoutes.set(mountId, route as any);
  }

  const nav: NavItem[] = [];
  const childrenByParent = new Map<any, any[]>();
  const attach = (parent: any, child: any) => {
    let list = childrenByParent.get(parent);
    if (!list) {
      list = [];
      childrenByParent.set(parent, list);
    }
    list.push(child);
  };

  for (const plugin of resolved) {
    const optionsById = new Map<string, RouteOptionsBundle>();
    await Promise.all(
      plugin.manifest.routes.map(async (r) => {
        optionsById.set(r.id, await plugin.routeConfig.routeConfigLoaders[r.id]!());
      }),
    );

    const fullPathById = new Map<string, string>();
    const byId = new Map<string, { record: (typeof plugin.manifest.routes)[number]; route: any }>();

    const pending = [...plugin.manifest.routes];
    let progressed = true;
    while (pending.length > 0 && progressed) {
      progressed = false;
      for (let i = 0; i < pending.length; i++) {
        const record = pending[i]!;
        if (record.parentId && !byId.has(record.parentId)) continue;
        pending.splice(i, 1);
        progressed = true;

        const opts = optionsById.get(record.id)!;
        const parentRoute: any = record.parentId ? byId.get(record.parentId)!.route : mountRoutes.get(record.mount!)!;
        const parentFullPath = record.parentId ? fullPathById.get(record.parentId)! : "";
        const fullPath = joinPath(parentFullPath, record.path ?? (record.isIndex ? "/" : undefined));

        const route = record.isLayout
          ? createRoute({
              id: `${plugin.key}__${record.id}`,
              getParentRoute: () => parentRoute,
              component: opts.component ?? (() => <Outlet />),
            })
          : createRoute({
              path: record.path,
              getParentRoute: () => parentRoute,
              ...(opts.loader ? { loader: opts.loader } : {}),
              ...(opts.beforeLoad ? { beforeLoad: opts.beforeLoad } : {}),
              ...(opts.head ? { head: opts.head } : {}),
              ...(opts.staticData ? { staticData: opts.staticData } : {}),
              component: opts.component ?? (() => <Outlet />),
            });

        byId.set(record.id, { record, route });
        fullPathById.set(record.id, fullPath);
        attach(parentRoute, route);

        const navMeta = opts.staticData?.nav as { label?: string; order?: number } | undefined;
        if (navMeta?.label) {
          nav.push({ path: fullPath, label: navMeta.label, order: navMeta.order });
        }
        break;
      }
    }
    if (pending.length > 0) {
      throw new Error(
        `unresolvable parentage in ${plugin.key}: ${pending.map((r) => r.id).join(", ")}`,
      );
    }
  }

  for (const [parent, children] of childrenByParent) {
    parent.addChildren(children);
  }
  rootRoute.addChildren([...mountRoutes.values()] as any);
  nav.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.path.localeCompare(b.path));

  const digest = await digestOf({
    appName: app.name,
    plugins: keys.map((key) => ({
      key,
      mfName: app.plugins[key]!.source.kind === "remote" ? app.plugins[key]!.source.mfName : key,
    })),
    manifests: resolved.map((p) => p.manifest),
  });

  return { rootRoute, digest, manifests: resolved.map((p) => p.manifest), nav, headMetas };
}
