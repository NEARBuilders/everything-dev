---
"everything-dev": patch
---

Fix the 2.0.0-rc.13 migration runner breaking every boot on workspaces with `ALTER TYPE ... ADD VALUE` migrations: the ADD VALUE pre-hoist ran against all migrations on every boot (42710 on migrated databases, 42704 on fresh ones) and never journaled the hoisted migrations. The runner now applies one committed transaction per migration under the journal-scoped advisory lock — ADD VALUE stays in-transaction (allowed since PG 12), each migration commits before the next runs, so a later migration can safely use a newly added enum value (the original 55P04 "unsafe use of new value" case), and every migration is hash-journaled. Fixes #502.
