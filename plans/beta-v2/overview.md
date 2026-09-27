# everything.dev v2 — Beta Plan (Entry)

## Vision

A developer writes an `app.ts` file declaring their application's components. The runtime
composes them. That's it.

No CDN URLs in source. No integrity hashes. No build-time coupling. `path` for local
workspaces. `extends` for published modules. The compute pipeline handles deployment. The host
is 100% generic — it composes any combination of plugins into a running app. Tenants override
anything by URL. Everything is verifiable on-chain via FastKV.

## Sub-Plans

| Plan | Covers |
|---|---|
| [ui.md](./ui.md) | Web plugin architecture — TanStack Router, mount points, `composeApp()`, grafting, SSR |
| [tenants.md](./tenants.md) | Tenant model — three tiers, sandboxing, data isolation, verifiable deployment graph, city node / marketplace / agency examples |
| [native.md](./native.md) | Native (React Native) target — Re.Pack, React Navigation, native plugin structure, token auth |
| [composable.md](./composable.md) | Code-based `app.ts` composition model — `App()`, `Plugin()`, `WebPlugin()`, `NativePlugin()` constructors, type system |

## Design Principles

1. **Code is the composition** — `app.ts` declares everything. No config file → runtime
   translation. Full type safety.
2. **Everything is a remote** — web, API, auth, native plugins load via Module Federation at
   runtime. The host orchestrates only.
3. **Graft, don't merge** — the host grafts plugin route trees into mount points.
   `addChildren()` is the only API. No route surgery.
4. **Mount points, not plugin names** — the host defines pathless layout routes (`_public`,
   `_auth`, `_admin`). Plugins declare their mount point by matching the layout route ID. The
   host iterates over an opaque map of plugin trees.
5. **Effect-native** — Layer-based plugins, `.effect()` handlers, `yield* Tag`.
6. **All through `everything-dev`** — no shared packages. One dependency with subpath exports:
   `everything-dev/web`, `everything-dev/native`, `everything-dev/api`, `everything-dev/auth`,
   `everything-dev/config`.

## The `app.ts` Surface

```typescript
export default App({
  account: "multiagency.near",
  domain: "multiagency.ai",

  auth: BetterAuth({ extends: "bos://auth.near/auth.dev#app.auth" }),
  api: API({ path: "api", plugins: { registry: Plugin("registry").path("plugins/registry") } }),

  plugins: {
    auth: Plugin("auth").path("plugins/auth"),
    dashboard: Plugin("dashboard").path("plugins/dashboard"),
  },

  web: {
    landing: WebPlugin("landing").path("web/landing"),
    dashboard: WebPlugin("dashboard").path("plugins/dashboard/web"),
  },

  native: {
    home: NativePlugin("home").path("native/home"),
    dashboard: NativePlugin("dashboard").path("plugins/dashboard/native"),
  },
});
```

## Plugin Model

### Backend Plugins (`every-plugin`)

```typescript
export default createPlugin({
  variables: z.object({}),
  secrets: z.object({ DATABASE_URL: z.string() }),
  contract,

  initialize: (config) =>
    MyService.Live.pipe(
      Layer.provide(
        Layer.effect(Database, Drizzle.Postgres(config.secrets.DATABASE_URL, { schema }))
      )
    ),

  createRouter: (builder) => ({
    getById: builder.getById.effect(function* ({ input }) {
      const svc = yield* MyService;
      return yield* svc.findById(input.id);
    }, { errorStatusMap: { NOT_FOUND: 404 } }),
  }),
});
```

Full-stack plugins can also have `web/` and `native/` directories:

```
plugins/dashboard/
├── src/           ← backend (contract, services, router)
├── web/           ← web routes (TanStack Router)
└── native/        ← native screens (React Navigation)
```

### Web Plugins

Standard TanStack Router apps. File-based routing. Export `routeTree`. The host grafts them into
mount points. [Details →](./ui.md)

### Native Plugins

React components or navigation screens. Loaded via Re.Pack `Federated.importModule()`. The host
registers them with React Navigation by mount point. [Details →](./native.md)

## Database Model

Alchemy handles provisioning + migrations. `Drizzle.Postgres(url, { schema })` for Effect-native
queries. Per-plugin Postgres schemas (`plugin_<id>`). Per-tenant schema isolation
(`tenant_<id>_plugin_<id>`). Sovereign tenants get their own Neon branch or project.

## Tenant Model

Three tiers — same `app.ts` surface, same extends chain:

| Tier | Domain | Host | DB | Sync |
|---|---|---|---|---|
| Tier 1 | `other.multiagency.ai` | Shared | Schema-isolated | Automatic |
| Tier 2 | `superagency.ai` | Own deploy | Own Neon branch | Automatic |
| Tier 3 | `superagency.ai` | Own deploy + own backend | Own Neon project | Automatic + host upgrades |

