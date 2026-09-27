# everything.dev v2 — Web Plugin Architecture

## Vision

Web plugins are **standard TanStack Router apps.** File-based routing. Generated route tree.
Nothing custom. They deploy as Module Federation remotes. The host composes them by grafting
their route trees into mount points. The host never knows what plugins exist — only mount points.
Tenants override any plugin by URL. The framework handles the rest.

For the React Native target, see [native.md](./native.md).

## Prototype

A runnable prototype in [beta-v2-prototype/](../prototypes/beta-v2/) validates
this architecture — 4 code-based + 1 file-based remote served independently
over Module Federation, composed by `composeApp()` into host mount points.
See the "Prototype Findings" section below for what was proven and what
defects the prototype caught.

## Design Principles

1. **Standard TanStack Router** — plugins use file-based routing (or code-based, or virtual). They
   export `routeTree`. That's it. No special conventions beyond a thin `__root.tsx`.
2. **Graft, don't merge** — the host grafts entire plugin route trees as children of host layout
   routes. No route surgery. No deep traversal. `addChildren()` is the only API.
3. **Mount points, not plugin names** — the host defines pathless layout routes (`_public`,
   `_auth`, `_admin`). Plugins declare their mount point by using the matching layout route ID.
   The host iterates over an opaque map of plugin trees.
4. **Full-stack plugins own their frontend** — a plugin with a `web/` directory is self-contained:
   backend contract + web routes. Standalone web plugins live in `web/`.
5. **One `apiClient`, all surfaces** — the host injects the composed `apiClient` into router
   context. Any component in any plugin calls any backend plugin's API typesafely.
6. **MF remotes at runtime** — plugins build and deploy independently. The host loads their
   `routeTree` exports at boot. Tenants point at different URLs for overrides.
7. **File-based OR code-based** — the host only needs `routeTree`. How the plugin builds it is
   irrelevant.
8. **All through `everything-dev`** — no shared packages. `everything-dev/web` for composition,
   `everything-dev/api` for the API client, `everything-dev/auth` for auth, `everything-dev/config`
   for runtime config.

## `everything-dev` Subpath Exports

All imports come from one package:

```json
{
  "exports": {
    ".": "./src/app.ts",
    "./web": "./src/web/index.ts",
    "./native": "./src/native/index.ts",
    "./api": "./src/api-client.ts",
    "./auth": "./src/auth-core.ts",
    "./config": "./src/runtime-config.ts",
    "./types": "./src/types.ts",
    "./mf-build": "./src/mf-build.ts"
  }
}
```

```typescript
// Host imports
import { composeApp } from "everything-dev/web";
import { createApiClient } from "everything-dev/api";
import { createAuthClient } from "everything-dev/auth";

// Plugin imports
import { defineWebPlugin } from "everything-dev/web";
```

## Core Insight: `getParentRoute` Is Type-Level Only

TanStack Router Discussion #585 confirms: `getParentRoute` exists solely for TypeScript type
inference. The runtime route hierarchy is determined by `addChildren()`. This means grafting is
trivial — no `Route.update()` needed:

```typescript
// Just add the plugin's route tree as a child of the host layout.
// The plugin's internal parent references (for nested routes) stay correct.
const tree = hostRootRoute.addChildren([
  hostAuthLayout.addChildren([
    pluginDashboardTree,  // entire plugin route tree grafted here
    pluginSettingsTree,   // entire plugin route tree grafted here
  ]),
]);
```

The plugin's `getParentRoute` is stale (points to its standalone root), but runtime routing uses
the `addChildren` structure, which is correct.

## How Mount Points Work

### Host defines layouts

```
host/src/routes/
├── __root.tsx       → <html>, <head>, ThemeProvider, QueryClientProvider, <Scripts>
├── _public.tsx      → no auth, marketing layout (nav, footer)
├── _auth.tsx        → session required, app layout (sidebar, user menu, auth check)
└── _admin.tsx       → session + admin role required
```

Each layout route has an ID (the file name root). These IDs ARE the mount point names: `public`,
`auth`, `admin`.

### Plugins declare mount points

