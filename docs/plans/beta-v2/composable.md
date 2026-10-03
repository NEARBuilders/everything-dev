# everything.dev v2 — Composable (code-based) Beta Plan

## Vision

One TypeScript file. `app.ts`. It composes everything with full type safety. Framework-agnostic. Effect-idiomatic.

```typescript
// app.ts
import { App, TanStackStart, API, Plugin, BetterAuth } from "everything-dev";

export default App({
  account: "dev.everything.near",
  domain: "dev.everything.dev",

  auth: BetterAuth({
    extends: "bos://auth.everything.near/auth.everything.dev#app.auth",
  }),

  api: API({
    path: "api",
    plugins: {
      registry: Plugin("registry").path("plugins/registry"),
    },
  }),

  ui: TanStackStart({ path: "ui" }),
});
```

No CDN URLs. No integrity hashes. No conventional plugin discovery. No `bos.config.toml`. Just `path` for local workspaces and `extends` for published modules. The compute pipeline handles deployment. The host reads the published config — it never executes a tenant's `app.ts`.

## Design Principles

1. **Code is the composition** — `app.ts` is the single source of truth. No config file → runtime translation.
2. **Type-safe by construction** — `Plugin("registry")` resolves to the plugin's oRPC contract type. TypeScript catches missing plugins, wrong databases, and incompatible UI frameworks. Plugin dependencies validated at both compile time (IDE errors) and runtime (DAG ordering).
3. **Framework-agnostic UI** — `TanStackStart` is the first `UI` implementation. `Vite`, `ReactNative`, `Nextjs` follow the same interface. Swapping is a one-line change.
4. **Effect-native** — Layer-based plugins, `.effect()` handlers, `yield* Tag`. `App.run()` and `App.dev()` as Effects deferred to a future release (reuses `everything-dev` start/dev logic internally).
5. **No URLs in authoring** — `path = "ui"` means "the workspace in this repo." `extends = "bos://..."` means "the published module on NEAR." Compute resolves URLs at dev/deploy time.
6. **JSON is the published format** — Published config on FastKV is JSON (as today), auto-generated from `app.ts`. TOML is a local authoring format (see [../infra/toml-infra-alchemy.md](../infra/toml-infra-alchemy.md)). Developers never write the published JSON.
7. **No backward compatibility** — `app.ts` is the only authoring format. No conversion from `bos.config.json`. This repo gets an `app.ts` that replaces the old config.

## Database Model

Alchemy is the database infrastructure. No proprietary migration engine. No framework-owned DB files. No `everything-dev/db`.

### Plugin Database Pattern

Each plugin that needs a database has two files:

```
src/db/schema.ts   — Drizzle pgTable definitions, plugin-authored
src/db/db.ts       — typed Context.Tag + Drizzle.Postgres layer, ~15 lines
```

```typescript
// src/db/db.ts
import { Drizzle } from "alchemy";
import { Context, Layer } from "effect";
import * as schema from "./schema";

export class Database extends Context.Tag("Database")<
  Drizzle.PostgresDB<typeof schema>,
  Drizzle.PostgresDB<typeof schema>
>() {}

export const db = (url: string) =>
  Layer.effect(Database, Drizzle.Postgres(url, { schema }));
```

The `_template` scaffold shows this pattern. Plugins without a database skip both files.

### Migration Model

Migrations are a **build-time concern**, not runtime. `Drizzle.Schema` runs `drizzle-kit generate` during `alchemy deploy`:

| Environment | Provisioner | Migration runner |
|---|---|---|
| Dev | `Docker.Postgres` (or PGlite fallback when Docker unavailable) | `Drizzle.Schema` on `alchemy dev` |
| Prod | `Neon.Project` / `Neon.Branch` | `Drizzle.Schema` on `alchemy deploy` |
| Remote plugins (`extends`) | Their own build pipeline | Already migrated before publish |

Schema isolation is per-plugin via Postgres schemas (`plugin_<id>`) — `Drizzle.Postgres` tables land in the correct schema automatically. All plugins share one `DATABASE_URL` safely.

### CLI Integration

