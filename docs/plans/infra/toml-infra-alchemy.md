# TOML Config + Shared Databases + Alchemy Integration

> **Status correction (2026-09-26 audit):** of the phases below, only the
> per-plugin schema isolation (Phase 2) is on `main` (`api/src/db/layer.ts`
> derives `plugin_<slug>` schemas). The Phase 1/3/4 artifacts (TOML config
> source, `[infra]` schema, Neon/Alchemy driver split) exist only on the
> **unmerged** `upstream/feat/alchemy` branch — the phase statuses further
> down were written against that branch, not this tree. Also note the
> published config format remains JSON (`bos.config.json` on FastKV) per
> this plan's own decision; the TOML surface is authoring-side only.

## Problem

The config system uses JSON with zero inline documentation. Database provisioning
is convention-based (`*_DATABASE_URL` suffix scanning), implicit, and provisions a
separate database per plugin — expensive and rigid. There is no declarative
infrastructure model for databases, Redis, or deploy targets.

## Goal

Four phases, each independently shippable and backward-compatible:

1. **TOML format support** — Accept `bos.config.toml` as an alternative authoring
   format with inline comments. JSON remains the published format (FastKV).
2. **Per-plugin Postgres schema isolation** — All plugins share one `DATABASE_URL`.
   Each plugin's tables live in a dedicated Postgres schema (`plugin_<pluginId>`)
   via `search_path`. No changes to schema files, migration SQL, or query code.
3. **`[infra]` section** — Explicit infrastructure declarations in config. Replaces
   convention-based scanning. Declares shared vs dedicated database topology.
4. **Alchemy backend** — `bos deploy` generates `alchemy.run.ts` from `[infra]`
   section. Provisions Neon databases/branches. Drizzle.Schema manages migrations.
   Existing Railway Postgres continues to work throughout.

## Architecture

```
bos.config.toml (local, self-documenting with comments)
       |
       +-- [infra.database] -- declares topology + provider
       |        |
       |        +-- bos dev --> Alchemy dev: Neon branch per stage
       |        |              (or Docker Compose fallback for offline)
       |        |              pg.Pool options param: --search_path=plugin_<pluginId>,public
       |        |
       |        +-- bos deploy --> alchemy deploy
       |        |                  Neon project + branch per stage
       |        |                  Drizzle.Schema -> generate migrations
       |        |                  Neon.Branch -> apply migrations
       |        |
       |        +-- DATABASE_URL (shared) --> all plugins connect
       |                                        search_path isolation
       |
       +-- [app.*] / [plugins.*] --> Module Federation (unchanged)
       |                                Zephyr CDN, bos publish --deploy
       |
       +-- Backward compat: existing *_DATABASE_URL secrets still work
           Railway Postgres URLs work with search_path (standard Postgres)
```

## Design decisions

- **Shared database by default** — One `DATABASE_URL`, per-plugin Postgres schemas
  via `search_path`. Dedicated databases are opt-in via
  `[infra.database.<plugin>].dedicated = true`.
- **All-in on Alchemy for database provisioning** — Alchemy/Neon for both dev and
  prod. Docker Compose as offline fallback. Existing Railway Postgres continues
  to work; gradual migration.
- **Published format is always JSON** — FastKV keys stay
  `apps/{account}/{gateway}/bos.config.json`. TOML is a local authoring format
  that compiles to JSON for publishing.
- **"Merge on duplicates, be different on others"** — Plugin A and B both define
  `things` -> `plugin_a.things` and `plugin_b.things`. Plugin B extends A and
  needs A's data -> `search_path TO plugin_b, plugin_a, public`.

---

## Phase 1: TOML Format Support (DONE)

**Status**: Implemented. All TOML/JSON format handling is centralized in
`config-source.ts` using `smol-toml`. The repo itself still uses
`bos.config.json` but `bos.config.toml` is fully supported — format detection,
parsing, stringification, and sync merge all handle both formats.

### What was built