```
plugins/auth/web/src/routes/
├── __root.tsx       → thin, just <Outlet />
├── _public.tsx      → "I mount under public"
│   ├── login.tsx
│   └── signup.tsx
└── _auth.tsx        → "I mount under auth"
    ├── profile.tsx
    └── api-keys.tsx

plugins/dashboard/web/src/routes/
├── __root.tsx       → thin, just <Outlet />
└── _auth.tsx        → "I mount under auth"
    ├── index.tsx
    ├── analytics.tsx
    └── $reportId.tsx

web/landing/src/routes/
├── __root.tsx       → thin, just <Outlet />
└── _public.tsx      → "I mount under public"
    ├── index.tsx
    └── about.tsx
```

A plugin can have MULTIPLE mount points. The auth plugin mounts login/signup under `_public` and
profile/api-keys under `_auth`. A single plugin contributes routes to multiple host layouts.

### Host composes generically

```typescript
// everything-dev/web/compose.ts
export async function composeApp(
  pluginTrees: Record<string, RouteTree>,
): Promise<RouteTree> {
  // 1. Build host mount point layouts
  const mountPoints = {
    public: createRoute({ id: "public", component: PublicLayout, getParentRoute: () => rootRoute }),
    auth: createRoute({ id: "auth", component: AuthLayout, getParentRoute: () => rootRoute }),
    admin: createRoute({ id: "admin", component: AdminLayout, getParentRoute: () => rootRoute }),
  };

  // 2. Group plugin trees by mount point
  const subtreesByMount = new Map<string, RouteTree[]>();
  for (const tree of Object.values(pluginTrees)) {
    for (const child of tree.children ?? []) {
      const mountId = child.options.id;  // "public", "auth", "admin"
      if (mountPoints[mountId]) {
        subtreesByMount.get(mountId)!.push(child);
      }
    }
  }

  // 3. Graft each group into its host layout
  const populatedMounts = Object.entries(mountPoints).map(([id, layout]) =>
    layout.addChildren(subtreesByMount.get(id) ?? []),
  );

  return rootRoute.addChildren(populatedMounts);
}
```

The host never references `"dashboard"`, `"landing"`, `"auth"` in logic. Only mount IDs. The loop
works on an opaque map of plugin trees.

## Prototype Findings (validated `/plans/prototypes/beta-v2/`)

A runnable prototype (`plans/prototypes/beta-v2/`, pnpm + rsbuild + Module Federation enhanced
runtime, verifiable headlessly with `host/src/verify.ts` and `host/src/browser-check.ts`) was
built to prove this architecture. All findings below are observed in the live prototype against
`@tanstack/react-router@1.157.16` and `@module-federation@2.8`. **The plan doc's original
`composeApp` sketch had three defects that the prototype caught and fixed.**

### 1. `getParentRoute` Is NOT Type-Level Only — The Render Branch Uses It

The plan claimed `getParentRoute` is "type-level only" and the runtime hierarchy comes from
`addChildren()`. **Not true.** Route *matching* (segment trie) does use the `children` array, but
the **rendered match branch** (`buildRouteBranch` in router-core) walks `route.parentRoute` up the
chain. If a grafted plugin subtree root still points its `getParentRoute` at the plugin's own
root, the host mount layouts never appear in the render branch:

```
before fix:  __root__ → /public/landing-public → /public/landing-public/        ← host /public MISSING
after fix:   __root__ → /public → /public/landing-public → /public/landing-public/  ← correct
```

**Fix:** at composition time, reparent the *subtree root only* — override its
`options.getParentRoute` to return the host mount route. Descendants keep referencing the same
subtree-root object, so the rest of the chain stays intact. This is one shallow mutation per
subtree, not deep traversal:

```typescript
for (const child of plugin.tree.children ?? []) {
  const mountId = child.options.id.split("/").at(-1)?.slice(1); // "_public" → "public"
  const mount = mountPoints[mountId];
  if (mount) {
    child.options = { ...child.options, getParentRoute: () => mount };
    subtreesByMount[mountId].push(child);
  }
}
```

### 2. Route IDs Must Be Globally Unique, and the Host Can Derive Mounts — Zero Plugin Config

The plan's step 2 read `child.options.id` from each plugin child and matched it to the host mount
(`public`, `auth`, `admin`). This **crashes** with `Duplicate routes found with id: /public` in
two ways:

