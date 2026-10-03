# Plan 008 (v2): Consolidate `db/migrate.ts` + `db/index.ts` into `everything-dev/db`

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in "STOP conditions" occurs, stop and report — do not improvise. When done, update
> the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9ca44e1..HEAD -- api/src/db plugins/auth/src/db plugins/proposals/src/db plugins/votes/src/db plugins/_template/src/db packages/everything-dev/src/db`
> Expected delta vs. the excerpts below: four one-line changes adding
> `until: isRetryableMigrationError` to `ensureMigrationTable` (api:337,
> proposals:366, votes:366) and the same retry block. On a mismatch beyond that,
> treat as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / tech-debt
- **Branch**: `improve/008-migrate-consolidation` (already created from main @ `c5bf6b52`)
- **Revision**: v2, 2026-09-20 — supersedes the original 008 draft. Adds driver
  consolidation (previously 017 territory), the retry-inversion fix, drops
  `adoptPublicTables` (decision DA-1 below), renames the shared runner to
  `runMigrations` (Alchemy-ready, 017/D3).

## Why this matters

The migration runner is copy-pasted into **four** workspaces (~380–450 lines each,
byte-drifted) and the DB driver into **five** (`db/index.ts`, 73–130 lines each).
Drift has already produced two live bug classes:

1. **Retry inversion (boot race)**: `ensureMigrationTable` in api/proposals/votes uses
   `Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 3, until: isRetryableMigrationError })`.
   In Effect, `until` means **stop** retrying when the predicate is true — so the
   concurrent-boot `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations"` race
   (SQLSTATE `23505` on `pg_type`) gets **zero** retries, exactly the error the retry
   was built to absorb. Verified empirically on the installed Effect 4.0.0-rc.112:
   `while: <retryable-pred>` → 4 attempts; `until: <same>` → 1 attempt. `auth` has **no
   retry at all**. Symptom seen live 2026-09-19: `api` and `votes` dev servers failed
   `initialize-plugin` with `duplicate key value violates unique constraint
   "pg_type_typname_nsp_index"` while `proposals` won the race.
2. **Aborted-transaction bug**: proposals/votes "tolerate" duplicate DDL by catching and
   bare-`continue`ing **without rolling back to a savepoint** — in Postgres an errored
   statement aborts the transaction, so the journal insert and every later statement
   fail with `25P02` exactly in the partial-overlap case the code thinks it handles.
   `api` fixed this with SAVEPOINT/ROLLBACK-TO/RELEASE; the fix never propagated.
3. **Driver drift**: votes/proposals run `CREATE SCHEMA IF NOT EXISTS` on **every pool
   "connect" event** (the same race class re-fought per connection, plus wasted
   round-trips); `_template` hardcodes ssl/timeouts; `auth`'s `close()` console-errors
   a stack trace on every shutdown (log noise); `_template` has no typed `DatabaseError`.

Every future migration/driver fix must be hand-applied 4–5× — it has now failed to
propagate twice (savepoint fix, retry fix).

## Decisions (recorded, do not relitigate)

- **DA-1 — `adoptPublicTables` is dropped, not ported.** It was a one-time boot-time
  relocation (`ALTER TABLE ... SET SCHEMA`) for pre-schema-isolation databases,
  introduced in `36e15deb` (2026-09-02). That window is closed: the live dev DB has
  **zero tables in `public`** (verified 2026-09-20 via `information_schema` query), and
  sandboxes boot fresh. Legacy adoption is `detectDrift`'s fail-closed
  `untracked-existing-schema` refusal + `bos db doctor` guidance — never silent boot
  magic. Alchemy's deploy tier (017/D6) owns any future history adoption explicitly.
- **DA-2 — api's runner is the base**: SAVEPOINT/ROLLBACK-TO/RELEASE duplicate
  tolerance, 3 SQLSTATE codes (`42710`, `42701`, `42P07`), journal-insert inside the
  statement transaction. One deliberate exception: `getExistingTables` takes
  **votes/proposals' parameterized form** (`WHERE table_schema = ${schema}` — drizzle
  binds it), NOT api's `sql.raw(`'${schema}'`)` template interpolation. Schema names
  arrive from `pluginMigrationSlug` output, but parameter binding is the discipline.