| Module | What it does |
|---|---|
| `config-source.ts` | Centralized config source — `findBosConfigPathEff`, `readBosConfigSourceEff`, `stringifyBosConfig`, `detectFormat`. Effect-native with tagged errors (`ConfigReadError`, `ConfigParseError`, `ConfigBothExistError`). Searches `bos.config.toml` first, then `bos.config.json`. Errors if both exist. |
| `utils/save-config.ts` | `saveBosConfig()` detects existing format and writes back in same format |
| `publish.ts` | Uses `findBosConfigPath` / `readBosConfigSource` — format-agnostic |
| `cli/infra.ts` | `buildOriginMap` uses `findBosConfigPath` / `readBosConfigSource` |
| `cli/sync.ts` | `bos.config.toml` in `FRAMEWORK_OWNED_SYNC_FILES`; sync merge handles TOML format-preserving |
| `Dockerfile` | `COPY ... /app/bos.config.* ./` — glob covers both formats |
| `config.ts` | `loadConfigFile()` calls `readBosConfigSource()` for local, `fetchBosConfigFromFastKv` for `bos://` |

### Key implementation details

- `smol-toml` (6KB, zero deps) — imported in `config-source.ts:4`
- `CONFIG_FILENAMES = ["bos.config.toml", "bos.config.json"]` (`config-source.ts:8`)
- `findBosConfigPathEff` walks up directories, errors if both files coexist (`config-source.ts:54-78`)
- `stringifyBosConfig` strips nulls/undefined before TOML stringification (`config-source.ts:143-149`)
- `readBosConfigWithResolvedFallbackEff` checks `.bos/bos.resolved-config.json` first, falls back to source (`config-source.ts:82-120`)
- Sync merge is format-aware: detects local TOML, parses, merges with template JSON, writes back in TOML (`sync.ts:278-296`)

---

## Phase 2: Per-Plugin Postgres Schema Isolation (DONE)

**Status**: Implemented. Each plugin's tables live in a dedicated Postgres schema
(`plugin_<pluginId>`) via `search_path`. Schema is derived from `PluginIdTag` in
`DatabaseLive`. Backward compatible — when no schema name is provided, all
functions fall back to `public` (identical to prior behavior).

### What was built

| File | Change |
|---|---|
| `api/src/db/index.ts` | `createDatabaseDriver(url, schemaName?)` — PGlite: `CREATE SCHEMA` + `SET search_path` via `pglite.exec()`. `pg.Pool`: `on("connect")` handler sends `CREATE SCHEMA` + `SET search_path` per connection. Clean shutdown removes `connect` listener. Removed noisy stack-trace `console.error` on clean pool close. |
| `api/src/db/layer.ts` | `DatabaseLive(url)` — moves `PluginIdTag` access before driver creation, computes `schemaName = plugin_${pluginMigrationSlug(pluginId)}`, passes to `createDatabaseDriver`, `migrate`, and `detectDrift`. |
| `api/src/db/migrate.ts` | `getExistingTables(db, tables, schemaName?)` — uses `schemaName ?? "public"` instead of hardcoded `'public'`. `migrate(db, migrations, storage, schemaName?)` — explicitly `CREATE SCHEMA IF NOT EXISTS` for data schema before running DDL. `detectDrift(db, migrations, storage, schemaName?)` — passes schema through to `getExistingTables`. |
| `api/tests/unit/schema-isolation.test.ts` | New — 6 PGlite-based tests: `current_schema()` returns plugin schema, tables land in `plugin_*` not `public`, `detectDrift` finds tables in plugin schema, two plugins with same table name are isolated, backward compat (no schemaName → `public`). |

### The mechanism

Postgres `search_path` is per-connection. `pg.Pool` emits a `connect` event for
each new connection. Setting `search_path` there ensures every pooled connection
uses the plugin's schema. Drizzle queries work transparently.

```typescript
pool.on("connect", (client) => {
  client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  client.query(`SET search_path TO "${schemaName}", public`);
});
```

PGlite uses `exec()` directly after init (no pool events):
```typescript
await pglite.exec(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
await pglite.exec(`SET search_path TO "${schemaName}", public`);
```

### What to use instead of `public`

`public` is correct as the fallback. It's needed for:

- Extensions (`uuid-ossp`, `pgcrypto`, `pgvector`) that install to `public`
- Backward compat — existing tables in `public` stay accessible during migration
- `information_schema` and `pg_catalog` are always searched regardless of
  `search_path` (Postgres implicitly prepends them)