- The host `public` mount and a plugin's `public` layout root produce the same route ID.
- Two plugins mounting the same point both contribute a `public` root → id collision between
  plugins (independent of the host).

**First fix (superseded):** plugins declared an explicit `mounts: Record<mountId, subtreeRoute>`
map with hand-namespaced root ids (`landing-public`, `dashboard-public`). It removed the crash
but added plugin-facing config: every plugin had to export `mounts`, name itself, and pick
collision-free ids. This conflicted with the design principle that plugins export `routeTree`
"and that's it."

**Final fix (prototyped): the host auto-extracts mounts and auto-namespaces ids.** Plugin config
is eliminated. The mount declaration lives in the plugin's own routes: any pathless layout whose
id's last segment starts with `_` is a mount declaration. A plugin author writes `_public.tsx`
(file-based) or `createRoute({ id: "_public" })` (code-based); the host walks `tree.children`,
derives mount id `public`, and re-ids the subtree root to `<plugin>__<mount>` + reparents it onto
the host mount. The namespacing is invisible — the roots are pathless layouts so the ids never
touch URLs:

```typescript
// plugin — the ONLY export is the tree
export { routeTree } from "./routeTree.gen"; // file-based, or a code-built tree

// host — opaque loop, derives mounts + namespaces ids
for (const plugin of plugins) {
  for (const child of plugin.tree.children ?? []) {
    const seg = child.options.id.split("/").at(-1);   // "_public"
    if (!seg?.startsWith("_")) continue;
    const mountId = seg.slice(1);                      // "public"
    const mount = mountPoints[mountId];
    if (!mount) continue;
    child.options = {
      ...child.options,
      id: `${plugin.name}__${mountId}`,                // "landing__public" — unique
      getParentRoute: () => mount,
    };
    subtreesByMount[mountId].push(child);
  }
}
```

File-based plugins graft cleanly with this: `src/tree.tsx` is a one-line re-export of the
generated `routeTree`, and the `_public`/`_auth` pathless layout roots ARE the mount declarations.
Verified: `remote-filebased` (real `tsr generate` output) + 3 code-based remotes compose with
`public: 3, auth: 2, admin: 1`.

### 3. The Host Must Join the Shared Singleton Scope

A host that renders remote components but defines no Federation shared config gets a
`Cannot read properties of null (reading 'useContext')` / `Invalid hook call` error: the remotes
dedupe React via MF, but the host bundles its own copy, so remote components run hooks against a
different React than the renderer.

**Fix:** the host must (a) include `pluginModuleFederation` with `react`, `react-dom`,
`@tanstack/react-router` marked `singleton: true, eager: true`, and (b) use the embedded runtime
via `registerRemotes`/`loadRemote` (NOT a fresh `createInstance` — that spawns a second host
instance with no shared config, silently undoing the singleton). Verified in the browser:
all `react-ref` exposes resolve to `===` the host's React object.

### What's Proven Working (headless + browser, headless Chrome via CDP)

- 4 code-based + 1 file-based remote served independently over Module Federation (ports 3101–3105).
- Plugin surface is a single `tree` export — no `mounts` map, no `name`, no namespaced ids.
- Host loads all 5; `composeApp` auto-derives mounts from `_<mount>` layout roots and grafts
  `public: 3, anon: 0, authenticated: 2, admin: 1, organization: 1`.
- All 12 cross-remote routes match with host mount chrome in the render branch, including
  parameterized org routes with `$orgSlug` param resolution.
- Full-page nav + SPA nav (via `Link`) work with **zero reloads** for in-app navigation.
- **SSR works by exclusion** (`host/src/verify-ssr.tsx`): the host composes the same plugin trees
  server-side and streams routes to HTML through `createRequestHandler` +
  `renderRouterToStream`. Public mounts SSR fully; session-gated mounts (`authenticated`,
  `admin`, `organization`) are `ssr: false` and render nothing server-side — so SSR never sees
  session-dependent content and needs no server-side session resolution.
- File-based companion uses the plan's exact convention (`_public.tsx`, `_auth.tsx` in
  `src/routes/`) plus real `tsr generate` output; `tree.tsx` is a one-line re-export.

