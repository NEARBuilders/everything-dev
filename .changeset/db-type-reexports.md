---
"everything-dev": patch
---

Export the db support types the migration-runner signatures reference — `DriftReport`, `MigrationReport`, `MigrationDatabase`, `RunMigrationsOptions`, `LoadMigrationsOptions` are now re-exported from `everything-dev/db` alongside the functions that consume them, so external consumers (the sync-owned plugin `src/db/layer.ts` template and any child workspace calling `runMigrations`/`detectDrift` directly) typecheck without local structural copies.

Fixes #789.
