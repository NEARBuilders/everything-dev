import type { AnyRoute } from "@tanstack/react-router";
import { createRootRoute, createRoute, Outlet, redirect } from "@tanstack/react-router";
import { digestOf } from "./descriptor";
import type { PluginManifest, RouteRecord } from "./manifest-schema";
import { MOUNT_REGISTRY, type MountDef, type MountId, resolveMountSegment } from "./mount-registry";
import { compareNavItems, type NavDeclaration, type NavItem, type NavManifest } from "./nav";
import { ROUTE_OPTION_KEYS, type RouteConfigModule, type RouteOptionsBundle } from "./route-config";

/**
 * Host-side route-graph construction (ADR 0008 §1): manifests + route
 * configs in → host-built tree out. The host constructs ITS OWN Route
 * objects from validated manifest data via public `createRoute` APIs; no
 * foreign route object is ever mutated. Gates are attached HOST-side from
 * the mount registry — plugins cannot ship a route that escapes its
 * mount's gate because plugins never construct route objects.
 *
 * Mounts are the ONLY cross-source parenting points: a root-level
 * pathless layout file (`_public.tsx`) declares the mount for the whole
 * composition (exactly one declaring source per mount); every other
 * source's routes live under the same `_mount/` directory prefix and
 * parent onto the shared mount route. This module executes inside the
 * core ui's module graph (production MF expose `./compose`, dev source
 * import) so constructed routes are minted by the same react/router
 * instance that renders them.
 */

/**
 * TanStack's Route generics are intentionally invariant — routes built from
 * manifest data can't satisfy them structurally. One named boundary for
 * handing a constructed route to the tree-building APIs.
 */
function toAnyRoute(route: unknown): AnyRoute {
  return route as AnyRoute;
}

export interface GateUser {
  id: string;
  name?: string;
  /** Better Auth user role — "admin" gates the admin mount. */
  role?: string;
}

export interface HostContext {
  user?: GateUser;
  session?: { user?: GateUser };
}

type GateFn = (args: {
  context: HostContext;
  location: { pathname: string; searchStr: string };
}) => void;

/**
 * Gate redirects are absolute: gates attach to root-level mount routes, and
 * relatives would silently shift if a mount ever moved deeper in the tree.
 * The login surface is plugin-owned, never core-known.
 */
const LOGIN_TO: string = "/login";
const HOME_TO: string = "/";

/**
 * Gate implementations by mount gate kind. Only `session` and `admin` are
 * implemented (ADR 0008 §3); unimplemented mounts are rejected during mount
 * declaration before any gate lookup, and gates are optional by type — a
 * mount without an entry (or `none`) renders ungated.
 */
const GATES: Partial<Record<MountDef["gate"], GateFn>> = {
  session: ({ context, location }) => {
    const user = userOf(context);
    if (!user) {
      throw redirect({
        to: LOGIN_TO,
        search: { redirect: location.pathname + location.searchStr } as never,
      });
    }
  },
  admin: ({ context }) => {
    const user = userOf(context);
    if (!user) throw redirect({ to: LOGIN_TO });
    if (user.role !== "admin") throw redirect({ to: HOME_TO });
  },
};

const userOf = (context: HostContext | undefined): GateUser | undefined =>
  context?.user ?? context?.session?.user;

export interface ConstructPluginRef {
  /** composition identity — plugin key; participates in the digest */
  key: string;
  /** deployment identity — the MF container name loadRemote targets */
  mfName: string;
}

export interface ResolvedPlugin {
  key: string;
  manifest: PluginManifest;
  routeConfig: RouteConfigModule;
}

export interface ConstructInput {
  name: string;
  plugins: ReadonlyArray<ConstructPluginRef>;
  resolve: (ref: ConstructPluginRef) => Promise<ResolvedPlugin>;
  /** core ui `__root` options — component/error/notFound + head baseline */
  rootOptions?: RouteOptionsBundle;
}

export interface ConstructedTree {
  rootRoute: AnyRoute;
  routeTree: AnyRoute;
  digest: string;
  manifests: PluginManifest[];
  nav: NavManifest;
  /** constructed route count per mount id */
  mountCounts: Record<string, number>;
}

interface MountDeclaration {
  key: string;
  record: RouteRecord;
  options: RouteOptionsBundle;
}

function joinPath(a: string | undefined, b: string | undefined): string {
  const left = a && a !== "/" ? a.replace(/\/+$/, "") : "";
  const right = b && b !== "/" ? b.replace(/^\/+/, "") : "";
  if (!left) return right ? `/${right}` : "/";
  if (!right) return left;
  return `${left}/${right}`;
}

const navOf = (options: RouteOptionsBundle): NavDeclaration | undefined => {
  const nav = options.staticData?.nav;
  if (nav && typeof nav === "object" && typeof (nav as NavDeclaration).label === "string") {
    return nav as NavDeclaration;
  }
  return undefined;
};

