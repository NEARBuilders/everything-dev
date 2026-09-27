---
"everything-dev": minor
---

Migrations serialize on a journal-scoped Postgres advisory transaction lock (ADR 0019): the dev double-boot (plugin dev-server + the host's in-process load), parallel test files, and overlapping production replicas converge on the journal instead of colliding in pg_catalog — a blocked migrator waits (bounded by `lock_timeout`) and then applies nothing the winner committed. SAVEPOINT-based duplicate-DDL tolerance stays as defense-in-depth for non-participants (`drizzle-kit`), the journal-init retry stage is absorbed into the locked transaction, and the regression pre-migration mirror takes the same lock. Fixes the flaky dev-stack plugin-boot failure that served stacks without a failed plugin.