- **DA-3 — retry semantics**: `Effect.retry(..., { schedule, times, while: isRetryableMigrationError })`
  — `while`, never `until`. Regression test must assert 4 attempts on `23505`.
- **DA-4 — names track 017/D3**: the shared runner is exported as `runMigrations`
  returning `MigrationReport` (not `migrate` returning `number`), so 017's
  `databaseLayer` wraps it without renaming. `detectDrift` and `loadMigrations` move to
  `everything-dev/db` unchanged in behavior (all four copies are byte-identical there).
- **DA-3 — retry semantics**: `Effect.retry(..., { schedule, times, while: isRetryableMigrationError })`
  — `while`, never `until`. Regression test must assert 4 attempts on `23505`.
- **DA-4 — names track 017/D3**: the shared runner is exported as `runMigrations`
  returning `MigrationReport` (not `migrate` returning `number`), so 017's
  `databaseLayer` wraps it without renaming. `detectDrift` and `loadMigrations` move to
  `everything-dev/db` unchanged in behavior (all four copies are byte-identical there).
- **DA-5 — SUPERSEDED during execution (2026-09-20)**: `_template` is fully aligned to
  the standard flow instead of keeping its divergent journal. `db/migrator.ts` is
  deleted; `_template/src/db/{migrate,layer,index}.ts` become the canonical adapter
  files (byte-identical to api's, minus the dropped `TemplateDatabase` alias — the
  alias was removed per maintainer decision). Journal standardizes to
  `drizzle.__drizzle_migrations`; pre-existing template DBs are adopted automatically
  by the shared runner's preflight (all expected tables exist → recorded as applied
  without replaying DDL); the old in-schema `drizzle_migrations` table is frozen in
  place — matching 017/D6's outcome without the explicit copy step. Rationale:
  `_template`'s `drizzle.config.ts` already pointed drizzle-kit at the standard
  journal, so runtime and tooling disagreed; the opposite alignment (plugins copying
  `migrator.ts`) fights the sync machinery (DA-8).
- **DA-8 — sync discovery**: `bos sync` copies **api's** `db/{index,layer,migrate}.ts`
  verbatim into every plugin's `src/db/` (no personalization — per-workspace bits come
  from relative `./schema`/`./index` imports). api's files are therefore the canonical
  adapters; plugin copies in this repo were written byte-identical to api's (what sync
  would produce). D4's full sync-ownership exit remains 017.
- **DA-9 — Effect-4 nuance discovered during execution**: `Exit.match`'s callbacks
  receive the **`Cause`** (not the unwrapped error), and `Effect.zipRight` does not
  exist in 4.0.0-rc.112. The migrations loader uses `Effect.option` +
  `Option.getOrUndefined` instead of `Exit.match`; the virtual-module loader is a
  **parameter** of `loadMigrations` (`LoadMigrationsOptions.virtual`) so the shared
  package never names `virtual:drizzle-migrations.sql` — the type reference lives in
  the (sync-propagated) adapter, where each workspace's own `global.d.ts` declares the
  module.
- **DA-6 — the dead `pluginId === "api" ? undefined` schema special case stays
  untouched.** api's tables live in `public` today; renaming to `plugin_api` is a data
  migration deferred to 017's workspace adoption.