`bos dev` runs `alchemy dev` for DB provisioning (Docker.Postgres or PGlite fallback). `bos publish --deploy` runs `alchemy deploy` for DB provisioning (Neon). `Drizzle.Schema` generates + applies migrations at build time.

Plugins don't run migrations at runtime — `Drizzle.Postgres(DATABASE_URL, { schema })` connects to an already-migrated database. The schema code is bundled into the remote for typed queries.

## The `app.ts` Model

### Constructor functions

| Constructor | Declares | Example |
|------------|----------|---------|
| `App({ ... })` | Composition root — account, domain, extends | `App({ account: "...", domain: "...", ui, api })` |
| `TanStackStart({ path })` | UI remote — TanStack Start/Router with SSR | `TanStackStart({ path: "ui" })` |
| `API({ path, plugins })` | API plugin with typed plugin injection | `API({ path: "api", plugins: { registry } })` |
| `Plugin(name).path(p)` | Local plugin workspace | `Plugin("registry").path("plugins/registry")` |
| `Plugin(name).extends(ref)` | Remote plugin reference | `Plugin("auth").extends("bos://...")` |
| `BetterAuth({ extends })` | Auth plugin with Better Auth + NEAR SIWN | `BetterAuth({ extends: "bos://..." })` |

### `path` — local workspace reference

```typescript
ui: TanStackStart({ path: "ui" }),
// bos dev  → resolves to http://localhost:3003 (local dev server)
// bos publish --deploy → builds, deploys to Zephyr, writes URL to published config

api: API({ path: "api" }),
// bos dev  → resolves to http://localhost:3001
// bos publish --deploy → builds, deploys, writes URL to published config

registry: Plugin("registry").path("plugins/registry"),
// bos dev  → resolves to http://localhost:3110
// bos publish --deploy → builds, deploys, writes URL to published config
```

### `extends` — published module reference

```typescript
auth: BetterAuth({
  extends: "bos://auth.everything.near/auth.everything.dev#app.auth",
}),
// bos dev  → checks for local copy (plugins/auth/), falls back to published URL from FastKV
// bos publish → always uses published URL from FastKV (never builds the extends target)
```

### What `App(...)` returns

```typescript
const app = App({
  account: "dev.everything.near",
  domain: "dev.everything.dev",
  auth: BetterAuth({ extends: "bos://..." }),
  api: API({ path: "api", plugins: { registry: Plugin("registry").path("plugins/registry") } }),
  ui: TanStackStart({ path: "ui" }),
});

// app.account → "dev.everything.near"
// app.domain → "dev.everything.dev"
// app.auth → AuthDescriptor (present because auth was declared)
// app.api → APIDescriptor
// app.api.plugins.registry → PluginRef<"registry", RegistryContract>
// app.ui → UIDescriptor
// app.extends → undefined (no extends declared)
```

`App(...)` returns a pure typed descriptor. `bos dev` and `bos publish` import it and do the work. The descriptor IS the deployment plan — no config scanning, no conventional discovery.

Future: `App.run()` and `App.dev()` will produce Effects that directly start the server/development environment. These will reuse the existing `everything-dev` start and dev logic, importing the relevant functions and executing them.

## Type System

### Generated type map

`bos dev` and `bos build` generate a `KnownPlugins` interface via declaration merging. Same pattern as today's `declare module "every-plugin"` + `RegisteredPlugins`:

```typescript
// .bos/plugin-types.d.ts (generated, gitignored)
import type { ContractType as _registry } from "../../plugins/registry/src/contract";
import type { ContractType as _projects } from "../../plugins/projects/src/contract";
import type { ContractType as _auth } from "./generated/auth/contract.d.ts";

declare module "everything-dev" {
  interface KnownPlugins {
    registry: typeof _registry;
    projects: typeof _projects;
    auth: typeof _auth;
  }
}
```

### How `Plugin(name)` resolves types

```typescript
// packages/everything-dev/src/app.ts
function Plugin<K extends keyof KnownPlugins>(
  name: K
): PluginBuilder<KnownPlugins[K]>

// Plugin("registry") → PluginBuilder<RegistryContract>
// Plugin("bogus")   → type error — "bogus" not in KnownPlugins
```