**Critical safeguard**: always `CREATE SCHEMA IF NOT EXISTS plugin_<id>` *before*
setting `search_path`. Otherwise unqualified `CREATE TABLE things` silently lands
in `public` (the first existing schema in the default search_path).

### How to know which schema

Derive deterministically from `PluginIdTag` (already available in `DatabaseLive`
at `layer.ts:25`):

```
PluginIdTag → normalizeSlug(pluginId) → plugin_<slug>
```

`pluginMigrationSlug` in `db.ts:84` already does this normalization. Phase 2
reuses the same slug for the data schema name.

For the extends case (plugin B extends A → `search_path TO plugin_b, plugin_a,
public`), the extends chain is in `RuntimePluginConfigSchema.extendsRef`
(`types.ts:109`). The host already resolves it. That's a Phase 3 enhancement —
Phase 2 only needs `plugin_<id>, public`.

### Per-driver search_path

| Driver | How to set search_path |
|---|---|
| `pg.Pool` (current) | `new Pool({ options: "--search_path=plugin_auth,public" })` |
| PGlite | `await pglite.exec("SET search_path TO plugin_auth, public")` after init — PGlite is full Postgres WASM, supports `CREATE SCHEMA` and `SET search_path` |
| Neon WebSocket Pool | Same as `pg.Pool` — `@neondatabase/serverless` exposes `Pool` that's `pg`-compatible, accepts `options` |
| `@effect/sql-pg` | Append to URL: `PgClient.layer({ url: Redacted.make(connString + "?options=--search_path=plugin_auth,public") })` |
| Alchemy `Drizzle.Postgres` | Same URL trick: `Drizzle.Postgres(connString + "?options=--search_path=plugin_auth,public", { relations })` |

**Note on Neon HTTP mode**: The Neon HTTP one-shot driver (`neon()`) is
stateless — each query is a separate HTTP request with no session. `search_path`
can be set per-query via `SET LOCAL` inside a transaction, or by qualifying table
names. For the everything.dev API (long-lived Node.js process), use the WebSocket
`Pool` mode which supports `options` — the HTTP mode is for edge/serverless
functions only.

### Why this is simple

- Schema files unchanged — `pgTable("things", {...})` works via search_path
- Migration SQL unchanged — `CREATE TABLE "things"` resolves to plugin's schema
- drizzle-kit config unchanged — generates unqualified SQL
- Query code unchanged — `db.select().from(things)` works transparently
- `PluginIdTag` is already available in DatabaseLive (`layer.ts:25`)
- The migrator already does `CREATE SCHEMA IF NOT EXISTS` for the *journal*
  schema (`migrate.ts:275`) — Phase 2 extends this pattern to *data* schemas

**Important distinction**: The existing `CREATE SCHEMA IF NOT EXISTS` at
`migrate.ts:275` creates the `drizzle` schema (for the migration journal table).
Phase 2 needs a separate `CREATE SCHEMA IF NOT EXISTS plugin_<id>` for the
plugin's data tables, executed before any migration SQL runs.

### "Merge on duplicates, be different on others"

**Be different**: Plugin A and B both define `things` -> `plugin_a.things` and
`plugin_b.things`. No collision.

**Merge on duplicates**: Plugin B extends Plugin A -> `search_path TO plugin_b,
plugin_a, public`. Unqualified `things` resolves to `plugin_b.things`. Explicit
`plugin_a.things` accesses A's data.

**Multi-tenant**: `plugin_<pluginId>_<tenantHash>` — configurable in Phase 3.

### Backward compatibility with Railway

Railway Postgres is standard Postgres — `search_path` works identically. Existing
plugins that declare `*_DATABASE_URL` continue to work. The `public` schema is
always in the search_path as fallback, so existing tables are accessible during
migration.

### Schema naming convention

```
Default:       plugin_<pluginId>           e.g., plugin_api, plugin_auth
Multi-tenant:  plugin_<pluginId>_<hash>    e.g., plugin_projects_a1b2c3
Shared:        plugin_shared               (multiple plugins share one schema)
Legacy compat: public                      (search_path = plugin_api, public)
```

### Files to change

