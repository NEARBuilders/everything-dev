# Plan 066: Migrate the database connection layer to `effect/unstable/sql` — Drizzle stays, the driver/pool/migrate plumbing is absorbed

> **Executor instructions**: Follow this plan step by step. It begins with a **go/no-go spike**: if the spike fails any gate, STOP and report — the migration is off until `effect/unstable/sql` supports what the seam needs. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- packages/everything-dev/src/db/ api/src/db/ plugins/*/src/db/ pnpm-workspace.yaml`
> On any mismatch, compare the "Current state" excerpts against the live code before proceeding; on a conflict, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M (spike S + migration M)
- **Risk**: MED (database plumbing touches every DB-backed plugin; mitigated by the ADR 0033 seam being designed for exactly this swap)
- **Depends on**: none
- **Category**: tech-debt / migration
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/647

## Why this matters

The repo pins `effect 4.0.0-rc.117`, whose core now ships `effect/unstable/sql` — SQL client, migrations, and schema-typed queries — plus `@effect/sql-pg` (Postgres driver) and `@effect/sql-pglite` (PGlite driver). The platform hand-rolls the same surface in `packages/everything-dev/src/db/`: engine selection by URL scheme, pglite/pg pool management, per-plugin `search_path` namespace isolation, migrate-on-boot with a journal-scoped advisory lock. Notably, the ecosystem is converging from both directions: Drizzle (the repo's ORM, staying) now ships its own `@effect/sql-pg` driver. ADR 0033 declared the db seam "scaffolded once, owned by this app, free to swap" — this plan exercises that freedom: swap the *connection/driver/migration* plumbing to the Effect core modules and delete the hand-rolled equivalent, keeping `drizzle` as the query builder and `DatabaseTag` (the app-facing interface) unchanged so handlers and plugins are untouched.

## Current state

- **The seam** — `api/src/db/layer.ts:1-34` (exemplar for all DB-backed workspaces):

```ts
// api/src/db/layer.ts:1-7, 28-34 — "The workspace's database seam (ADR 0033) —
// scaffolded once, owned by this app, free to swap."
export class DatabaseTag extends Context.Service<DatabaseTag, Database>()("api/Database") {}

export const DatabaseLive = (config: { pluginId: string; secrets: { API_DATABASE_URL: string } }) =>
  databaseLayer(DatabaseTag, config.secrets.API_DATABASE_URL, {
    pluginId: config.pluginId,
    schema,
    migrations: loadMigrations,
    namespace: false,
  });
```

- **The hand-rolled layer** — `packages/everything-dev/src/db/driver.ts:203-231`, `createDatabaseDriver(url, schema, namespace?)`: URL-scheme engine selection (`pglite:`/`:memory:` → embedded PGlite with `CREATE SCHEMA IF NOT EXISTS "<namespace>"` + `SET search_path` on the connection; anything else → `pg.Pool` via `buildPoolConfig(url, namespace)`), drivers deliberately externalized (dynamic `import()`, never in the MF singleton share set — comment at `:196-201`). Pool teardown via `pool.end()` finalizers (`:185-188`).
- **Migration machinery** — `databaseLayer` (in `everything-dev/db` per plan 017's landed core): migrate-on-boot, journal-scoped advisory lock (ADR 0019 serialization), drift detection.
- **Consumers**: `api/` (namespace: false, public schema), `plugins/*` (namespace: `plugin_<slug>` schema isolation on the shared dev DB — set via `search_path` on every connection), `auth` (dedicated database). Test DBs: `.env.test` maps every `*_DATABASE_URL` to the compose test databases (`pnpm run test:db:up`).
- **Candidate modules** (already in the dependency tree via `effect`): `effect/unstable/sql` (client, migrations), `@effect/sql-pg` (PgClient — check its `searchPath` option), `@effect/sql-pglite` (check availability/parity in the installed rc), Drizzle's `@effect/sql-pg` driver integration (for running drizzle over an effect-sql client).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0 |
| Framework tests | `pnpm run test:framework` | all pass |
| API tests | `pnpm --filter api test` | all pass |
| Plugin tests | `pnpm --filter everything-dev test && pnpm --filter every-plugin test` | pass |
| Test DBs | `pnpm run test:db:up` | compose up healthy |
| Effect SQL module inspection | `ls node_modules/effect/unstable/ | grep sql; ls node_modules/@effect/sql-pg 2>/dev/null` | modules present at the installed rc |

## Scope

**In scope**:
- `packages/everything-dev/src/db/` (the internals behind `databaseLayer`/`createDatabaseDriver` — the swap target)
- `packages/everything-dev/package.json` + `pnpm-workspace.yaml` (add `@effect/sql-pg` / `@effect/sql-pglite` to the catalog if absent)
- Per-workspace `db/layer.ts` adapters ONLY if their constructor options change shape (goal: zero changes)

**Out of scope** (do NOT touch):
- Any `DatabaseTag` definition, handler code, or repository query code (drizzle queries stay drizzle).
- `plugins/*/src/db/schema.ts` (ADR 0033: schema is app surface).
- The auth plugin's dedicated-database topology beyond verifying parity in tests.
- Swapping drizzle for Effect Schema queries (the `effect/unstable/sql` typed-query surface — deliberately NOT adopted; the repo's oRPC/Zod contract layer and drizzle investment stay).

## Git workflow

- Branch: `feat/effect-sql-db-layer`
- Commit style: conventional commits, e.g. `refactor(db): migrate connection layer to effect/unstable/sql — drizzle unchanged`

## Steps

### Step 1: the go/no-go spike (read-only + throwaway checks)

Against the INSTALLED rc (`node_modules/effect/unstable/sql`, `node_modules/@effect/sql-pg`):
1. **search_path per connection**: does `@effect/sql-pg`'s client config support `searchPath` (or equivalent) applied on EVERY pooled connection (not just the first)? The namespace contract is `plugin_<slug>` isolation on a shared database — check the driver source for how it applies search_path. If missing, can it be injected per-connection (a connection hook/initializer)? Record the mechanism verbatim.
2. **PGlite**: does `@effect/sql-pglite` exist at this rc, and does it accept a data dir + in-memory mode (parity with `driver.ts:208-220`)?
3. **Migrations**: does `effect/unstable/sql` migrations support journal-scoped advisory locking (ADR 0019 parity), or is the existing `runMigrations` advisory-lock wrapper kept on top?
4. **Drizzle interop**: can a drizzle `node-postgres`-shaped db be constructed over an effect-sql client (Drizzle's `@effect/sql-pg` driver), or does drizzle keep its own pool (meaning the swap is pool-only, drizzle over `pg.Pool` unchanged)?
Write findings into `docs/plans/v1-current/effect-sql-spike.md` (create). A single "no" on (1) without an injection mechanism = migration blocked → STOP and report.

**Verify**: spike doc exists with the four answers, each with a file:line from the installed modules.

### Step 2 (only if Step 1 passes): swap `createDatabaseDriver` internals

Behind the SAME `createDatabaseDriver(url, schema, namespace?)` signature: replace the hand-rolled pglite/pg construction with the effect-sql client construction chosen by Step 1 (pg → `@effect/sql-pg` with the namespace mechanism; pglite → `@effect/sql-pglite`). Keep: URL-scheme selection, externalized-driver rule (dynamic import, never in MF share set — the comment at `driver.ts:196-201` is a deploy-train constraint, preserve it), pool-teardown semantics via scoped finalizers. Drizzle db construction unchanged (whatever Step 1(4) determined).

**Verify**: `pnpm run typecheck` → 0.

### Step 3: migrations under the new client

Run the existing `runMigrations` (advisory-lock wrapper) against the new client, or adopt `effect/unstable/sql` migrations if Step 1(3) showed parity — pick ONE, state it in the spike doc's follow-up section. The journal/advisory-lock behavior is the invariant: two processes migrating concurrently must serialize (test exists per plan 017's landed work — locate and keep it green).

**Verify**: `pnpm --filter everything-dev test -- migrate` → green (or the equivalent existing suite name; grep for it first).

### Step 4: full parity sweep

All DB-backed surfaces against the real test DBs: `pnpm run test:db:up` then `pnpm run test:framework && pnpm --filter api test`. Manually boot `pnpm run dev` (pglite zero-config path) and confirm: plugin schema isolation (`\dt` inside `plugin_votes` etc. shows the plugin's tables), migrate-on-boot, pool cleanup on `bos kill` (no lingering connections: `SELECT count(*) FROM pg_stat_activity` returns to baseline).

**Verify**: all suites green; manual checks recorded in the PR description.

### Step 5: delete the hand-rolled code

Remove whatever `driver.ts` internals are now absorbed (pool construction, connection setup) — the deletion is the payoff; measure and record the LOC delta in the PR. Keep `createDatabaseDriver`'s public signature and `databaseLayer`'s options surface byte-identical.

**Verify**: `pnpm run typecheck && pnpm run lint && pnpm run test:framework && pnpm --filter api test` → all green; `git diff --stat` shows net-negative LOC in `packages/everything-dev/src/db/`.

## Test plan

- Existing suites are the parity gate (framework + api). Locate the concurrent-migration/advisory-lock test (plan 017's landed work) and keep it green — it is THE invariant test for this migration.
- New: one unit test asserting namespace isolation through the new client on a real pglite instance (two namespaces, table created in one invisible in the other) if an equivalent test doesn't already exist — grep before writing.
- Structural pattern: existing `packages/everything-dev/src/db/*.test.ts` if present.

## Done criteria

- [ ] Spike doc answers the four go/no-go questions with installed-code evidence
- [ ] `createDatabaseDriver`/`databaseLayer` public surface unchanged (grep consumers: `grep -rn "createDatabaseDriver\|databaseLayer" packages api plugins --include="*.ts" | grep -v node_modules` → call sites untouched)
- [ ] All suites green: typecheck, lint, test:framework, api tests
- [ ] Dev boot (pglite path) + Postgres path verified; namespace isolation confirmed
- [ ] Net-negative LOC in `packages/everything-dev/src/db/` (recorded in PR)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1(1) fails: no per-connection `search_path` mechanism at the installed rc — the namespace contract is structural; report and halt the migration.
- `@effect/sql-pglite` is absent/parity-broken at the installed rc — the zero-config dev path is load-bearing.
- The advisory-lock migration invariant test fails under the new client after one genuine fix attempt — serialization correctness outranks the LOC win.
- The swap would leak into MF shared singletons (the externalized-driver rule) — report the bundling conflict instead of adding exclusions ad hoc.

## Maintenance notes

- After this lands, `effect/unstable/sql`'s typed-query surface remains deliberately unadopted — revisit only if the oRPC/Zod contract layer ever moves to Effect Schema (a much larger decision, out of scope).
- The per-workspace `db/layer.ts` files are ADR 0033 app surface and must NOT have changed — if the migration forced a shape change there, the seam contract drifted; escalate.
- Reviewer scrutiny: the externalized-driver rule (MF share set), pool finalizer semantics, and that no handler or query file appears in the diff.
