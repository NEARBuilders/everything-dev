# Per-plugin database boilerplate absorption (`everything-dev/db`)

> Ticket: [#89](https://github.com/NEARBuilders/citynode.app/issues/89) (design spike)
> Status: MOSTLY DONE — **amended 2026-09-15** after the orpc-v2 / effect-native-plugins review (original decision favored an `every-plugin/db` facade; the amendment moves the home to `everything-dev/db` and drops the `every-plugin/auth` facade). **2026-09-26 audit:** `packages/everything-dev/src/db/` is landed and plugins' per-plugin files are thin sync-owned adapters. Remaining: the `databaseLayer` factory (referenced only in docs — no `.ts` exists), the db files' sync-ownership exit, and shrinking `plugins/*/db/layer.ts` (still a 91-line vendored copy; goal ~10 lines)
> Prototype: ~~[plans/prototypes/db-auth-absorption/](../prototypes/db-auth-absorption/)~~ → archived at [plans/done/db-auth-absorption-prototype/](../done/db-auth-absorption-prototype/) (slug / namespace / R-channel proofs stand; the `databaseLayer` factory supersedes its vendored layer shape)
> Build plan: [docs/plans/017-db-layer-in-everything-dev.md](../017-db-layer-in-everything-dev.md) (depends on 008; rides the effect-native-plugins Phase 4 window)
> Origin: post-migration improvement survey (2026-09-15), finding DIR-01 / A6

## Problem

A minimal DB-backed plugin carries ~250 lines of framework plumbing copied from
`_template` and maintained by `bos sync` overwriting local edits:

- A private `db/layer.ts` copied across `api/src/db/layer.ts` and
  `plugins/{proposals,votes,_template,auth}/src/db/layer.ts` — near-identical with drift:
  proposals/votes carry a vestigial `pluginId === "api" ? undefined : …` special case
  (dead code — they are never `api`), and three different plugin-id→slug normalizers exist
  (`_template`'s private `normalizeSlug`, `everything-dev/db`'s `pluginMigrationSlug`,
  `every-plugin`'s `getNormalizedRemoteName`).
- Per-plugin `db/index.ts` driver files (73–130 lines each: pglite/pg selection,
  `search_path` wiring, pool lifecycle).
- Per-plugin `db/migrate.ts` runners (~380–450 lines, byte-drifted) — the proposals/votes
  copies (and `_template`'s `db/migrator.ts`) share an aborted-transaction bug: duplicate
  DDL "tolerance" does a bare `continue` inside a transaction without rolling back to a
  savepoint, so the journal insert and every later statement fail with 25P02 exactly in
  the partial-overlap case being "handled".
- Three journal conventions: api/auth/proposals/votes use `drizzle.__drizzle_migrations`;
  `_template` uses an in-schema `drizzle_migrations` table.
- `PluginIdTag` leaking into every plugin author's `initialize` signature.

The requirements this must serve (product constraints):

- **Many plugins, one shared database, schema-isolated** (`plugin_<slug>` schemas).
- **Engine variety**: postgres (prod/Neon), PGlite embedded (dev = test = sandbox, per
  ticket 11 — one dialect everywhere), SQLite as a future engine, and plugins with no
  database at all.
- **api runs in the public schema; auth runs on a dedicated database.**
- **Migrations must be reliable and easy** — transactional, hash-tracked, idempotent.

## Why the amendment (what changed and why)

The original decision moved runtime db pieces into a new `every-plugin/db` facade
subpath. Three findings flipped it:

1. **effect-native-plugins Phase 5 deletes the `every-plugin/*` re-export barrels** —
   plugins will import `effect`/`@orpc/*`/`zod` directly. every-plugin's surface is
   shrinking to the plugin factory + runtime; growing it with a db subpath runs against
   that direction.
2. **`everything-dev/db` is already the runtime-imported home** — 4 of 5 workspaces'
   `db/layer.ts` import `getMigrationStorage`/`pluginMigrationSlug` from it today. The
   "coupling" the original decision was fixing already exists and is fine: the helpers
   are pure functions, bundled per-remote, drivers still externalized.
3. **Alchemy is the downstream destination** (wayfinder decisions 13/16): migrations move
   to **deploy time** for remote engines (`Drizzle.Schema` regenerates SQL on deploy,
   `Neon.Branch({ migrations })` applies transactionally with hash tracking and adopts
   existing `__drizzle_migrations` history verbatim). The deploy package is
   `everything-dev` — investing in a runtime-package facade would be throwaway motion.

## Goal

A fresh DB-backed plugin carries **one ~10-line plugin-owned `db/layer.ts`** plus its
drizzle `schema.ts` and `migrations/` directory. Everything else — engine selection,
namespace isolation, pool lifecycle, migration running — comes from `everything-dev/db`.
No `every-plugin/db`, no `every-plugin/auth` (plan 007's middleware convergence is the
resting point for auth).

## Decisions

### D1 — Canonical slug semantics (unchanged from the original spike)

`everything-dev/db`'s `pluginMigrationSlug` is canonical. It is already consumed by 4 of
5 db-layer copies, the CLI (`db-doctor`, `db-studio`), the host's DB bindings resolution,
and `drizzle.config.ts` identity. `_template`'s private `normalizeSlug` is the drift and
is deleted. Schema names are **unconditional** `plugin_<slug>` for every workspace on the
shared API database (including `api` itself → `plugin_api`; the proposals/votes `api`
special case is dead code — no data migration needed). The plugin id is the `bos.config.json`
key, arriving via `PluginInitializeInput.pluginId` (effect-native-plugins Phase 1.2 adds
it) — the same id the host uses for secret injection, so schema, secret name, and journal
all derive from one source.

### D2 — Drivers stay externalized (unchanged)

`pg` and `@electric-sql/pglite` stay out of the Module Federation singleton share set and
out of static `everything-dev/db` imports — `createDatabaseDriver` selects engines via
dynamic `import()`; plugins keep declaring the drivers they use; the rspack
`externals: ["pg", "@electric-sql/pglite"]` convention is unchanged. `drizzle-orm`
appears in `everything-dev/db` only as `import type`. The MF singleton set is unchanged.

### D3 — Home: `everything-dev/db` (amended)

`everything-dev/db` gains exactly four runtime exports:

```ts
import type { PgDatabase, PgQueryResultHKT, PgSchema } from "drizzle-orm/pg-core";

export function pluginSchemaName(pluginId: string): string;   // `plugin_${pluginMigrationSlug(pluginId)}`

export interface DriverOptions { namespace?: string }         // undefined → public schema
export function createDatabaseDriver<TSchema>(
  url: string,
  options?: DriverOptions & { schema: TSchema },
): Promise<{ db: PgDatabase<PgQueryResultHKT, TSchema>; close(): Promise<void> }>;

export function databaseLayer<TSchema>(
  tag: Context.Service<any, PgDatabase<PgQueryResultHKT, TSchema>>,
  url: string,
  options: {
    pluginId: string;
    schema: TSchema;
    migrations?: () => Promise<Migration[]>;
    namespace?: boolean;                                      // false → public/dedicated (api, auth)
  },
): Layer.Layer<typeof tag, DatabaseError, never>;

export function runMigrations(driver: Driver, migrations: Migration[], opts?): Promise<MigrationReport>;
```

- **Engine by URL scheme**: `postgres://` → `pg.Pool`; `pglite:`/`:memory:` → PGlite
  (dir or memory); `sqlite:` later. The driver interface is shaped so a SQLite engine is
  an addition, not a redesign.
- **`databaseLayer` is the plugin author's whole surface** — acquireRelease the driver,
  apply migrations, return the typed db on the plugin-owned tag. The tag stays
  plugin-owned (`"template/Database"`, typed to the plugin's drizzle schema) so
  `yield* DatabaseTag` is fully typed and no two plugins can collide on one shared tag
  id.
- **No `PluginIdTag` anywhere in plugin code**: the layer takes `pluginId` as a value
  (from `config.pluginId`), so `initialize`'s R channel is `Scope.Scope` only. Effect 4
  removed `FiberRef`, so ambient injection was rejected.

### D4 — `bos sync` exits db ownership (amended)

`db/*` and `lib/context.ts` **leave `FRAMEWORK_OWNED_SYNC_FILES` and the per-plugin
derived list entirely** — no re-export shim cycle. Children keep whatever they have and
are never framework-updated on those paths again; sync's existing upstream-deleted
semantics handle the one-time removal for pristine children, and locally-modified files
are kept (conflict path). A fresh plugin's sync-owned surface is `rspack.config.js`,
`drizzle.config.ts`, `tsconfig*.json`, `tests/types.d.ts`, `src/global.d.ts`, and the
thin `lib/auth.ts` (plan 007).

### D5 — Isolation is "namespace", one concept per engine (new)

The same `namespace` option expresses every topology the platform needs:

| Topology | Engine | Namespace behavior |
|---|---|---|
| Many plugins, one shared DB | postgres / PGlite | `CREATE SCHEMA plugin_<slug>` + `search_path` |
| api on the shared DB | postgres | none — public schema |
| auth | postgres (dedicated DB) | none — `public` on its own database |
| Plugin with no DB | — | no `databaseLayer` at all |
| Future: embedded per-plugin store | sqlite | per-plugin file (`.data/<slug>.db`) — schemas don't exist in SQLite |

PGlite is the embedded engine now (ticket 11: one Postgres dialect everywhere — dev =
test = sandbox = PGlite, prod = Postgres/Neon). The SQLite driver is a later addition
with its own namespace expression; the abstraction is ready for it.

### D6 — Journal + migration timing: tiered (new)

- **Journal**: every workspace standardizes on `drizzle.__drizzle_migrations` (api's
  existing convention). `_template`'s in-schema `drizzle_migrations` history is adopted
  once (copy hashes, freeze the old table). This is deliberately the journal alchemy
  recognizes and adopts verbatim later, so today's choice **is** the migration path to
  deploy-time.
- **Timing**: boot-time apply is **permanent** for embedded engines (PGlite sandboxes and
  dev/test boot fresh databases nothing else migrates); deploy-time apply via
  `Drizzle.Schema` → `Neon.Branch({ migrations })` is the path for remote engines once
  alchemy lands (decision 17 gates it on this migration). Both tiers consume the same
  `drizzle-kit generate` migrations-directory contract — the runtime runner (008's
  consolidated, savepoint-fixed implementation) and the deploy graph are two consumers of
  one format, not two systems.
- **Reliability floor** (all in the one runner): per-migration transaction with the
  journal insert, SAVEPOINT-based duplicate tolerance (008's api fix — the
  proposals/votes/`_template` bare-`continue` 25P02 bug), retryable-SQLSTATE backoff,
  hash-tracked idempotence.

## Future seams (recorded, not built now)

- `drizzle-orm@0.45.2` has no Effect export; `@effect/sql` is Effect-3-pinned — neither
  is usable under Effect 4.0.0-rc.112 today. When `@effect/sql` v4 (or alchemy's
  `Drizzle.Postgres` runtime client, which needs it) catches up, the **plugin-owned
  `DatabaseTag` is the swap seam**: `databaseLayer` internals change, no plugin or
  service code does.
- Alchemy adoption (decisions 13/16/17): `bos deploy` generates the alchemy program from
  `[infra]`; remote engines migrate at deploy; the runner stays for embedded tiers.

## Workspace migration plan

Single build plan ([docs/plans/017](../017-db-layer-in-everything-dev.md)),
executed in the effect-native-plugins Phase 4 window (both rewrite the same files):

1. 008's consolidated runner lands in `everything-dev/db` (as planned).
2. `everything-dev/db` gains `createDatabaseDriver` + `databaseLayer` + the namespace
   model; `_template`'s `db/{index,layer,migrator}.ts` collapse into the ~10-line layer +
   schema + migrations (virtual-module pipeline stays as the runtime carrier).
3. Workspaces adopt: api (public namespace), auth (dedicated DB, no namespace),
   proposals/votes (delete the dead `api` special case — no data migration; their runner
   copies and the 25P02 bug disappear with them), apps (lib only, plan 007).
4. Sync ownership exits db files (D4); journal standardization with one-time history
   adoption for `_template`.

## Risks

- **Bundling**: `everything-dev/db` must keep drivers dynamic-imported and drizzle
  type-only (D2) — verified in plan 017's checks.
- **Journal adoption**: the one-time `_template` history copy must be idempotent and
  fail-closed (STOP condition in 017).
- **Sync deletion**: locally-modified db files must be kept, never deleted (STOP
  condition in 017).

## Relationship to advisor plans

- 017 (slim, rewritten): lands the helpers and migrates workspaces; depends on 008;
  rides effect-native Phase 4.
- 008: stands as written — its consolidated runner is the foundation 017 consumes; it
  also fixes the 25P02 bug class.
- 001's `buildScoped` still lands, but the db story no longer needs it
  (effect-native `initialize` returns a `Layer`, composed with `Layer.provide`); its
  `PluginEnv` alias is dead.
- 002/007: unchanged (007 is the auth resting point).
- 010: unaffected — the singleton set is unchanged (D2).
- effect-native-plugins: Phase 1.2 gains the `pluginId` input; Phase 4.1's target shape
  already composes `DatabaseLive` via `Layer.provide` — this design is what that
  `DatabaseLive` becomes.