- **DA-7 — bundling constraints (017/D2, must hold)**: `pg` and `@electric-sql/pglite`
  stay dynamic-`import()`ed inside the shared driver, never statically imported;
  `drizzle-orm` appears in `everything-dev/db` only as `import type` where possible
  (`sql` values ARE runtime imports from drizzle-orm — allowed, but check the
  everything-dev build's externals list stays: drivers external, no new static driver
  imports). The MF singleton share set is unchanged.
  **Amended during execution**: tsdown's unbundle mode rewrites dynamic imports of
  vendored deps into **relative paths** into `dist/node_modules/…`, which breaks two
  consumers — rspack's `externals: ["pg", "@electric-sql/pglite"]` matches bare
  requests only (so pglite's `pglite.wasm`/`pglite.data`/`initdb.wasm` binaries got
  dragged into MF dev bundles → "Module not found" then "Module parse failed"), and
  node's ESM resolution from `dist/db/*.mjs` prefers the vendored
  `dist/node_modules/drizzle-orm` (nearest node_modules wins), whose copied layout
  breaks ESM in the host process ("Cannot find package …/drizzle-orm/index.js").
  Resolution: `deps.neverBundle` gains `pg`, `@electric-sql/pglite` and
  `/^drizzle-orm(\/.*)?$/` so runtime imports stay bare — every workspace with a DB
  already declares pglite + drizzle as its own deps, so dev/prod/`bos init` all
  resolve without dist self-containment.

## Current state (excerpts verified 2026-09-20)

### The retry bug — `api/src/db/migrate.ts:334-339` (same in proposals:363-368, votes:363-368; absent in auth)

```ts
    {
      schedule: Schedule.spaced("500 millis"),
      times: 3,
      until: isRetryableMigrationError,
    },
```

### The 25P2 bug — `plugins/votes/src/db/migrate.ts:306-320` (same in proposals; api:272-290 has the fix)

```ts
              await tx.execute(sql.raw(stmt));
            } catch (cause) {
              if (isDuplicateObjectError(cause)) continue;   // tx aborted; next stmt + journal insert fail 25P02
              throw new DatabaseError({ stage: "migration", migrationTag: migration.tag, statementIndex: i, cause });
            }
```

api's fix (base for the shared runner, `api/src/db/migrate.ts:274-290`):

```ts
              const sp = `stmt_${i}`;
              await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
              try {
                await tx.execute(sql.raw(stmt));
              } catch (cause) {
                if (isDuplicateObjectError(cause)) {
                  await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
                  continue;
                }
                throw new DatabaseError({ stage: "migration", migrationTag: migration.tag, statementIndex: i, cause });
              }
              await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
```

### The driver race — `plugins/votes/src/db/index.ts:66-74` (same in proposals; `_template`:54-61 and `api`:71-78 do it correctly one-time)

```ts
  if (schemaName) {
    pool.on("connect", (client) => {
      client
        .query(
          `CREATE SCHEMA IF NOT EXISTS "${schemaName}"; SET search_path TO "${schemaName}", public`,
        )
        .catch((err: Error) => console.error("[Database] Schema init failed:", err.message));
    });
  }
```

Correct shape (`api/src/db/index.ts`): protocol-level `options: '-c search_path="<schema>",public'`
in `buildPoolConfig` + **one-time** `ensureSchemaExists(pool, schemaName)` via a
`pool.connect()` round-trip before returning the driver.

### Hand-rolled error unions to replace (8× across the four copies)

```ts
    }).pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catch((error: DatabaseError) => Effect.succeed({ ok: false as const, error })),
    );
```

Replace with `Effect.exit` + `Exit.match` (both available in 4.0.0-rc.112).

### Shared helpers already in `everything-dev/db` (`packages/everything-dev/src/db/`)

`core.ts`: `getMigrationStorage`, `pluginMigrationSlug`, `normalizeSlug`,
`isRetryableMigrationError` (RETRYABLE_SQLSTATES: `42P06 42710 42701 42P07 23505 40001 40P01`),
`suppressPgQueryQueueDeprecation`, `extractExpectedTables`, `toSqlArray`.
`identity.ts`, `binding.ts`, `bindings.ts`, `drizzle-kit.ts` — leave alone.
`index.ts` re-exports `./binding ./bindings ./core ./drizzle-kit ./identity`.

### Workspace facts

- All five workspaces test with **vitest** (`bun run test` = `vitest run`).
- `everything-dev/db` is a subpath export in `packages/everything-dev/package.json`
  (`"exports"` includes `"./db"` → `./src/db/index.ts` in development condition).