Plain `<a href>` tags do full page navigations; SPA navigation requires TanStack `Link`.

### 4. Mount Points Are a Registry, Not Host Routing Code — Auth/Org/SSR Shape It

After the `tree`-only contract landed, mount points were no longer host route files but a
**mount registry** (`host/src/mount-registry.tsx`) — a data structure mapping mount ids to
behavior:

```typescript
const mountRegistry = {
  public:        { kind: "static", route: publicRoute },
  anon:          { kind: "static", route: anonRoute },            // redirected if authed
  authenticated: { kind: "static", route: authenticatedRoute },   // session required
  admin:         { kind: "static", route: adminRoute },           // admin role required
  organization:  { kind: "parameterized", parentRoute: organizationRoot, paramRoute: orgSlugRoute },
};
```

The compose loop is now fully generic: it walks `_<mount>` roots, looks the id up in the
registry, and grafts — adding `_billing` later is one registry entry, zero host routing code.

Two mount categories:

- **Static (pathless):** `public`, `anon`, `authenticated`, `admin` — no URL footprint; auth
  gate in the mount's `beforeLoad`. `_auth` aliases to `authenticated` for back-compat.
- **Parameterized (has URL segments):** `organization` — the host owns `/organization/$orgSlug`.
  The `$orgSlug` route's `beforeLoad` runs with the param resolved, so membership checks live
  HERE once for every plugin that mounts under `_organization`. Plugins write `_organization/`
  and see `$orgSlug` in params — they never write the URL segment or the membership check.

**Auth lives on the mount, never the plugin.** Plugin subtrees inherit the gate from the mount
route's `beforeLoad`, and the loader provides context (e.g. org data). The prototype uses a mock
session (`MOCK_ADMIN_USER`); production swaps in Better Auth session/membership lookups behind
the same interface.

**Why the registry maps to Better Auth's model (organizations, SSO, teams):**

- **Slugs in URLs** — Better Auth identifies orgs by `organizationSlug` (create, lookup, SSO
  sign-in). The parameterized mount's `$orgSlug` is the same key, so `/organization/acme/...`
  needs no translation layer.
- **Per-org SSO** — SSO providers are linked to orgs via `organizationId` and resolved before a
  session exists. The mount never sees SSO: it gate-checks the resulting session + active org.
- **Active org** — Better Auth stores it in the session. The mount can read it to validate or
  redirect; the prototype proves the param/context plumbing.
- **Teams are org-nested, not a top-level mount** — Better Auth's teams are a sub-feature of the
  organization plugin (`teams: { enabled: true }`). So `_team` is deliberately NOT in the
  registry as a sibling mount: team routes live inside `_organization/` plugins where the `$orgSlug`
  context is already established. A top-level `_team` mount would imply URL ambiguity (team
  without an org).

**`ssr: false` on session-gated mounts is the clean SSR story.** Because the gate requires a
session, session-gated mounts are marked `ssr: false` at registry definition. The server renders
nothing for those subtrees — no server-side session lookup, no redirect handling in SSR, and the
public/anon surface still SSR-fully. This answers the "SSR is a problem for auth-gated routes"
concern structurally rather than per-route.

### Collision policy (prototyped): first-wins

`host/src/collision-probe.ts` verifies what happens when two plugins declare the same leaf path
on the same mount (both `_public` roots with `/blog`). Because subtree roots are auto-namespaced
(`a__public`, `b__public`), route ids stay unique and TSR builds without error; the duplicate
URL path silently resolves to the first-registered plugin's match. No host-side fix required for
id uniqueness — only URL-path ambiguity remains, resolved first-wins.

### Remaining Open Questions (not yet prototyped)