[Details →](./tenants.md)

## Directory Structure

```
everything.dev/
├── app.ts                              # composition root
├── host/                               # web host shell
│   └── src/
│       ├── routes/                     # mount point definitions (_public, _auth, _admin)
│       ├── services/
│       │   ├── config.ts
│       │   ├── web-compose.ts          # composeApp() + SSR
│       │   └── tenant-runtime.ts
│       └── middleware/
├── native/                             # native host shell (RN app)
├── web/                                # standalone web plugins
├── plugins/                            # backend + full-stack plugins
│   ├── auth/
│   │   ├── src/
│   │   ├── web/
│   │   └── native/
│   ├── dashboard/
│   ├── registry/                       # backend-only (no web/ or native/)
│   └── _template/
├── api/                                # thin structural shell
├── packages/
│   ├── everything-dev/
│   │   └── src/
│   │       ├── app.ts                  # App, Plugin, WebPlugin, NativePlugin
│   │       ├── api-client.ts           # "everything-dev/api"
│   │       ├── auth-core.ts            # "everything-dev/auth"
│   │       ├── runtime-config.ts       # "everything-dev/config"
│   │       ├── types.ts
│   │       ├── mf-build.ts
│   │       ├── web/
│   │       │   └── compose.ts
│   │       ├── native/
│   │       │   └── compose.ts
│   │       └── cli/
│   └── every-plugin/
└── tests/
```

## What Gets Removed

| Removed | Replaced by |
|---|---|
| `ui/src/routeTree.gen.ts` (single tree) | Each plugin has its own generated tree |
| `ui/src/router.tsx` (single router) | Composited per-request via `composeApp()` |
| `ui/src/routes/` (flat, all routes) | `plugins/*/web/src/routes/` and `web/*/src/routes/` |
| `ui/src/hydrate.tsx` | Host provides unified client bootstrap |
| `packages/api-client/` | `everything-dev/api` |
| `packages/auth-core/` | `everything-dev/auth` |
| `packages/runtime-config/` | `everything-dev/config` |
| `bos.config.json` / `bos.config.toml` | `app.ts` (TOML auto-generated for FastKV only) |
| `packages/everything-dev/src/cli/sync.ts` | No framework-owned files to sync |
| `packages/everything-dev/src/cli/snapshot.ts` | Snapshot mechanism retired |
| `packages/everything-dev/src/merge.ts` | No config merge needed |
| `api/src/db/migrate.ts` + layer + driver | Alchemy `Drizzle.Schema` + `Drizzle.Postgres` |
| Per-plugin DB file copies | `src/db/schema.ts` + `src/db/db.ts` pattern |

## What Stays the Same

- Hono.js HTTP framework
- TanStack Router + Query (latest)
- Better Auth + NEAR SIWN
- Module Federation for remotes
- FastKV for on-chain config publishing
- Zephyr for CDN
- Re.Pack for React Native MF
- Drizzle ORM + Alchemy for database provisioning
- shadcn/ui + Tailwind (web), gluestack-ui + NativeWind (native)
- Regression test suite
- CI/CD pipeline

## Implementation Phases

### Phase 1: Host Leanification ✅

Split `program.ts` into modules. Zero behavior changes. **Complete** — `program.ts` reduced from ~1,176 to 242 lines. Services, routes, middleware, and lib all extracted.

### Phase 2: rsbuild v2 + Shared Config

Upgrade rsbuild. Extract shared MF config into `everything-dev/mf-build`.

### Phase 3: oRPC v2 + Effect Native

Layer-based `initialize`, `.effect()` handlers, remove re-exports. `Drizzle.Postgres` for
Effect-native queries.

### Phase 4: Database — Alchemy Integration

Replace all proprietary DB infrastructure with Alchemy. `Drizzle.Schema` for migrations.

### Phase 5: `everything-dev` Consolidation + Config

Fold `api-client`, `auth-core`, `runtime-config` into `everything-dev` subpath exports.
`app.ts` replaces `bos.config.json`. Remove `sync.ts`, `snapshot.ts`, `merge.ts`.

### Phase 6: Web Plugin Grafting + `composeApp`

Implement `composeApp()` in `everything-dev/web`. Host uses mount points instead of single
`loadRouterModule()`. Full-stack plugin structure. [Details →](./ui.md)

### Phase 7: Tenant Architecture + Verifiable Deployments

Three-tier tenant model. Schema isolation. Neon branch provisioning. Extends chain verification.
[Details →](./tenants.md)

### Phase 8: Native Plugin Scaffold

`NativePlugin` constructor. `loadNativePlugins()`. Re.Pack host shell. Token auth adapter.
[Details →](./native.md)

### Phase 9: Hot-Swap + MF Runtime Load

Scope-based rebuild on config change. Runtime plugin tree loading from MF remotes. SSR
per-request router creation. Client-side hydration from composed tree.