- `virtual:drizzle-migrations.sql` is an rspack virtual module; under vitest the
  `loadMigrations()` virtual import fails and the disk fallback
  (`loadMigrationsFromDisk`, keyed off `import.meta.dirname` + `meta/_journal.json`)
  loads `migrations/` — that is the test path.
- Test infra: docker test DBs via `bun run test:db:up` (`postgres-api-test` :5434
  `api_test_db`, `postgres-auth-test` :5435 `auth_test_db`); `.env.test` maps URLs.
  Plugin suites default to in-memory PGlite (`pglite::memory:`).
- `loadMigrationsFromDisk` resolves `import.meta.dirname` — when the runner lives in
  `packages/everything-dev/src/db/`, the disk fallback must keep resolving the
  **caller's** migrations dir, not the package's. See Step 2 note.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Start test DBs | `bun run test:db:up` | healthy |
| everything-dev unit | `cd packages/everything-dev && bun run test` | 420 pass (2 skipped) + new tests |
| everything-dev build | `cd packages/everything-dev && bun run build` | success, externals intact |
| api tests | `cd api && bun run test` | 66 pass |
| votes / proposals / auth / _template tests | `cd <ws> && bun run test` | votes 1, proposals 10, auth 174, _template existing count |
| Typecheck (all) | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:
- `packages/everything-dev/src/db/run-migrations.ts` (new — runner, drift, loader)
- `packages/everything-dev/src/db/driver.ts` (create; shared driver)
- `packages/everything-dev/src/db/errors.ts` (create; `DatabaseError`, `unwrapDatabaseError`)
- `packages/everything-dev/src/db/index.ts` (export the three new modules)
- `api/src/db/migrate.ts`, `plugins/{auth,proposals,votes}/src/db/migrate.ts`,
  `plugins/_template/src/db/migrator.ts` → thin adapters
- `api/src/db/index.ts`, `plugins/{auth,proposals,votes,_template}/src/db/index.ts` → thin adapters
- Characterization/regression tests under `packages/everything-dev/tests/unit/`

**Out of scope**:
- `db/layer.ts` files (plugin-owned `DatabaseTag`s, `PluginIdTag`, drift-logging
  UX) — 017. The layers keep importing from their workspace's thin `db/index.ts` /
  `db/migrate.ts` adapters, so layer edits are import-path-only at most.
- Migration SQL files, journal semantics, `getMigrationStorage` behavior.
- `packages/everything-dev/src/cli/db-doctor.ts` / `db-repair.ts` (they duplicate part
  of the diagnosis; adopting `detectDrift` there is a follow-up).
- `plugins/apps` (no db).
- api public→`plugin_api` schema rename (data migration — 017).

## Steps

### Step 1 — Characterization tests FIRST (before touching any source)

Create `packages/everything-dev/tests/unit/db-run-migrations.test.ts` (vitest, follow
the style of `tests/unit/db-binding.test.ts`). Use in-memory PGlite for DB-backed cases:

```ts
const { drizzle } = await import("drizzle-orm/pglite");
const { PGlite } = await import("@electric-sql/pglite");
const pglite = new PGlite();                    // memory
const db = drizzle(pglite);                     // no schema → public
```

`Migration[]` fixtures: hand-written objects `{ idx, when, tag, hash, sql: [...] }`
matching the `virtual:drizzle-migrations.sql` shape. A tiny `Migration`-compatible
type is declared locally for tests (do not import the virtual module).

Write these tests now and record their CURRENT results in the report:

1. **fresh-schema**: two sequential fixture migrations apply; journal contains both
   hashes; second run applies 0.