- SSR in production would load plugin trees over MF's Node runtime (`loadRemote(..., { from:
  "build" })`) instead of importing source — the prototype's `verify:ssr` proves the compose +
  render + ssr-exclusion pipeline headlessly; the Node-side MF remote load is standard
  infrastructure.
- **Dynamic params across plugins** — first-wins is proven; a per-plugin leaf-path prefix (to keep
  BOTH matches reachable) is a product decision, not an architecture blocker.
- **Real Better Auth wiring** — the mock session (`MOCK_ADMIN_USER`) proves the mount contract;
  connecting `beforeLoad` to `auth.api.*` (session, `getFullOrganization({ organizationSlug })`,
  active-org semantics) is a straightforward swap behind the same interface.

## Directory Structure

```
everything.dev/
├── app.ts                              # composition root
├── host/
│   └── src/
│       ├── mount-registry.tsx          # mount point definitions (layout, auth, ssr, URL)
│       └── services/
│           ├── config.ts
│           ├── web-compose.ts          # composeApp() + SSR
│           └── tenant-runtime.ts       # per-request plugin URL resolution
├── web/                                # standalone web plugins (no backend)
│   ├── landing/
│   │   └── src/routes/
│   │       ├── __root.tsx              # thin <Outlet />
│   │       ├── _public.tsx             # mount: public
│   │       ├── index.tsx
│   │       └── about.tsx
│   ├── about/
│   └── _template/                      # bos web-plugin add scaffold
├── native/                             # standalone native plugins (no backend)
│   └── _template/
├── plugins/
│   ├── auth/                           # full-stack plugin
│   │   ├── src/                        # backend (contract, services, router)
│   │   │   ├── contract.ts
│   │   │   ├── index.ts
│   │   │   └── services/
│   │   ├── web/                        # web frontend (routes for login, profile, settings)
│   │   │   └── src/routes/
│   │   │       ├── __root.tsx
│   │   │       ├── _public.tsx         # mount: public
│   │   │       │   ├── login.tsx
│   │   │       │   └── signup.tsx
│   │   │       └── _auth.tsx           # mount: auth
│   │   │           ├── profile.tsx
│   │   │           └── api-keys.tsx
│   │   └── native/                     # native frontend (React Native screens)
│   │       └── src/screens/
│   ├── dashboard/                      # full-stack plugin
│   │   ├── src/
│   │   ├── web/
│   │   └── native/
│   ├── registry/                       # backend-only (no web/ or native/ → headless)
│   │   └── src/
│   └── _template/
│       ├── src/
│       ├── web/                        # included by default
│       └── native/                     # included by default
├── api/                                # thin structural shell
│   └── src/
│       ├── contract.ts
│       └── index.ts
└── packages/
    ├── everything-dev/
    │   └── src/
    │       ├── app.ts                  # App, Plugin, WebPlugin, NativePlugin constructors
    │       ├── api-client.ts           # "everything-dev/api"
    │       ├── auth-core.ts            # "everything-dev/auth"
    │       ├── runtime-config.ts       # "everything-dev/config"
    │       ├── types.ts                # "everything-dev/types"
    │       ├── mf-build.ts             # "everything-dev/mf-build"
    │       ├── web/
    │       │   ├── index.ts            # "everything-dev/web" — composeApp, defineWebPlugin
    │       │   └── compose.ts
    │       ├── native/
    │       │   ├── index.ts            # "everything-dev/native" — loadNativePlugins
    │       │   └── compose.ts
    │       └── cli/
    └── every-plugin/
        └── src/
            ├── plugin.ts
            └── ...
```

## The `app.ts` Surface

```typescript
// base — multiagency.near / multiagency.ai
export default App({
  account: "multiagency.near",
  domain: "multiagency.ai",

  auth: BetterAuth({
    extends: "bos://auth.near/auth.dev#app.auth",
  }),

  api: API({
    path: "api",
    plugins: {
      registry: Plugin("registry").path("plugins/registry"),
    },
  }),

  // Full-stack plugins: web/ dir auto-discovered
  plugins: {
    auth: Plugin("auth").path("plugins/auth"),
    dashboard: Plugin("dashboard").path("plugins/dashboard"),
  },

  // Standalone web plugins
  web: {
    landing: WebPlugin("landing").path("web/landing"),
    about: WebPlugin("about").path("web/about"),
  },

  // Native plugins
  native: {
    home: NativePlugin("home").path("native/home"),
    dashboard: NativePlugin("dashboard").path("plugins/dashboard/native"),
    profile: NativePlugin("profile").path("plugins/auth/native"),
  },
});