| File | Change |
|---|---|
| `api/src/db/index.ts` | `createDatabaseDriver(url, schemaName?)` — adds `options` param to Pool config; PGlite path gets `exec("SET search_path ...")` after init |
| `api/src/db/layer.ts` | `DatabaseLive(url, schemaName?)` — derives schema from `PluginIdTag` |
| `api/src/db/migrate.ts` | `getExistingTables` accepts schema param (currently hardcodes `table_schema = 'public'` at line 51); `detectDrift` same fix; `ensureMigrationTable` creates per-plugin data schema before migrations |
| `packages/everything-dev/src/db.ts` | `PER_PLUGIN_ISOLATION` continues controlling migration journal table naming; Phase 2 adds data schema isolation as a separate concern |
| `api/src/index.ts` | Pass schema name to `DatabaseLive` |

### What stays the same

- `api/src/db/schema.ts` — unchanged
- `api/drizzle.config.ts` — unchanged
- Migration SQL files — unchanged
- All query code — unchanged
- `@proj-airi/unplugin-drizzle-orm-migrations` — unchanged

### Effort

~80 lines across 7 files. All changes in the database layer.

---

## Phase 3: `[infra]` Section + Config Model

**Scope**: Explicit infrastructure declarations in `bos.config.toml`. Replaces
convention-based `*_DATABASE_URL` scanning.

### The config

```toml
[infra.database]
type = "postgres"
schemaMode = "per-plugin"  # or "shared", "per-tenant"

[infra.database.auth]
dedicated = true
type = "postgres"
secret = "AUTH_DATABASE_URL"

[infra.redis]
enabled = true
slug = "cache"

[deploy]
provider = "railway"  # or "alchemy" in Phase 4
service = "app"
redeploy = true
```

### Secret model

| Current | New (shared) | New (dedicated) |
|---|---|---|
| `API_DATABASE_URL` | `DATABASE_URL` | (uses `DATABASE_URL`) |
| `AUTH_DATABASE_URL` | (uses `DATABASE_URL`) | `AUTH_DATABASE_URL` |

### Backward compatibility

If no `[infra]` section exists, convention-based scanning runs unchanged. The
`[infra]` section is additive — presence triggers the new path, absence falls
back to legacy. `ci.railway` maps to `[deploy]` during resolution.

### Files to change

| File | Change |
|---|---|
| `types.ts` | Add `InfraConfigSchema`, `DeployConfigSchema` to `BosConfigInput` and `BosConfigSchema` |
| `infra/types.ts` | Add `infraConfig?` to `InfraInput` |
| `infra/planner.ts` | Check `infraConfig` first; fallback to secret scanning |
| `cli/infra.ts` | `buildDatabaseConfigs` accepts explicit config |
| `config.ts` | Parse `[infra]` and `[deploy]` sections |
| `merge.ts` | Map `ci.railway` -> `deploy` during extends resolution; add `"infra"` and `"deploy"` to `BOS_CONFIG_ORDER` for consistent field ordering in serialized config |

**`BOS_CONFIG_ORDER`** (`merge.ts:4-16`) currently lists:
`["extends", "account", "domain", "title", "description", "testnet", "staging",
"repository", "ci", "app", "plugins"]`. Add `"infra"` and `"deploy"` (before
`"app"`) so `rebuildOrderedConfig` emits them in a stable position.

### Effort

~200 lines across 6 files.

---

## Phase 4: Alchemy as Database Provisioning Backend

**Scope**: `bos deploy` generates `alchemy.run.ts` from `[infra]` section.
Provisions Neon databases/branches via Alchemy. Drizzle.Schema manages migrations
on deploy. Per-stage branching. Host stays as Docker (Module Federation).

### All-in on Alchemy (with Railway backward compat)

| Provider | Connection string | When used |
|---|---|---|
| Neon (Alchemy) | `postgres://...neon.tech...` | `bos deploy` with `[deploy] provider = "alchemy"` |
| Railway (existing) | `postgres://...railway...` | Existing plugins, gradual migration |
| Docker Compose | `postgres://localhost:5432/shared` | `bos dev` offline fallback |
| PGlite | `pglite:.bos/<slug>/:memory:` | `bos dev` no-Docker fallback |

All four work with `search_path = plugin_<pluginId>`.