2. **partial-overlap (the 25P2 bug)**: pre-create one table the second migration also
   creates (via raw SQL through drizzle), then run BOTH runners:
   - api's runner (`api/src/db/migrate.ts#migrate`) → **passes** (savepoint rollback).
   - proposals'/votes' runner (currently `plugins/votes/src/db/migrate.ts#migrate`,
     imported by relative path in the test) → **fails with 25P02** (aborted tx).
   Record both outcomes; the failing expectation against the old runner becomes the
   regression test for the shared runner. (Import the old runners via direct relative
   file paths into the test so both are exercised pre-consolidation; after Step 3 the
   old-runner variant is deleted and the shared-runner variant is the keeper.)
3. **retry-regression**: `Effect.retry` semantics — a stub db driver whose
   `CREATE TABLE` fails once with `{ code: "23505" }` then succeeds must produce
   **exactly 4 attempts** under the shared runner's schedule
   (`Schedule.spaced("1 millis")` override via a test-injectable delay is fine; what
   must NOT change is `while:` semantics). Write it against the NEW shared runner's
   `ensureMigrationTable` after Step 2 (Step 1 just sketches it, marked `it.todo` or
   skipped until then — do NOT write it against the old `until:` code).
4. **journal-skip + duplicate-preflight**: migration whose tables all already exist is
   recorded as applied without replaying DDL (api behavior, keep).

**Verify Step 1**: `cd packages/everything-dev && bun run test -- tests/unit/db-run-migrations.test.ts` →
case 1 passes, case 2 passes for api and fails for proposals/votes (25P02), case 4
passes. Report the observed SQLSTATEs.

### Step 2 — Shared runner in `everything-dev/db`

Create `packages/everything-dev/src/db/run-migrations.ts`. Base it on **api's
`db/migrate.ts` verbatim** (it is the newest, savepoint-correct copy) with these
transformations:

- Rename `migrate` → `runMigrations`; return `MigrationReport`:

```ts
export interface MigrationReport {
  applied: number;
  total: number;
  storage: MigrationStorage;
  schema: string | undefined;   // undefined = public
}
export interface RunMigrationsOptions {
  schemaName?: string;          // plugin_<slug> namespace; undefined → public
  journal?: MigrationStorage;   // default getMigrationStorage()
  duplicateSqlStates?: readonly string[]; // default ["42710","42701","42P07"]
}
export function runMigrations(
  db: DatabaseHandle,           // drizzle PgDatabase — structural type, see below
  migrations: Migration[],
  opts?: RunMigrationsOptions,
): Effect.Effect<MigrationReport, DatabaseError>
```

- `Database` handle: the four copies import `{ Database, DatabaseError }` from their
  own `./index`. To avoid a package→plugin import, define a minimal structural
  interface in `everything-dev/db` (what the runner actually uses): an object with
  `execute(query): Promise<unknown>` and
  `transaction<T>(fn: (tx: { execute(query): Promise<unknown> }) => Promise<T>): Promise<T>`.
  Keep it type-only where possible; the plugins' concrete drizzle `Database` types
  satisfy it structurally. If a cast is needed at the adapter boundary, that's
  acceptable and local to the adapter.