`Plugin(name)` returns a builder with `.path()` and `.extends()` methods. The returned `PluginRef` carries the contract type, which flows into the `API` type:

```typescript
api: API({
  path: "api",
  plugins: {
    registry: Plugin("registry").path("plugins/registry"),
    //        ^ PluginRef<"registry", RegistryContract>
  },
}),
// api.plugins.registry → PluginRef<"registry", RegistryContract>
```

### Plugin dependency validation — compile time + runtime

Plugins declare dependencies in their contract metadata. Two-phase validation:

**Compile time (IDE):**

```typescript
// plugins/registry/src/contract.ts
export const contract = { /* ... */ };
export const dependsOn = ["auth"] as const;  // type-level dependency declaration

// .bos/plugin-types.d.ts (generated)
interface KnownPlugins {
  registry: { contract: typeof _registry; dependsOn: readonly ["auth"] };
}

// TypeScript validates:
api: API({
  plugins: {
    registry: Plugin("registry").path("plugins/registry"),
    // If "auth" is not in api.plugins or app.auth:
    //   type error: registry requires auth plugin
  },
}),
```

**Runtime (DAG):** The existing `dag.ts` topological sort ensures plugins load in dependency order. Acyclic dependency graph is enforced at runtime with clear error messages.

### How types flow to consumers

The generated type files (same structure as today) feed into consumers:

```typescript
// api/src/lib/plugins-types.gen.ts (generated)
import type { ContractType as _registry } from "../../../plugins/registry/src/contract";
type ClientFactory<C> = (context?: Record<string, unknown>) => ContractRouterClient<C>;

export type PluginsClient = {
  registry: ClientFactory<typeof _registry>;
};
```

```typescript
// ui/src/lib/api-types.gen.ts (generated)
export type ApiContract = BaseApiContract & {
  registry: typeof _registry;
};
```

The only change from today: generation reads the `app.ts` graph instead of `bos.config.toml`.

### Type safety examples

```typescript
// ❌ Plugin not found in KnownPlugins
api: API({
  plugins: {
    registry: Plugin("bogus").path("plugins/bogus"),
    //                  ^ type error: "bogus" not in KnownPlugins
  },
}),

// ❌ Missing plugin dependency (compile time)
api: API({
  plugins: {
    registry: Plugin("registry").path("plugins/registry"),
    // type error: registry requires auth, which is not declared
  },
}),

// ❌ Missing plugin dependency (runtime)
// DAG topological sort fails: cannot load "registry" before "auth"

// ❌ Incompatible UI framework
ui: Vite({ path: "ui" }),
// If App requires SSR but Vite has hasSSR: false:
//   type error: Vite does not provide SSR router
```

## Framework-Agnostic UI

`TanStackStart` is the first implementation. Each framework produces a typed `UIDescriptor`:

```typescript
// packages/everything-dev/src/ui/tanstack-start.ts
function TanStackStart(opts: { path: string }): UIDescriptor & {
  kind: "web";
  framework: "tanstack-start";
  hasSSR: true;
}

// packages/everything-dev/src/ui/vite.ts (future)
function Vite(opts: { path: string }): UIDescriptor & {
  kind: "web";
  framework: "vite";
  hasSSR: false;
}

// packages/everything-dev/src/ui/react-native.ts (future)
function ReactNative(opts: { path: string }): UIDescriptor & {
  kind: "native";
  framework: "react-native";
  hasSSR: false;
}
```

Each framework implements the same interface:
- `Router` module (SSR for web, null for native)
- `Hydrate` module (client bootstrap)
- `Components` barrel (shareable components)

`App` constrains `ui` to any `UIDescriptor`. TypeScript's discriminated union on `hasSSR` catches framework mismatches.

Note: UI federation (inheriting routes from a parent UI) will be designed separately. The current `inheritRoutes` proposal may change. The `UIDescriptor` interface is designed to support federation when the design solidifies.

## How `bos dev` Works