// Tenant — otheragency.near / otheragency.multiagency.ai
export default App({
  account: "otheragency.near",
  domain: "otheragency.multiagency.ai",
  extends: "bos://multiagency.near/multiagency.ai",

  // Override any web plugin
  web: {
    landing: WebPlugin("landing").path("web/my-landing"),
    dashboard: WebPlugin("dashboard").path("web/my-dashboard"),
    // about, auth-web, others: inherited from base
  },

  // Override any native plugin
  native: {
    home: NativePlugin("home").path("native/my-home"),
    // dashboard, profile: inherited from base
  },
});
```

Auto-discovery: if `plugins/dashboard/` has a `web/` dir, `bos dev` picks it up as a web
plugin. If it has a `native/` dir, picked up as a native plugin. Backend-only plugins (registry)
have neither — no frontend contributed.

## Auth Model

Auth is a host mount point, not a plugin concern. The host's `_auth` layout route handles session
checks. Plugins declare they need auth by using the `_auth` mount point.

Role-based checks live in individual routes' `beforeLoad`, same as today:

```typescript
// plugins/dashboard/web/src/routes/_auth/admin.tsx
export const Route = createFileRoute("/_auth/admin")({
  beforeLoad: ({ context }) => {
    if (context.session?.user?.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  component: AdminPage,
});
```

The auth PLUGIN provides:
- Backend: contract, Better Auth + NEAR SIWN, session management
- Web frontend: login/signup pages (mounts under `_public`), profile/api-keys pages (mounts under
  `_auth`)

Login is a regular route in the auth plugin's `_public` subtree. The host's `_auth` layout
redirects to `/login` if no session. No special login handling in the host.

## API Client

The host injects one `apiClient` into router context. All components access it via
`Route.useRouteContext()`. The client covers every plugin contract:

```typescript
// In any component, in any plugin:
const { apiClient } = getRouteApi("/_auth").useRouteContext();

// Call your own plugin's API
await apiClient.dashboard.getStats();

// Call another plugin's API
await apiClient.registry.listApps({ limit: 10 });

// Call auth API
await apiClient.auth.getProfile();
```

## SSR

`composeApp()` builds the merged route tree. The host creates per-request routers for SSR:

```typescript
// host/src/routes/ssr.ts
app.get("*", async (c) => {
  const resolved = await resolveRequestRuntime(baseConfig, c.req.raw);
  const pluginTrees = await loadPluginTrees(resolved.config);

  const routeTree = await composeApp(pluginTrees);

  const handler = createRequestHandler({
    request: c.req.raw,
    createRouter: () =>
      createRouter({
        routeTree,
        history: createMemoryHistory(),
        context: {
          queryClient: new QueryClient(),
          runtimeConfig: resolved.config,
          apiClient: createPluginsClient(allPlugins),
          authClient: createAuthClient(resolved.config),
          session: c.get("session"),
        },
      }),
  });

  const response = await handler(
    ({ request, responseHeaders, router }) =>
      renderRouterToStream({
        request,
        responseHeaders,
        router,
        children: <RouterServer router={router} />,
      }),
  );

  return new Response(response.body, overrides in headers);
});
```

## Deployment Model

### Dev (`bos dev`)

- Each web plugin starts its own dev server (MF remote on localhost)
- Host loads route trees from local dev URLs
- File-based routing codegen runs in each plugin's workspace
- Full hot reload across all workspaces

### Publish (`bos publish --deploy`)

```
1. For each web plugin (full-stack web/ + standalone web/):
   → build MF remote
   → deploy to Zephyr
   → record URL + integrity in publish manifest

2. For each native plugin (full-stack native/ + standalone native/):
   → build Re.Pack container (.bundle per platform)
   → deploy to Zephyr
   → record URL + integrity

3. Build host:
   → composeApp() with resolved plugin URLs
   → build host remote (includes composed route tree)
   → deploy host to Zephyr

4. Publish config to FastKV:
   web.plugins.landing = "https://landing.uuid.zephyr.app"
   web.plugins.dashboard = "https://dashboard.uuid.zephyr.app"
   native.plugins.home.ios = "https://home-ios.uuid.zephyr.app"
   native.plugins.home.android = "https://home-android.uuid.zephyr.app"
   app.web = "https://host.uuid.zephyr.app"
```

### Tenant publish

```
1. Build only overridden web/native plugins → deploy to Zephyr
2. Publish config:
   web.plugins.landing = "https://tenant-landing.uuid.zephyr.app"
   # All others: unset → host resolves from extends chain
```

## Tenant Model

Tenants are covered in detail in [tenants.md](./tenants.md). Three tiers:

| Tier | Domain | Host | Sandbox | Sync |
|---|---|---|---|---|
| **Tier 1** | `other.multiagency.ai` | Shared | Browser (web) | Automatic (30s TTL) |
| **Tier 2** | `superagency.ai` | Own deploy | Process (full) | Automatic (30s TTL) |
| **Tier 3** | `superagency.ai` | Own deploy + own backend | Process (full) | Automatic + manual host upgrades |

All tiers use the same `app.ts` surface and the same plugin composition model. The extends
chain provides auth, API, and backend plugins. Tenant overrides change only which URLs are
resolved for specific plugins.

### Tenant Runtime Resolution

At request time (`tenant-runtime.ts`):

```
1. Detect tenant from hostname → resolve NEAR account ID
2. Fetch base config from extends chain (30s cache TTL)
3. Fetch tenant's published config
4. Verify extends chain, account match, status (active)
5. Merge: tenant plugin URLs override base plugin URLs
6. Verify integrity of all overridden remotes
7. Load plugin route trees from resolved URLs
8. composeApp() → build route tree
9. SSR or client-shell render
```

When base publishes an updated dashboard plugin, the tenant's host re-fetches base config (30s
cache TTL), discovers the new dashboard URL, and loads the updated tree. No tenant action.
No tenant rebuild. Automatic sync.

## What File-Based Routing Looks Like for Plugin Devs

A plugin's `__root.tsx` is thin:

```typescript
// plugins/dashboard/web/src/routes/__root.tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
});
```

Everything else is standard TanStack Router file-based routing. `routeTree.gen.ts` is generated
from the file system. The plugin exports it:

```typescript
// plugins/dashboard/web/src/plugin.ts
export { routeTree } from "./routeTree.gen";
```

That's the entire surface. No code-based routing. No special exports. No wrapping. Just a standard
TanStack Router project.

For standalone dev (running the plugin in isolation without the host):

```typescript
// plugins/dashboard/web/src/standalone.tsx
import { routeTree } from "./routeTree.gen";
import { createRouter, RouterProvider, createRootRoute } from "@tanstack/react-router";