/** Layout routes (mount or pathless) pass their authored options through,
 * like every other route kind. On mount routes the registry gate composes
 * BEFORE the declaration's own beforeLoad so a source can never escape its
 * mount's gate (ADR 0008 §3), while the declaration's return value still
 * flows to children as route context. */
function layoutBeforeLoad(
  gate: GateFn | undefined,
  declared: RouteOptionsBundle["beforeLoad"],
): RouteOptionsBundle["beforeLoad"] {
  if (!gate) return declared;
  return (args) => {
    gate(args);
    return declared?.(args);
  };
}

const AUTHORED_OPTION_KEYS = ROUTE_OPTION_KEYS.filter(
  (key) => key !== "beforeLoad" && key !== "component",
);

function authoredOptions(options: RouteOptionsBundle): Partial<RouteOptionsBundle> {
  const authored: Partial<Record<keyof RouteOptionsBundle, unknown>> = {};
  for (const key of AUTHORED_OPTION_KEYS) {
    if (options[key] !== undefined) authored[key] = options[key];
  }
  return authored as Partial<RouteOptionsBundle>;
}

function rootAuthoredOptions(options: RouteOptionsBundle): Partial<RouteOptionsBundle> {
  const { params: _params, ...authored } = authoredOptions(options);
  return authored;
}