```
bos dev
  1. import app.ts → get AppDescriptor
  2. resolve paths:
     "ui"               → http://localhost:3003
     "api"              → http://localhost:3001
     "plugins/registry" → http://localhost:3110
  3. resolve extends:
     "bos://auth.near/..." → checks plugins/auth/ first, falls back to published URL
     "bos://parent.near/..." → fetch from FastKV, resolve chain
  4. generate types:
     .bos/plugin-types.d.ts     → KnownPlugins interface
     api/src/lib/plugins-types.gen.ts
     ui/src/lib/api-types.gen.ts
  5. alchemy dev:
     → provisions Docker.Postgres (or PGlite fallback when Docker unavailable)
     → Drizzle.Schema applies migrations per plugin
     → generates .env with DATABASE_URL
  6. allocate ports, start dev servers for each path workspace
  7. start host with all remotes loaded
```

No config scanning. No conventional secret discovery. The graph tells `bos dev` exactly what to start. Alchemy handles the database lifecycle.

## How `bos publish --deploy` Works

```
bos publish --deploy
  1. import app.ts → get AppDescriptor
  2. resolve extends chain to get full graph
  3. alchemy deploy:
     → provisions Neon production database
     → Drizzle.Schema generates + applies migrations per plugin
     → provides DATABASE_URL
  4. for each path entry:
     build workspace → deploy to Zephyr → record URL + integrity
  5. for each extends entry:
     resolve from FastKV (unchanged)
  6. serialize resolved graph to TOML with DATABASE_URL secrets:
     bos publish → FastKV (bos://account/domain)
  7. optionally trigger host reload:
     POST /api/_reload-config
```

Migrations run at build time via `Drizzle.Schema`, not at runtime. The plugin's `Drizzle.Postgres(DATABASE_URL, { schema })` connects to an already-migrated database. Remote plugins (`extends`) were already migrated during their own publish.

The published TOML is auto-generated, never hand-edited:

```toml
# published bos.config.toml (on FastKV, auto-generated)
account = "dev.everything.near"
domain = "dev.everything.dev"

[app.ui]
production = "https://some-zephyr-url.app"
integrity = "sha384-..."

[app.api]
production = "https://some-zephyr-url.app"
integrity = "sha384-..."
secrets = ["DATABASE_URL"]

[plugins.registry]
production = "https://some-zephyr-url.app"
integrity = "sha384-..."
```

## How Tenants Work

A tenant has their own repo with their own `app.ts`. They `bos publish` it. The host reads the published config from FastKV. The host never executes the tenant's `app.ts`.

### Tenant development

```typescript
// tenant/app.ts — a pizza shop
export default App({
  account: "pizza.near",
  domain: "pizza.everything.dev",
  extends: "bos://dev.everything.near/dev.everything.dev",

  ui: TanStackStart({ path: "ui" }),
  // auth, api inherited from extends chain
});
```

```bash
bos dev   # starts tenant's UI locally, proxies auth/api from extends chain
bos publish --deploy  # builds UI, deploys, publishes config to bos://pizza.near/everything.dev
```

### Host runtime resolution

```
Request for pizza.everything.dev:
  1. tenant-resolver extracts "pizza.near" from domain
  2. fetches published config from FastKV: bos://pizza.near/everything.dev
  3. verifies extends chain back to base runtime
  4. reads the TOML → gets URLs for tenant's UI, API, plugins
  5. loads tenant's UI remote from CDN → serves in browser (sandboxed)
  6. optionally loads tenant's API/plugin remotes → runs in-process (gated by trust)
```

### Tenant security model

| Override type | Where code runs | Sandboxed? | Gating |
|--------------|-----------------|------------|--------|
| UI only (`path = "ui"`) | Browser | Yes — browser sandbox | Always allowed |
| API/plugins (`path = "api"`) | Host's Node.js process | No — in-process | Trusted tenants only (whitelist) |
| Full stack | Tenant's own host | Yes — separate process | Main app proxies or domain-routes |

The `app.ts` makes the override surface **auditable**. The host knows exactly what the tenant declared before loading anything. Trust gating is explicit: the host checks the published config, decides what overrides to allow based on tenant trust level.

### Tenant onboarding

```bash
bos init
  # prompts: account, domain, extends
  # generates:
```