**Neon pooled vs direct**: Use the pooled connection URI
(`branch.pooledConnectionUri`) for the API — it routes through Neon's PgBouncer,
which is why the `options` parameter approach for `search_path` is critical
(transaction-mode PgBouncer doesn't preserve `SET` commands). Use the direct URI
(`branch.origin`) only if Hyperdrive or another external pooler is in front.

### `bos deploy` flow

```
bos deploy
  1. Generate alchemy.run.ts from [infra] section
  2. alchemy deploy
     -> Drizzle.Schema: generate migrations from schema files
     -> Neon.Branch: apply migrations to the branch
     -> Returns connection string (pooled)
  3. Set DATABASE_URL = <neon-branch-pooled-connection-string>
  4. bos publish --deploy
     -> Build + deploy MF remotes to Zephyr CDN
     -> Update bos.config.toml with new URLs + integrity
     -> Publish config to FastKV
  5. Railway redeploy (if [deploy] provider = "railway")
     -> Host Docker container restarts with new DATABASE_URL
```

### Per-stage Neon branching

```
Neon project: everything-dev
+-- main          -> production database (long-lived)
+-- staging       -> staging database (copy-on-write branch of main)
+-- pr-42         -> PR preview database (ephemeral, destroyed on merge)
+-- dev_sam       -> developer's personal branch (ephemeral)
```

### Drizzle integration

Schema files unchanged. Migrations: `Drizzle.Schema` generates on deploy,
`Neon.Branch.migrationsDir` applies them (Alchemy tracks migration state in a
`neon_migrations` table — separate from the custom `drizzle.__drizzle_migrations`
journal). Queries: upgrade to Alchemy's `Drizzle.Postgres` for native Effect
queries.

### Effect-TS idiomatic improvements (Phase 2+)

These improvements apply incrementally across phases:

#### a. Split `DatabaseLive` into composable layers

Currently one 84-line `Layer.scoped` (`layer.ts`) does driver creation +
migration + drift detection. Split:

```
DriverLive(url, schemaName) → DatabaseTag
MigrationLive → runs migrations + drift (depends on DatabaseTag + PluginIdTag)
DatabaseLive = DriverLive >> MigrationLive
```

This lets you skip migrations in the Alchemy path (Alchemy's `Drizzle.Schema` +
`Neon.Branch.migrationsDir` handles prod migrations). The current all-in-one
layer can't conditionally skip migrations.

#### b. `DriftReport` → `Data.taggedEnum` + `Effect.matchTag`

Currently `drift.status` is a string union checked via if-else chains
(`layer.ts:47-79`). Convert to:

```typescript
const DriftStatus = Data.taggedEnum({
  Healthy: {},
  Empty: {},
  UntrackedExistingSchema: {},
  DriftSafeRepair: { missingTables: ReadonlyArray<string>, ... },
  DriftManual: { missingTables: ReadonlyArray<string>, ... },
});
```

Then `layer.ts` becomes:
```typescript
yield* Effect.matchTag(drift._tag, {
  Healthy: () => Effect.logInfo("[Database] Ready"),
  DriftSafeRepair: (d) => Effect.fail(new DatabaseError({ ... })),
  DriftManual: (d) => Effect.fail(new DatabaseError({ ... })),
  ...
});
```

#### c. `loadMigrations` → `Effect.catchTag` instead of `Effect.either`

Currently (`migrate.ts:90-126`) uses `Effect.either` + manual `_tag === "Right"`
checks. More idiomatic:

```typescript
const migrations = yield* Effect.tryPromise({
  try: () => import("virtual:drizzle-migrations.sql"),
  catch: (cause) => new DatabaseError({ stage: "load", cause }),
}).pipe(
  Effect.map((mod) => mod.default ?? []),
  Effect.catchTag("DatabaseError", () => loadMigrationsFromDisk()),
);
```

#### d. `Drizzle.Postgres` — native Effect queries (Phase 4)

When using Alchemy's `Drizzle.Postgres`, queries become Effects directly — no
`Effect.tryPromise` wrapping:

```typescript
// Current: Effect.tryPromise wrapping
const users = yield* Effect.tryPromise({
  try: () => db.select().from(Users),
  catch: (cause) => new DatabaseError({ stage: "query", cause }),
});

// Alchemy path: native Effect
const users = yield* db.select().from(Users);
// SqlError is in the typed error channel — handle with Effect.catchTag
```

This is the biggest Effect win in Phase 4 — every query in every plugin becomes a
native Effect.

#### e. `PgClient.fromPool` — bridge current code to Effect SQL

If adopting `@effect/sql-pg` incrementally (before full Alchemy),
`PgClient.fromPool` wraps an existing `pg.Pool`:

```typescript
const pool = new Pool({
  connectionString: url,
  options: `--search_path=${schema},public`,
});
const client = yield* PgClient.fromPool({
  acquire: Effect.acquireRelease(
    Effect.succeed(pool),
    (pool) => Effect.tryPromise(() => pool.end()),
  ),
});
```

Then `PgDrizzle.makeWithDefaults()` gives Drizzle with native Effect queries
over the same pool. This bridges Phase 2 (search_path via Pool options) to
Phase 4 (native Effect queries) without a big-bang rewrite.

### What gets simplified (when Alchemy is the prod path)

| File | Status |
|---|---|
| `db/migrate.ts` (371 lines) | Dev-only fallback. Alchemy handles prod migrations via `Neon.Branch.migrationsDir` |
| `@proj-airi/unplugin-drizzle-orm-migrations` | Eventually removed |
| `virtual:drizzle-migrations.sql` | Eventually removed |
| `db/layer.ts` drift detection | Simplified — Alchemy tracks migration state in `neon_migrations` table |
| `db/layer.ts` migration step | Skipped in prod — `MigrationLive` layer not provided when Alchemy manages migrations |

### Railway migration path

1. **No change needed**: Existing plugins with `*_DATABASE_URL` pointing to Railway
   work as-is. Add `search_path` and they get per-plugin schema isolation.
2. **Gradual migration**: Change `DATABASE_URL` from Railway to Neon. Plugin code
   doesn't change.
3. **Full migration**: Update `[deploy] provider = "alchemy"`, remove Railway
   database addon.

### Files to change

| File | Change |
|---|---|
| New: `alchemy.ts` | `generateAlchemyRun(infraConfig)` |
| `publish.ts` | `bos deploy` calls `alchemy deploy` |
| `db/index.ts` | Add Neon connection path (Neon WebSocket Pool with `options` param) |
| `db/layer.ts` | Split into `DriverLive` + `MigrationLive`; skip migrations when Alchemy manages them |
| `db/migrate.ts` | Dev-only path |
| `package.json` | Add `alchemy`, `@neondatabase/serverless` as optional peers |
| `.github/workflows/deploy.yml` | Add `alchemy deploy` step |

### Effort

~300 lines new code, ~450 lines eventually removed (net reduction).

---

## Implementation order

```
Phase 1 (TOML format)          ->  DONE — config-source.ts, smol-toml
  |
Phase 2 (per-plugin schemas)   ->  DONE — search_path via on(connect), PGlite exec,
  |                               getExistingTables schema-aware, 6 PGlite tests
  |
Phase 3 ([infra] section)      ->  DONE — InfraConfigSchema + DeployConfigSchema in types.ts,
  |                               infra/deploy in BOS_CONFIG_ORDER, ci.railway→deploy mapping,
  |                               buildDatabaseConfigs checks infraConfig first, InfraInput.infraConfig
  |
Phase 4 (Alchemy backend)      ->  PARTIAL — DriverLive + MigrationLive split in layer.ts,
                                  Neon WebSocket Pool in db/index.ts (@neondatabase/serverless),
                                  alchemy.ts deploy script generator
                                  Remaining: bos deploy integration, Drizzle.Postgres native queries
```

Each phase is independently shippable and backward-compatible.

## Cost projection

```
After Phase 4:
  Neon database (1 project, branch-per-stage)   $0/mo  (free tier)
  Docker host on Railway                         $5/mo  (API + plugin runtime)
  Zephyr CDN (static assets)                     $0/mo  (free tier)
  Total                                          ~$5/mo

Current:
  Railway (2GB RAM, all-in-one process)          $20/mo
  Railway Postgres addons                        $5-10/mo per database
  Total                                          ~$25-40/mo
```