export async function constructTree(input: ConstructInput): Promise<ConstructedTree> {
  const refs = [...input.plugins].sort((a, b) => a.key.localeCompare(b.key));
  const resolved: ResolvedPlugin[] = [];
  for (const ref of refs) {
    resolved.push(await input.resolve(ref));
  }

  const optionsByPlugin = new Map<string, Map<string, RouteOptionsBundle>>();
  for (const plugin of resolved) {
    const optionsById = new Map<string, RouteOptionsBundle>();
    await Promise.all(
      plugin.manifest.routes.map(async (record) => {
        const loader = plugin.routeConfig.routeConfigLoaders[record.id];
        if (!loader) {
          throw new Error(`routeConfig for "${plugin.key}" has no loader for route "${record.id}"`);
        }
        optionsById.set(record.id, await loader());
      }),
    );
    optionsByPlugin.set(plugin.key, optionsById);
  }

  const declarations = new Map<MountId, MountDeclaration>();
  for (const plugin of resolved) {
    for (const record of plugin.manifest.routes) {
      if (!record.mount) continue;
      const mountId = record.mount as MountId;
      const def = MOUNT_REGISTRY[mountId];
      if (!def.implemented) {
        throw new Error(
          `mount "${record.mount}" is declared vocabulary but unimplemented (ADR 0008 §3) — declared by "${plugin.key}"`,
        );
      }
      const existing = declarations.get(mountId);
      if (existing) {
        throw new Error(
          `mount "${mountId}" declared by multiple sources: "${existing.key}" (${existing.record.file}) and "${plugin.key}" (${record.file})`,
        );
      }
      declarations.set(mountId, {
        key: plugin.key,
        record,
        options: optionsByPlugin.get(plugin.key)!.get(record.id)!,
      });
    }
  }

  const rootRoute = toAnyRoute(
    createRootRoute({
      ...(input.rootOptions ? rootAuthoredOptions(input.rootOptions) : {}),
      component: input.rootOptions?.component ?? Outlet,
      ...(input.rootOptions?.beforeLoad ? { beforeLoad: input.rootOptions.beforeLoad } : {}),
    }),
  );

  const mountRoutes = new Map<MountId, AnyRoute>();
  for (const mountId of Object.keys(MOUNT_REGISTRY) as MountId[]) {
    const declaration = declarations.get(mountId);
    if (!declaration) continue;
    const def = MOUNT_REGISTRY[mountId]!;
    const gate = GATES[def.gate];
    const options = declaration.options;
    const route = createRoute({
      id: `__mount_${mountId}`,
      getParentRoute: () => rootRoute,
      ...(gate || options.beforeLoad
        ? { beforeLoad: layoutBeforeLoad(gate, options.beforeLoad) }
        : {}),
      ...authoredOptions(options),
      component: options.component ?? Outlet,
    });
    mountRoutes.set(mountId, toAnyRoute(route));
  }

  const mountByLayoutId = new Map<string, MountId>();
  for (const [mountId, declaration] of declarations) {
    mountByLayoutId.set(declaration.record.id, mountId);
  }

  const nav: NavItem[] = [];
  const mountCounts: Record<string, number> = {};
  const childrenByParent = new Map<AnyRoute, AnyRoute[]>();
  /** cross-plugin path-collision guard: claimed paths per parent route */
  const claimedPathsByParent = new Map<AnyRoute, Map<string, string>>();
  const attach = (parent: AnyRoute, child: AnyRoute) => {
    const list = childrenByParent.get(parent) ?? [];
    list.push(child);
    childrenByParent.set(parent, list);
  };

  for (const plugin of resolved) {
    const optionsById = optionsByPlugin.get(plugin.key)!;
    const fullPathById = new Map<string, string>();
    const mountById = new Map<string, MountId>();
    const byId = new Map<string, { record: RouteRecord; route: AnyRoute }>();

    const parentFor = (
      record: RouteRecord,
    ): { route: AnyRoute; fullPath: string; mount: MountId } => {
      if (record.parentId) {
        const local = byId.get(record.parentId);
        if (local) {
          return {
            route: local.route,
            fullPath: fullPathById.get(record.parentId)!,
            mount: mountById.get(record.parentId)!,
          };
        }
        const mount = mountByLayoutId.get(record.parentId);
        if (mount) return { route: mountRoutes.get(mount)!, fullPath: "", mount };
        throw new Error(
          `unresolvable parent "${record.parentId}" for "${record.id}" in "${plugin.key}" — mounts are the only cross-source parenting points`,
        );
      }
      const firstSegment = record.id.split("/")[0] ?? "";
      if (firstSegment.startsWith("_")) {
        const mount = resolveMountSegment(firstSegment.slice(1));
        if (mount && mountRoutes.has(mount))
          return { route: mountRoutes.get(mount)!, fullPath: "", mount };
        if (mount) {
          throw new Error(
            `mount "${mount}" is not declared by any source (route "${record.id}" in "${plugin.key}")`,
          );
        }
        throw new Error(
          `unknown mount "_${firstSegment.slice(1)}" (route "${record.id}" in "${plugin.key}")`,
        );
      }
      throw new Error(`route "${record.id}" in "${plugin.key}" must live under a mount`);
    };

    const pending = plugin.manifest.routes.filter((record) => !record.mount);
    let progressed = true;
    while (pending.length > 0 && progressed) {
      progressed = false;
      for (let i = 0; i < pending.length; i += 1) {
        const record = pending[i]!;
        if (
          record.parentId &&
          !byId.has(record.parentId) &&
          !mountByLayoutId.has(record.parentId)
        ) {
          continue;
        }
        pending.splice(i, 1);
        progressed = true;

        const options = optionsById.get(record.id)!;
        const parent = parentFor(record);
        const routePath = record.path;
        const isLayoutRoute = record.isLayout || routePath === undefined;
        if (!isLayoutRoute) {
          const siblings = claimedPathsByParent.get(parent.route) ?? new Map<string, string>();
          const claimant = siblings.get(routePath);
          if (claimant) {
            throw new Error(
              `path collision: "${plugin.key}" route "${record.id}" declares "${routePath}" which is already claimed by "${claimant}" under the same parent`,
            );
          }
          siblings.set(routePath, `${plugin.key}:${record.id}`);
          claimedPathsByParent.set(parent.route, siblings);
        }
        const fullPath = joinPath(parent.fullPath, routePath);
        let route: AnyRoute;
        if (isLayoutRoute) {
          route = createRoute({
            id: `${plugin.key}__${record.id}`,
            getParentRoute: () => parent.route,
            ...authoredOptions(options),
            ...(options.beforeLoad ? { beforeLoad: options.beforeLoad } : {}),
            component: options.component ?? Outlet,
          });
        } else {
          route = createRoute({
            path: routePath,
            getParentRoute: () => parent.route,
            ...authoredOptions(options),
            ...(options.beforeLoad ? { beforeLoad: options.beforeLoad } : {}),
            component: options.component ?? Outlet,
          });
        }

        byId.set(record.id, { record, route: toAnyRoute(route) });
        fullPathById.set(record.id, fullPath);
        mountById.set(record.id, parent.mount);
        attach(parent.route, toAnyRoute(route));
        mountCounts[parent.mount] = (mountCounts[parent.mount] ?? 0) + 1;

        const navDeclaration = navOf(options);
        if (navDeclaration && navDeclaration.hidden !== true) {
          nav.push({
            id: `${plugin.key}:${record.id}`,
            label: navDeclaration.label,
            ...(typeof navDeclaration.icon === "string" ? { icon: navDeclaration.icon } : {}),
            ...(typeof navDeclaration.group === "string" ? { group: navDeclaration.group } : {}),
            ...(typeof navDeclaration.order === "number" ? { order: navDeclaration.order } : {}),
            to: navDeclaration.to ?? fullPath,
            plugin: plugin.key,
            mount: parent.mount,
          });
        }
        break;
      }
    }
    if (pending.length > 0) {
      throw new Error(
        `unresolvable parentage in "${plugin.key}": ${pending.map((record) => record.id).join(", ")}`,
      );
    }
  }

  for (const [parent, children] of childrenByParent) {
    (parent as { addChildren: (children: AnyRoute[]) => void }).addChildren(children);
  }
  rootRoute.addChildren([...mountRoutes.values()] as AnyRoute[]);
  nav.sort(compareNavItems);

  const digest = await digestOf({
    plugins: refs.map((ref) => ({ key: ref.key, mfName: ref.mfName })),
    manifests: resolved.map((plugin) => plugin.manifest),
  });

  return {
    rootRoute,
    routeTree: rootRoute,
    digest,
    manifests: resolved.map((plugin) => plugin.manifest),
    nav: { items: nav },
    mountCounts,
  };
}