```typescript
import { App, TanStackStart, API, BetterAuth } from "everything-dev";

export default App({
  account: "pizza.near",
  domain: "pizza.everything.dev",
  extends: "bos://dev.everything.near/dev.everything.dev",

  auth: BetterAuth({
    extends: "bos://auth.everything.near/auth.everything.dev#app.auth",
  }),

  api: API({ path: "api" }),

  ui: TanStackStart({ path: "ui" }),
});
```

Two lines of actual content (`account`, `domain`, `extends`, `ui`). Everything else is inherited.

## Effect.TS Integration

### Current: Pure data descriptor

`App(...)` returns a typed descriptor. `bos dev` and `bos publish` import it:

```typescript
import appDef from "./app.ts";
await resolveAppGraph(appDef);  // Effect.Effect<ResolvedApp>
await dev(appDef);              // Effect.Effect<void>
```

### Future: Self-executing Effects

```typescript
const app = App({ ... });

await Effect.runPromise(app.dev());     // starts dev server
await Effect.runPromise(app.run());     // starts production server
await Effect.runPromise(app.publish()); // builds + deploys + publishes
```

`App.dev()` and `App.run()` will reuse the existing logic in `everything-dev/src/plugin.ts` (the `dev` and `start` handlers) and `everything-dev/src/dev-session.ts` (process management). The Effect wrappers will import those functions and compose them into an Effect program. `bun app.ts` starts everything. This is the Alchemy-like model — one Effect program that composes infrastructure and application code.

## Directory Structure

```
everything.dev/
├── app.ts                            # composition root (developer-authored)
├── host/
│   └── src/
│       ├── server.ts
│       ├── scope.ts
│       ├── app.ts
│       ├── routes/
│       │   ├── health.ts
│       │   ├── api.ts
│       │   └── reload.ts
│       ├── services/
│       │   ├── config.ts
│       │   ├── plugins.ts
│       │   ├── auth.ts
│       │   ├── federation.ts
│       │   └── tenant-resolver.ts
│       └── middleware/
│           ├── security.ts
│           └── static-proxy.ts
├── ui/                               # TanStack Start/Router remote
│   └── src/
│       ├── routes/
│       ├── components/
│       ├── lib/
│       │   ├── api-types.gen.ts       # generated
│       │   ├── api.ts
│       │   └── auth.ts
│       ├── router.tsx
│       ├── hydrate.tsx
│       └── app.ts
├── api/                              # Core API plugin
│   └── src/
│       ├── contract.ts
│       ├── index.ts
│       ├── db/
│       │   ├── schema.ts             # Drizzle pgTable definitions
│       │   └── db.ts                 # Context.Tag + Drizzle.Postgres layer
│       ├── lib/
│       │   └── plugins-types.gen.ts   # generated
│       └── services/
├── plugins/
│   ├── auth/                         # temporary local copy for dev
│   │   └── src/
│   │       ├── contract.ts
│   │       └── index.ts
│   ├── registry/
│   │   └── src/
│   │       ├── contract.ts
│   │       ├── index.ts
│   │       ├── db/
│   │       │   ├── schema.ts
│   │       │   └── db.ts
│   │       └── services/
│   └── _template/
│       └── src/
│           ├── contract.ts
│           ├── index.ts
│           ├── db/
│           │   ├── schema.ts         # template: scaffold pattern
│           │   └── db.ts             # template: ~15 lines
│           └── services/
├── packages/
│   ├── everything-dev/
│   │   └── src/
│   │       ├── app.ts                 # App, TanStackStart, API, Plugin, BetterAuth constructors
│   │       ├── types.ts               # AppDescriptor, UIDescriptor, KnownPlugins, etc.
│   │       ├── cli.ts                 # CLI entry (bos dev, bos publish, bos init)
│   │       ├── cli/
│   │       │   ├── dev.ts             # dev implementation — imports app.ts
│   │       │   ├── publish.ts         # publish implementation — imports app.ts
│   │       │   ├── init.ts            # generates app.ts for new projects
│   │       │   ├── alchemy.ts         # Alchemy bridge (generates alchemy.run.ts, runs dev/deploy)
│   │       │   └── ...
│   │       ├── config.ts              # simplified — path/extends resolution
│   │       ├── dag.ts                 # dependency DAG
│   │       ├── build.ts               # workspace builder
│   │       ├── mf-build.ts            # shared rsbuild MF config
│   │       ├── type-gen.ts            # type generation from app graph
│   │       ├── api-client.ts          # oRPC client factory
│   │       ├── auth-core.ts           # auth types + helpers
│   │       ├── runtime-config.ts      # browser config helpers
│   │       ├── ui/
│   │       │   ├── tanstack-start.ts  # TanStackStart constructor
│   │       │   ├── vite.ts            # Vite constructor (future)
│   │       │   └── react-native.ts    # React Native constructor (future)
│   │       └── ...
│   └── every-plugin/
│       └── src/
│           ├── plugin.ts              # createPlugin (Layer-based)
│           ├── types.ts
│           ├── runtime/
│           └── build/
├── .bos/
│   ├── plugin-types.d.ts             # generated — KnownPlugins interface
│   └── generated/                    # fetched remote contract types
└── tests/
    └── regression/
```