- Move over unchanged: `normalizeRows`, `isDuplicateObjectError` (parameterized by
  `duplicateSqlStates`), `getExistingTables` (api's parameterized version),
  `readAppliedHashes`, `journalRef`, the preflight logic, `ensureMigrationTable`
  (**with `while: isRetryableMigrationError`** — DA-3), `detectDrift`, `DriftReport`,
  `LoadedMigrations`, `loadMigrations`, `loadMigrationsFromDisk`.
- `loadMigrations`' disk fallback: `import.meta.dirname` now points INSIDE
  everything-dev. Change the disk path resolution to take the caller's directory as an
  argument: `loadMigrations(fromDir?: string)` — adapters pass `import.meta.dirname`
  from the workspace file; virtual-module path is unchanged and still tried first.
- Replace every `{ ok: true as const }` / `Effect.catch` union with `Effect.exit` +
  `Exit.match` (api:110-111, 134-136 are the two sites inside `loadMigrations`).
- Export from `packages/everything-dev/src/db/index.ts`.

**Verify**: `cd packages/everything-dev && bun run test && bun run build` → green;
`bun typecheck` → exit 0. Build check (DA-7): no static `import("pg")` /
`@electric-sql/pglite` added to the dist output.

### Step 3 — Swap the four runners, one workspace at a time

Order: **api → votes → proposals → auth** (newest to oldest). Each workspace's
`db/migrate.ts` becomes a thin adapter (< ~40 lines) that:

- re-exports `loadMigrations` (bound to its own dir),
- calls the shared `runMigrations` with its workspace defaults, preserving the current
  public signature so `db/layer.ts` call sites stay untouched:

```ts
// plugins/votes/src/db/migrate.ts (target shape)
export { detectDrift, loadMigrations, type DriftReport } from "everything-dev/db";
import { runMigrations, getMigrationStorage } from "everything-dev/db";
import type { Database, DatabaseError } from "./index";   // thin, see Part B

export function migrate(db, migrations, storage?, schemaName?) {
  return Effect.map(
    runMigrations(db, migrations, { journal: storage, schemaName }),
    (r) => r.applied,
  );
}
```

- `auth`'s adapter passes no `schemaName` (dedicated DB) and gains duplicate
  tolerance + the retry via the shared runner (its old copy threw on any error) —
  verify auth's suite stays green (STOP condition below if not).
- `_template` (`db/migrator.ts`): **superseded by DA-5** — the file is deleted;
  `_template/src/db/migrate.ts` and `db/layer.ts` are verbatim copies of api's
  canonical adapters (plus `import.meta.dirname`-bound `loadMigrations`), the journal
  standardizes to `drizzle.__drizzle_migrations` with preflight auto-adoption, and the
  `TemplateDatabase` alias is dropped from `db/index.ts`. The
  `tests/unit/things-service.test.ts` helper signatures pick up the (correctly typed)
  `DatabaseError` error channel.

After each swap run that workspace's suite; the partial-overlap regression test must
pass against the shared runner.

**Verify after all four + _template**: `bun typecheck && bun lint` exit 0; api 66,
votes 1, proposals 10, auth 174 pass; old-runner import in the characterization test
is gone; `grep -rn "ok: true as const" api/src plugins/*/src packages/everything-dev/src/db`
→ no matches in migration code.

### Step 4 — Shared driver

Create `packages/everything-dev/src/db/driver.ts` — the five `createDatabaseDriver`
copies collapse onto one implementation using the **best-of-five** shape:

- PGlite branch: identical to current copies (memory/dir handling, `mkdirSync` for
  file dirs, one-time `CREATE SCHEMA` + `SET search_path` via `pglite.exec`).
- Postgres branch: `buildPoolConfig` with **protocol-level** search_path
  (`options: '-c search_path="<ns>",public'`), env-driven pool knobs
  (`DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS`,
  `DB_SSL_REJECT_UNAUTHORIZED`; local URLs never ssl), **one-time** schema creation
  via `pool.connect()` round-trip (NOT a per-connection "connect" handler — this
  deletes votes'/proposals' per-connection race, DA-2-adjacent), single `error`
  listener, idempotent close that removes listeners and ends the pool with **no**
  stack-trace logging (deletes auth's shutdown noise).
- Signature per 017/D3 (plugin schema type param):

```ts
export interface DriverOptions {
  schema: unknown;              // the plugin's drizzle schema module namespace
  namespace?: string;           // undefined → public / dedicated DB
}
export async function createDatabaseDriver<TSchema>(
  url: string,
  schema: TSchema,
  namespace?: string,
): Promise<{ db: PgDatabase<PgQueryResultHKT, TSchema>; close(): Promise<void> }>
```

  (Flat args, not an options object, to keep the five call sites one-line diffs;
  017's `createDatabaseDriver(url, options)` reshaping happens when `databaseLayer`
  lands.)
- `errors.ts`: move `DatabaseError` (TaggedError, stages `driver | migration | load |
  close`) + `unwrapDatabaseError` into `everything-dev/db` — one class identity for
  all workspaces. Add `pluginSchemaName(pluginId)` (pure: `plugin_${pluginMigrationSlug(pluginId)}`)
  — exported now for 017, used nowhere new yet (DA-6).
- The five `db/index.ts` become thin adapters that keep their current public surface
  (`Database` type from their own schema, `DatabaseDriver`, `createDatabaseDriver`
  signature, `DatabaseError` re-export) and delegate to the shared driver. `_template`
  additionally keeps `TemplateDatabase` as an alias for its `Database`.
- `auth`'s workspace driver drops its debug `console.error` in `close()`.

**Verify**: `cd packages/everything-dev && bun run build` → success; the workspace
suites still pass (they exercise `createDatabaseDriver` heavily via helpers);
`bun typecheck` exit 0. Confirm dist externals: drivers dynamic-imported only.

### Step 5 — Postgres verification

`bun run test:db:up`. Run the partial-overlap scenario through the SHARED runner
against real postgres (`api_test_db` on :5434): one-off scratch script (not committed)
that pre-creates a fixture table, runs `runMigrations` with api's migration fixtures
(or the plugin's real migrations against a scratch schema), and asserts completion +
journal rows. pglite and postgres differ in transaction-abort semantics; `25P02` only
reproduces faithfully on postgres.

**Verify**: scenario completes; report observed SQLSTATE handling.

## Test plan

- `tests/unit/db-run-migrations.test.ts` is the permanent regression suite: fresh
  schema, partial-overlap (25P2), duplicate-code skip + journal write,
  retry-semantics (4 attempts on `23505`), drift statuses (healthy /
  untracked-existing-schema / drift-safe-repair / drift-manual) if cheap.
- Per-workspace suites stay green — they boot real migrations through each plugin's
  layer.

## Done criteria

- [ ] `wc -l` on the five `db/migrate.ts`/`migrator.ts` and five `db/index.ts` shows
      thin adapters (< ~40 lines each)
- [ ] Partial-overlap regression test passes on the shared runner (pglite + postgres)
- [ ] Retry regression: shared runner retries `23505` → 4 attempts total
- [ ] `grep -rn "until: isRetryableMigrationError" api/src plugins/*/src packages/everything-dev/src` → no matches
- [ ] `grep -rn "ok: true as const" api/src plugins/*/src packages/everything-dev/src/db` → no matches in migration code
- [ ] No `adoptPublicTables` anywhere under `api/src`, `plugins/`, `packages/everything-dev/src/db`
- [ ] `bun typecheck`, `bun lint`, all workspace suites pass; everything-dev build green with driver externals intact
- [ ] Changeset: everything-dev **minor** (new shared API); api + plugins **patch**
      (retry fix, savepoint fix for proposals/votes, per-connection schema race fix,
      auth close-noise removal)
- [ ] `advisor-plans/README.md` 008 row → DONE

## STOP conditions

- The partial-overlap characterization does NOT fail against proposals/votes' current
  runner (25P2 reasoning wrong) — consolidation still proceeds, but re-scope the bug
  claim and report.
- pglite cannot reproduce savepoint/abort semantics AND postgres harness is
  unavailable — STOP (regression coverage is the point of the consolidation).
- A workspace's suite breaks after its swap for reasons not attributable to the
  runner options — STOP and report the failure with the suite output.
- Bundling check (DA-7) fails: static driver imports leak into `everything-dev` dist.
- Any in-scope file diverges from the drift check beyond the four known one-line
  retry additions.

## Maintenance notes

- Future migration fixes land in exactly ONE file (`everything-dev/db`). Reviewer:
  scrutinize savepoint naming (unique per statement index within a transaction) and
  that the journal insert stays INSIDE the statement transaction.
- 017 consumes this runner as `runMigrations` + `MigrationReport` verbatim; do not
  rename on 017's account later.
- Legacy public-era table adoption (if a prod DB ever needs it) belongs in
  `bos db` tooling or the alchemy deploy tier — never boot-time (DA-1).
- 009 (error taxonomy) will further unify error types; `DatabaseError`'s new home in
  `everything-dev/db` is the anchor for that.
