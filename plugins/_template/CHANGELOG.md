# @every-plugin/template

## 1.4.0-rc.0

### Minor Changes

- d57b8f4: Hydrate and paginate admin lists, batch node summary counts, resolve organization links, add signed-in Things navigation, and restore the Thing event stream.
- d57b8f4: Upgrade build toolchain to Rspack 2.2 / Rsbuild 2.2 / Module Federation 2.9

  Version catalog bumps: @rspack/core + @rspack/cli → 2.2.6, @rsbuild/core → 2.2.8,
  @rsbuild/plugin-react → 2.1.0, @module-federation/\* → latest 2.x (enhanced 2.9.0,
  node 2.7.50). @module-federation/runtime-tools and @rspack/dev-server are now
  explicit dependencies where used.

  BREAKING (every-plugin): EveryPluginDevServer removed from every-plugin/build/rspack.
  Plugin dev serving is now standalone — `every-plugin-serve` (supervised
  `rspack build --watch` + plain node:http server with the same contract: health,
  remoteEntry statics, oRPC RPC/OpenAPI, sibling composition, effect context).
  Plugin dev scripts use `every-plugin-serve` instead of `rspack serve`.
  EveryPluginBuild carries the build-side responsibilities only.

  Deploy note: `bos mf check` compares host and remote pluginVersion exactly, so
  after the 2.9.0 host deploys, remote-only plugins must be redeployed on
  Module Federation 2.9.0 to stay compatible.

### Patch Changes

- d57b8f4: Fix host crash after login caused by a pg-pool search_path race.

  - The `on("connect")` handler in `api/src/db/index.ts` and `plugins/_template/src/db/index.ts` ran `CREATE SCHEMA` and `SET search_path` concurrently with the first query on each fresh connection. pg-pool does not await `on("connect")`, so after idle connections closed (30s timeout) the next query (e.g. `listRootNodes`) could land before `SET search_path`, hitting `relation "nodes" does not exist` in the `public` schema. The concurrent `client.query()` calls also produced `Connection terminated` errors (the deprecation warnings at startup were the same root cause).
  - Set `search_path` at the protocol level via the pool's `options` config (`-c search_path=<schema>,public`) so every connection has it before any query. Move `CREATE SCHEMA IF NOT EXISTS` to a one-time `pool.connect()` call before returning the driver, eliminating the race entirely.
  - Add `uncaughtException` and `unhandledRejection` handlers in `host/src/program.ts` so a dropped DB connection logs an error instead of killing the host process (which cascaded to SIGTERM of all dev services).
  - Fix Docker healthcheck to specify the correct database (`pg_isready -U everythingdev -d api_db` / `-d auth_db`), eliminating the `FATAL: database "everythingdev" does not exist` log spam every 3s.
  - Harden `bos db:studio` local path to pass the resolved `*_DATABASE_URL` explicitly to the spawned drizzle-kit process, fixing the `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` error when dotenv `override: false` left a stale empty shell env value in place.