## Implementation Phases

### Phase 1: Host Leanification

Split `program.ts` into the modules above. Zero behavior changes. Every regression test passes.

**Files:** Delete `host/src/program.ts`, create `host/src/server.ts`, `scope.ts`, `app.ts`, `routes/`, `middleware/`.

### Phase 2: rsbuild v2 + Shared Config

Upgrade rsbuild to v2. Extract shared MF config into `everything-dev/mf-build`. Workspace configs reduce to ~30 lines.

### Phase 3: oRPC v2 + Effect Native

Layer-based `initialize`, `.effect()` handlers, remove every-plugin re-exports, `errorStatusMap`. Follows `../infra/orpc-v2-effect-migration.md`. Plugin `initialize` adopts `Drizzle.Postgres(url, { schema })` for Effect-native DB queries.

### Phase 4: Database — Alchemy Integration

Replace all proprietary DB infrastructure with Alchemy. `bos dev` runs `alchemy dev` for DB provisioning (Docker.Postgres or PGlite fallback). `bos publish --deploy` runs `alchemy deploy` for DB provisioning (Neon). `Drizzle.Schema` generates + applies migrations at build time. Plugins use `Drizzle.Postgres(url, { schema })` for Effect-native queries.

**Files:**
- New: `packages/everything-dev/src/cli/alchemy.ts` — Alchemy bridge (generates `alchemy.run.ts`, runs `alchemy dev`/`alchemy deploy`)
- Edit: `packages/everything-dev/src/cli/dev.ts` — call alchemy dev before starting servers
- Edit: `packages/everything-dev/src/cli/publish.ts` — call alchemy deploy before building
- Delete: `api/src/db/index.ts` (driver), `api/src/db/layer.ts` (84 lines), `api/src/db/migrate.ts` (371 lines)
- Delete: `packages/everything-dev/src/db.ts` (migration helpers)
- Delete: All per-plugin copies of DB layer files
- Template: `_template` updated with `src/db/schema.ts` + `src/db/db.ts` pattern
- Edit: `api/src/index.ts` — switch to `Drizzle.Postgres`

### Phase 5: App Composition Model

Implement the constructor functions and type system:

**New files:**
- `packages/everything-dev/src/app.ts` — `App`, `API`, `BetterAuth`, `Plugin` constructors
- `packages/everything-dev/src/ui/tanstack-start.ts` — `TanStackStart` constructor
- `packages/everything-dev/src/ui/types.ts` — `UIDescriptor` interface
- `packages/everything-dev/src/type-gen.ts` — type generation from app graph
- `.bos/plugin-types.d.ts` — generated `KnownPlugins` interface

**Convert:**
- Create `app.ts` at repo root — replaces `bos.config.json` as authoring format
- `bos dev` → imports `app.ts` instead of reading config
- `bos publish` → imports `app.ts`, serializes to TOML for FastKV
- `bos init` → generates `app.ts` instead of `bos.config.toml`
- Delete `bos.config.json` / `bos.config.toml` from authoring surface (still generated for FastKV)

### Phase 6: Hot-Swap

Scope-based rebuild on config change. Two-layer Hono. `POST /api/_reload-config`.