function StandaloneShell() {
  return (
    <html>
      <head><title>Dashboard Plugin</title></head>
      <body><Outlet /></body>
    </html>
  );
}

const standaloneRoot = createRootRoute({ component: StandaloneShell });
const tree = standaloneRoot.addChildren(routeTree.children.map(c => /* reparent if needed */ c));
const router = createRouter({ routeTree: tree });

root.render(<RouterProvider router={router} />);
```

## Generated Types

Same pattern as today. The type generator reads the `app.ts` graph instead of `bos.config.json`:

```typescript
// .bos/plugin-types.d.ts (generated, gitignored)
declare module "everything-dev" {
  interface KnownPlugins {
    auth: typeof _auth;
    registry: typeof _registry;
    dashboard: typeof _dashboard;
  }
  interface KnownWebPlugins {
    landing: WebPluginRef;
    about: WebPluginRef;
    dashboard: WebPluginRef;
    "auth-web": WebPluginRef;
  }
  interface KnownNativePlugins {
    home: NativePluginRef;
    dashboard: NativePluginRef;
    profile: NativePluginRef;
  }
}
```

## Risks & Limitations

| Risk | Mitigation |
|---|---|
| `getParentRoute` stale at graft boundary (render branch follows it, not `children`) | **Prototype fix:** reparent the subtree root's `options.getParentRoute` to the host mount at compose time. One shallow mutation per subtree; no deep traversal. See "Prototype Findings". |
| Duplicate route IDs when plugins match mount by layout id | **Prototype fix:** no plugin config at all — the host auto-derives mount points from `_<mount>` pathless layout roots and auto-namespaces subtree root ids (`<plugin>__<mount>`). Route ids always unique; only URL paths can collide (first-wins). |
| Host must share React/Router with remotes or hook calls break | Host must include `pluginModuleFederation` with `react`/`react-dom`/`@tanstack/react-router` as `singleton: true, eager: true` and load remotes via the embedded runtime (`registerRemotes`/`loadRemote`), never a fresh `createInstance`. |
| Plugin root must be thin (`<Outlet />`) | Scaffold enforces this. Lint rule catches `<html>` in plugin `__root.tsx`. |
| N plugin remote loads at boot | 5–10 remotes is fine. Beyond that, bundle manifests into a single remote. |
| File-based codegen must run in each workspace | `bos dev` manages this. Same as today's `api/` contract regeneration. |
| Plugins can't have nested `__root__` routes | Structurally impossible — there's one root. Plugins use pathless layout routes instead. |
| Two plugins drop the same dynamic leaf path (`/products/$id`) on one mount | First-wins (prototyped): subtree roots are namespaced so ids stay unique; the duplicate URL path silently resolves to the first-registered plugin's match. Keeping BOTH reachable (per-plugin leaf path prefix) is a product decision. |
| Mount points need host changes to add | False — mount points are a registry (`mount-registry.tsx`), not host route files. New `_<mount>` ids resolve via the generic compose loop; only a new LAYOUT/auth-semantics require a registry entry. |
| Auth-gated routes leak to SSR | Session-gated mounts are `ssr: false` at registry definition. The server renders nothing for those subtrees — no server-side session lookup or redirect handling. |
| Parameterized mounts collide with plugin URLs | The host owns `/organization/$orgSlug`; plugin leaves use relative paths, so `/organization/acme/dashboard` is unambiguous. Two plugins both claiming the same leaf under one org mount are first-wins. |

## What Gets Removed From Current UI

| Removed | Reason |
|---|---|
| `ui/src/routeTree.gen.ts` (single tree) | Each plugin has its own generated tree |
| `ui/src/router.tsx` (single router) | Composited per-request via `composeApp()` |
| `ui/src/router.server.tsx` (single SSR router) | Merged into `host/src/services/web-compose.ts` |
| `ui/src/app.ts` (monolithic `createRouter`) | Router context provided by host |
| `ui/src/routes/` (flat, all routes) | Split per-plugin: `plugins/*/web/src/routes/` and `web/*/src/routes/` |
| `ui/src/hydrate.tsx` (single client bootstrap) | Host provides unified client bootstrap |
| `packages/api-client/` | Folded into `everything-dev/api` |
| `packages/auth-core/` | Folded into `everything-dev/auth` |
| `packages/runtime-config/` | Folded into `everything-dev/config` |

## Implementation Phases (within beta-v2)

### Phase A: Plugin Grafting + `composeApp`

- Implement `composeApp()` in `everything-dev/web/compose.ts`
- Refactor host to use `composeApp()` instead of single `loadRouterModule()` call
- Host defines mount points as pathless layout routes
- Full-stack plugin structure (`plugins/dashboard/web/`)
- Standalone web plugin structure (`web/landing/`)
- Type generation from `app.ts` graph

### Phase B: `everything-dev` Consolidation

- Fold `api-client`, `auth-core`, `runtime-config` into `everything-dev`
- Add subpath exports: `./api`, `./auth`, `./config`, `./web`, `./native`
- Remove `packages/api-client/`, `packages/auth-core/`

### Phase C: Multi-Remote Build + Deploy

- Shared `mf-build.ts` for web plugin workspaces
- `bos dev` spins up all web plugin dev servers
- `bos publish --deploy` builds all web plugins → deploys to Zephyr
- Host build composes plugin URLs into single remote

### Phase D: Tenant Web Overrides

- Per-request plugin URL resolution in `tenant-runtime.ts`
- Tenant `app.ts` overrides individual `web:` plugin URLs
- Automatic sync: base plugin updates flow to tenants via config cache TTL

### Phase E: MF Runtime Load

- Remove build-time plugin URL embedding
- Host loads plugin `routeTree` from MF remotes at boot time
- SSR per-request router creation from loaded trees
- Client-side hydration from same composed tree
