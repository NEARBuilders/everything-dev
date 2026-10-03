# ADR 0019: Migrations serialize on a journal-scoped Postgres advisory transaction lock

Date: 2026-09-26
Status: Accepted

## Context

Every DB-backed plugin auto-applies its drizzle migrations at boot (AGENTS.md's
operating contract), and in dev mode every local plugin is initialized by
**two concurrent processes**: its own dev-server process and the host's
in-process Module Federation load. Both run `initialize` → `runMigrations`
against the same fresh database, and all workspaces sharing a database also
share one journal table (`drizzle.__drizzle_migrations`), so even *different*
plugins in *different* processes race each other on journal creation. The same
class appears elsewhere: parallel vitest files against shared test databases,
two `bos dev` sessions (port allocation is leased per ADR 0012, database URLs
are static), overlapping `ON_FAILURE` restarts in production, and the driver's
own `ensureNamespaceExists` schema pre-creation.

When two `CREATE TABLE` statements for the same object run concurrently, the
loser does not get 42P07 ("relation already exists" is impossible while the
winner is uncommitted) — it gets SQLSTATE 23505 on a pg_catalog unique index
(`pg_type_typname_nsp_index`). The runner's SAVEPOINT duplicate-DDL tolerance
(42710/42701/42P07) did not recognize that shape, the escaping
`DatabaseError` classified as `unknown → permanent`, and #253's fail-fast
plugin-load policy then served the stack without the plugin — where the
pre-#253 silent 120s retry used to self-heal the same race. That error-shape
matching (PR #258's tolerance) is a *heuristic* fix; this ADR records the
structural one.

Drizzle itself offers no concurrency story here: its own migrator
(`drizzle-orm/pg-core` dialect) applies all pending migrations in one
transaction with no locking, and `drizzle-kit migrate` has the same race. The
single shared runner in `packages/everything-dev/src/db/run-migrations.ts` is
the convergence point all migrators already funnel through (plan 008:
"future migration fixes land in exactly ONE file"), so the fix belongs there.

## Decision

1. **One run, one transaction, one lock.** `runMigrations` executes the entire
   run — advisory lock acquisition, journal schema/table creation, data-schema
   creation, journal read, per-migration DDL, and journal inserts — inside a
   single `db.transaction` whose **first statement** is
   `SELECT pg_advisory_xact_lock(hashtextextended('<journal-schema>.<journal-table>', 0))`.
   Drizzle's `db.transaction` pins one pooled client for the whole callback
   (verified in drizzle-orm 0.45 node-postgres session code), so the lock, the
   journal read, and all writes share one session.
2. **Journal-scoped key, not plugin-scoped.** The key hashes the journal's
   schema+table identity, which is constant across workspaces on one physical
   database — exactly the set of migrators that can collide with each other.
   The auth database is a separate physical database, so its key namespace
   cannot cross-talk.
3. **Xact-scoped, never session-scoped.** `pg_advisory_xact_lock` releases at
   COMMIT/ROLLBACK or on connection death. A crashed or killed migrator can
   never orphan the lock — there is no unlock call to miss and no
   `Effect.acquireRelease` pairing to leak. The database owns the resource
   lifecycle, which is the Effect-idiomatic shape: no new Effect machinery is
   introduced (retries stay `Effect.retry({ while })`).
4. **Blocked losers retry, bounded.** A loser waits on the lock under the
   driver's `lock_timeout` (default 10s, ADR-preserved connection guardrail);
   a timeout surfaces as 55P03 and the whole transaction re-runs via
   `Effect.retry` (`isRetryableMigrationExecutionError`: deadlock 40P01,
   serialization 40001, lock timeout 55P03, connection class). A retried run
   re-reads the journal inside the lock and applies nothing the winner
   committed — read-committed visibility plus the lock make the whole run
   idempotent-by-serialization.
5. **Tolerance is defense-in-depth, not the mechanism.** SAVEPOINT-based
   duplicate-DDL tolerance (including the pg_catalog 23505 collision shape)
   remains for **non-participants** — `drizzle-kit migrate` (`bun db:migrate`)
   and `bos db repair` do not take the lock. Journal-init retry as a separate
   stage is gone (absorbed into the locked transaction); the preflight
   "record as applied" journal write now happens inside the locked
   transaction, fixing the previously weaker out-of-transaction writer.
6. **The pre-migration mirror joins the protocol.**
   `tests/regression/lib/migrate-test-db.mjs` (used by regression global-setup
   ahead of stack boot) takes the same lock inside one explicit transaction.
7. **PGlite needs nothing.** PGlite is single-session and supports
   `pg_advisory_xact_lock` (verified); it can never contend with itself. The
   plan-008 lesson applies: real contention only reproduces on real Postgres,
   which is why the two-concurrent-runners characterization is
   `TEST_DATABASE=postgres`-gated against the committed test databases.

## Consequences

- Every platform-owned migrator (plugin dev servers, host in-process loads,
  `bos start`, regression stacks, vitest suites, the driver's schema
  pre-creation) serializes on the journal. The dev double-boot race, the
  cross-plugin shared-journal race, prod replica/restart overlap, and
  parallel test files are closed by construction.
- Non-participants can still race a locked runner; tolerance catches the
  duplicate-DDL shapes they produce. `bos db repair` deliberately resets the
  journal — it must be run against a stopped stack (pre-existing caveat).
- The deploy-time tier (alchemy `Neon.Branch({ migrations })`, plan 017 D6 /
  wayfinder 13/16/17) remains the recorded future for remote engines; when it
  lands it consumes the same journal, and this runtime lock remains the
  fallback for embedded engines and boot-time apply.
- A blocked boot waits at most ~3 × `lock_timeout` (10s) before failing
  loudly — bounded, observable, no silent wedge.