### Phase 7: Tenant Isolation

Per-tenant scope resolution. Tenant-scoped DB schemas (Neon branches + Postgres schema isolation via `Drizzle.Postgres`). Trust-gated override model.

### Phase 8: Sync/Upgrade Retirement + Cleanup

Retire `sync.ts` and `upgrade.ts`'s framework-owned files concept. `bos sync` is removed entirely. `bos upgrade` reduces to version bumps only. Remove `snapshot.ts`, `merge.ts`, simplify `shared-deps.ts`.

## What Gets Cleaned Up

| File | Current LOC | v2 LOC | Notes |
|------|------------|--------|-------|
| `config.ts` | 1285 | ~200 | path/extends resolution only, no URL parsing |
| `plugin.ts` (bos handler) | 1600+ | ~800 | dev/start/build simplified, reads graph not config |
| `service-descriptor.ts` | 297 | Removed | graph replaces descriptors |
| `api-contract.ts` | 757 | ~400 | same generation logic, driven by graph |
| `host/src/program.ts` | 1176 | Deleted | split into ~5 files (~300 lines total) |
| `every-plugin/src/orpc.ts` | — | Removed | import from `@orpc/*` directly |
| `every-plugin/src/zod.ts` | — | Removed | import from `zod` directly |
| `every-plugin/src/effect.ts` | — | Removed | import from `effect` directly |
| `EveryPluginDevServer` | 200+ | ~60 | shared rsbuild config replaces rspack patching |
| `bos.config.json` / `bos.config.toml` | — | Removed | `app.ts` replaces as authoring format |
| `api/src/db/migrate.ts` | 371 | Deleted | Alchemy `Drizzle.Schema` handles migrations |
| `api/src/db/layer.ts` | 84 | Deleted | `Drizzle.Postgres(url, { schema })` replaces |
| `api/src/db/index.ts` | ~120 | Deleted | Alchemy's pg driver replaces |
| `packages/everything-dev/src/db.ts` | ~200 | Deleted | Migration helpers retired |
| `packages/everything-dev/src/cli/sync.ts` | 683 | Deleted | No framework-owned files to sync |
| `packages/everything-dev/src/cli/snapshot.ts` | ~80 | Deleted | Snapshot mechanism retired |
| `packages/everything-dev/src/cli/upgrade.ts` | 1427 | ~50 | Version bumps only |
| `packages/everything-dev/src/merge.ts` | ~300 | Deleted | No config merge needed |
| `packages/everything-dev/src/shared-deps.ts` | 345 | ~100 | Simplified; no catalog sync in child repos |
| All per-plugin DB file copies | ~200 | 15 | Replaced by `src/db/schema.ts` + `src/db/db.ts` |
| **Net** | **~7200 lines** | **~1900 lines** | **~5300 lines removed or simplified** |

## What Stays the Same

- Hono.js HTTP framework
- TanStack Router + Query (latest)
- Better Auth + NEAR SIWN
- Module Federation for remotes
- FastKV for on-chain config publishing
- Zephyr for CDN
- Drizzle ORM + Alchemy for database provisioning + Effect-native queries
- shadcn/ui + Tailwind
- Regression test suite
- CI/CD pipeline
- TOML as FastKV serialization format (host reads at runtime)

## Decisions Made

1. **No backward compatibility** — `app.ts` is the only authoring format. No conversion from `bos.config.toml`. This repo gets an `app.ts` that replaces the old config.

2. **Option B deferred** — `App.run()` and `App.dev()` Effect wrappers will be added later, reusing the existing `everything-dev` start and dev logic (imported and composed into Effects).

3. **UI federation deferred** — `inheritRoutes` is not in this plan. A better UI composition model will be designed separately. The `UIDescriptor` interface supports federation when the design solidifies.

4. **Compile-time + runtime plugin dependency validation** — TypeScript validates plugin dependencies in the IDE. The DAG enforces ordering at runtime.

5. **auth plugin local copy** — Keep `plugins/auth/` as a workspace that `bos dev` uses locally, while `bos publish` always references the remote `bos://` URL. The local copy is for fast dev iteration only.
