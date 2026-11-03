---
"everything-dev": minor
---

Flatten the db surface: `agent-connect` moves onto the standard `databaseLayer` seam, and `everything-dev/db` becomes a curated, audited interface.

- `plugins/agent-connect`'s hand-rolled db trio (`src/db/index.ts` / `layer.ts` / `migrate.ts`) — a verbatim copy of `databaseLayer`'s boot sequence that was never sync-managed and rotted (its stale comment claimed `bos sync` copied it) — is replaced by the standard 36-line seam every other plugin uses. `DatabaseLive(config)` now takes the initialize input; behavior (namespaced `plugin_<slug>` schema, journal, drift handling) is unchanged.
- `everything-dev/db` drops `export *` (9 modules, ~47 exports) for an explicit curated list: workspace-config resolution (`resolveDatabaseUrl`, `workspaceIdentityFromModuleUrl`, `PGLITE_DEFAULT_URL`), the layer seam (`databaseLayer`, `loadMigrations`, `runMigrations`, `detectDrift`, `DatabaseError`, `LoadedMigrations`, `Migration`, `MigrationStorage`), the test kit (`createDatabaseDriver`, `getMigrationStorage`, `pluginMigrationSlug`, `pluginSchemaName`), and `suppressPgQueryQueueDeprecation` for the host. Removed exports had no external consumers; the superseded `isRetryableMigrationError` is deleted.
- The pglite defaults (`pglite:.bos/db`, `pglite::memory:`) are single-sourced in `packages/everything-dev/src/db/defaults.json` — the framework's own consumers (`binding.ts`, `services/infra.ts`, deploy smoke, regression env) read it instead of repeating literals. Scaffolded plugin defaults and init templates deliberately keep frozen copies: a database location is pinned at init, it must not silently follow a framework upgrade.