- d57b8f4: Consolidate the migration runner and DB driver into `everything-dev/db` (advisor plan 008).

  **Root-cause fix for the boot race** (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"` on `drizzle.__drizzle_migrations` when plugins booted concurrently against one shared database): `ensureMigrationTable`'s retry used `Effect.retry(..., until: isRetryableMigrationError)` — in Effect, `until` means _stop_ retrying when the predicate is true, so the race error the retry was built to absorb got zero retries (verified: 1 attempt with `until`, 4 with `while`). The shared runner now uses `while: isRetryableMigrationError`. `plugins/auth` had no retry at all and now inherits the shared one.

  **Shared runner** (`everything-dev/db`): `runMigrations(db, migrations, opts) => Effect<MigrationReport, DatabaseError>` with SAVEPOINT/ROLLBACK/RELEASE duplicate-DDL tolerance (fixes the proposals/votes bare-`continue` 25P02 aborted-transaction bug — the fix previously lived only in api and never propagated), retryable-SQLSTATE journal-init backoff, hash-tracked idempotence, and the duplicate-table preflight. `detectDrift`/`loadMigrations`/`loadMigrationsFromDisk` move with it; `loadMigrations` takes the bundler's virtual-module loader as an option so the shared package never names `virtual:drizzle-migrations.sql`.

  **Shared driver** (`everything-dev/db`): `createDatabaseDriver(url, schema, namespace?)` — engine by URL scheme (`pglite:`/`:memory:` → PGlite, else postgres), protocol-level `search_path`, **one-time** `CREATE SCHEMA` via `pool.connect()` (replaces votes/proposals' per-connection `on("connect")` handler that re-raced `CREATE SCHEMA IF NOT EXISTS` on every connection), env-driven pool config (`DB_POOL_MAX` etc.), idempotent close (drops auth's `pool.end()` stack-trace noise). Plus `pluginSchemaName(pluginId)` and a single shared `DatabaseError`.

  **Workspaces**: api/votes/proposals/auth `db/migrate.ts` and `db/index.ts` become thin sync-propagated adapters (< 40 lines; `bos sync` copies api's canonical copies verbatim into plugins). `plugins/_template` aligns fully to the standard flow: `migrator.ts` deleted (renamed to `migrate.ts`), canonical layer adopted, journal standardized to `drizzle.__drizzle_migrations` (pre-existing tables are auto-recorded by the preflight; the old in-schema `drizzle_migrations` table is frozen, matching 017/D6), and the `TemplateDatabase` alias is dropped. `adoptPublicTables` is deliberately **not** ported: it was a one-time boot-time `ALTER TABLE ... SET SCHEMA` relocation for pre-schema-isolation databases (live dev DB has zero `public` tables); legacy adoption stays with the fail-closed `detectDrift`/`bos db doctor` path, never boot-time magic.

  **Drivers stay excluded from the bundle graph**: the shared driver dynamic-imports engines (`pg`, `@electric-sql/pglite`, `drizzle-orm/*`) via bare specifiers, and everything-dev's tsdown config adds them to `deps.neverBundle`. This matters beyond hygiene: tsdown's unbundle mode otherwise rewrites dynamic imports into relative paths into its vendored `dist/node_modules/` copies, which (a) defeats rspack's `externals: ["pg", "@electric-sql/pglite"]` (externals match bare requests only), dragging pglite's `pglite.wasm`/`pglite.data`/`initdb.wasm` binaries into the MF dev bundles where they fail to resolve or parse as JS, and (b) makes node resolve `drizzle-orm` from the vendored `dist/node_modules/drizzle-orm` (nearest node_modules wins) whose copied layout breaks ESM resolution in the host process. Every workspace with a database already declares `@electric-sql/pglite` + `drizzle-orm` as its own dependencies, so bare runtime imports resolve everywhere — dev, prod MF bundles (via rspack externals), and `bos init` scaffolds.

  Regression suite added at `packages/everything-dev/tests/unit/db-run-migrations.test.ts`: fresh-schema, partial-overlap savepoint path (previously failed on proposals/votes with 25P02), duplicate-preflight journal recording, and a retry-semantics test pinning 3+ gen-runs on `23505`.

## 1.3.0

### Minor Changes

- ada1cd2: Move the things CRUD into the template plugin as a DB-backed demonstration of database best practices, replacing the in-memory `Map` store while keeping the existing streaming demos.

  - Add drizzle infrastructure under `src/db/`: `things` table schema, PGLite/Postgres driver, scoped `DatabaseTag`/`DatabaseLive` layer, and a migration runner with a generated initial migration
  - Add `ThingsService` (Effect `Context.Tag`) with `createThing`, `getThing`, `deleteThing`, and a new `listThings` (type filter + offset cursor pagination); errors are typed `Effect<_, ORPCError>` (`NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`)
  - Build the service via `tools.buildService` so the database pool lifecycle is bound to the plugin scope
  - Rename the `apiKey` secret to `TEMPLATE_API_KEY` and add a `TEMPLATE_DATABASE_URL` secret (defaults to in-memory PGLite); all secrets now follow the uppercase convention
  - Add dependency scripts `db:generate`, `db:push`, and `db:studio`

  Streaming demonstrations (`search`, background events via `MemoryPublisher`) are preserved.

### Patch Changes

- ada1cd2: Remove `_viewer` paths from the host and add structured error testing surface.

  - Remove `_viewer` route, `renderBosViewer`, `isViewerFramePath`, and viewer-specific CSP/font-src conditionals from the host; always apply `frame-ancestors 'none'`
  - Rate limiter no longer skips the `/health` path, protecting it from DDoS
  - Add `testError` route to the core API shell with six error kinds (`unauthorized`, `forbidden`, `not_found`, `conflict`, `bad_request`, `internal`), returning structured JSON errors with correct status codes and content types
  - Add `testError` route to the `@every-plugin/template` plugin as a demonstration
  - Append template plugin's thing routes (`/api/things`) to the API router with `requireAuth`, restoring the host-level `/api/things` surface via `_plugins.template()` passthrough
  - Add regression tests verifying structured error responses, security headers (CSP/CSRF/X-Frame-Options), body-size limiting, and rate limiting
  - Add router-composition note to `plans/orpc-v2-effect-migration.md` (Phase 1.7) for future direct-router merging in `every-plugin`
  - Standalone plugin dev servers now load declared `dependsOn` sibling plugins via `BOS_RUNTIME_CONFIG`, enabling `_plugins.*()` in `initialize` during local development

- ada1cd2: Route the things UI through the namespaced `template` plugin client and enforce auth on thing writes.

  - Things routes in the UI now call `apiClient.template.createThing`, `apiClient.template.getThing`, `apiClient.template.deleteThing`, and `apiClient.template.listThings` instead of the removed top-level `api` client methods; `live.tsx` no longer needs a cast to reach the template client
  - The parent API now proxies thing routes to the template plugin through the in-process `templateClient`, keeping `createThing`/`deleteThing` auth-protected at the API boundary with `requireAuth` while `getThing`/`listThings` remain public
  - The template plugin's `createThing` and `deleteThing` handlers no longer enforce auth themselves (auth is enforced by the parent API), so direct plugin-to-plugin calls don't depend on per-call auth context

## 1.2.1

### Patch Changes

- b03bc24: **every-plugin:**

  - Broaden `Effect.annotateLogs({ plugin: pluginId })` to cover the full plugin lifecycle — `usePlugin`, `loadPlugin`, `instantiatePlugin`, and `initializePlugin` — so all logs including Module Federation operations and database migrations are tagged with the plugin's registry key
  - Convert Module Federation service `console.log` calls to `Effect.logDebug` (registering/loading) and `Effect.logInfo` (registered/loaded) with proper log levels
  - Refactor `formatORPCError` to return `string | null` instead of calling `console.error` directly, enabling callers to log through Effect's structured system
  - Make `toPluginRuntimeError` and `wrapORPCError` pure functions (no side effects); add `Effect.tapError` with `Effect.logError` at 4 call sites in `plugin-loader.service.ts` for plugin-aware error logging
  - Remove `formatPluginError` (dead code after purity refactor)
  - Remove redundant `Effect.annotateLogs` from `plugin-loader.service.ts` (now covered at runtime level)

  **api:**

  - Convert 3 startup `console.log` calls to `Effect.logInfo` so `[API]` startup messages gain the `plugin=api` annotation
  - Convert `Effect.log` to `Effect.logInfo` for shutdown

  **host:**

  - Import `logger` wrapper in `plugins.ts` and replace all raw `console.*` calls with `logger.*` (for async contexts) or `Effect.log*` (for Effect generator contexts)
  - Restructure `catchAll` block to `Effect.gen` for proper `Effect.logError`/`Effect.logWarning` usage
  - Fix 2 stray `console.*` calls in `program.ts` to use `logger`

  **@everything-dev/apps-plugin:**

  - Convert `console.log` to `Effect.logInfo` for startup message
  - Convert `Effect.log` to `Effect.logInfo` for shutdown

  **@every-plugin/template:**

  - Convert publish failure `console.log` to `Effect.logWarning` for proper log level and annotation
  - Remove `[Event]` debug `console.log` from streaming handler; use `getEventMeta` for meaningful event ID filtering instead
  - Restructure `getById` to `Effect.gen` wrapper with `Effect.logInfo` for service call logging

## 1.2.0

### Minor Changes

- 4772e1f: Simplify API to a thin orchestration layer: replaces the upvotes table with a `things` registry (`thingId`, `pluginId`, `createdAt`, `updatedAt`), adds Effect service layers (Registry, Votes), and introduces plugin dispatch via `getThingProvider()` so the API delegates to plugins by `pluginId`. Adds `createThing`, `getThing`, `deleteThing` (admin-only), `subscribeThings` endpoints with SSE filtering by `pluginId`/`type`/`action`. Adds `deleteThing` to `_template` plugin contract/service/handler. Extracts `ApiContextSchema`, `pluginContext`, `runEffect` into `lib/context.ts`. Renames service files `thing-registry`→`registry`, `thing-votes`→`votes` with matching symbol renames. Removes obsolete `lib/plugins.ts`. Adds frontend thing registry routes under `/things/` (index, create, detail with vote controls, admin delete, live SSE stream). Improves DB Layer with idempotent migrator. Updates api-and-auth and plugin-development skill docs.

## 1.1.0

### Minor Changes

- d46dbee: Pass full organization and NEAR context from host to plugins

  The host's `buildPluginContext()` now forwards the complete `organization`
  and `near` objects from the auth plugin's `getContext()`, not just the
  flat `organizationId` and `walletAddress` strings.

  **Host:**

  - Store full `contextResult.organization` and `contextResult.near` in
    Hono context variables during session middleware
  - Pass both objects through `buildPluginContext()` to all plugins

  **API plugin:**

  - Add `organization` and `near` zod schemas to the context schema so
    routes and middleware can access org metadata (including `daoAccountId`
    from `organization.organization.metadata`) and NEAR capabilities

  **Template & Settings plugins:**

  - Expand context schema to reflect the full surface of available fields:
    `user`, `organization` (with `organization`, `member`, `isPersonal`,
    `hasOrganization`), `near` (with `primaryAccountId`, `linkedAccounts`,
    `hasNearAccount`), `walletAddress`, and `apiKey`
  - Added documentation comment listing all available context fields

  **CLI (everything-dev):**

  - Fix type error in `resolveRemoteConfigChain` where `BosConfig` was
    passed as `BosConfigInput` to `mergeBosConfigWithExtends`
  - Update plugin-development SKILL.md with a comprehensive Request Context
    Reference section documenting all fields, common patterns, and the
    minimal context pattern

## 1.0.4

### Patch Changes

- b193ad6: Fix `reqHeaders` runtime type to be a real `Headers` instance instead of `Record<string, string>`, preventing `TypeError: undefined is not a function` when calling `.get()` in plugin handlers

## 1.0.3

### Patch Changes

- 13f68ff: Inject `getRawBody` and `reqHeaders` into oRPC handler context so plugins can verify webhook signatures

  - Host session middleware now clones the request body before oRPC consumes it, exposing `getRawBody()` in context for raw body access
  - Dev server middleware also injects `reqHeaders` and `getRawBody` (previously passed `context: {}`)
  - API, projects, registry, and template plugins declare `getRawBody` in their context schemas
  - API plugin `reqHeaders` type changed from `z.custom<Record<string, string>>()` to `z.record(z.string(), z.string())` for proper runtime validation

## 1.0.2

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

## 1.0.1

### Patch Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0
