/**
 * The framework's public database surface — a curated, audited list.
 * Everything else under `src/db/**` is implementation: import submodules
 * directly inside the package and never add re-exports here without an
 * external consumer (this list is what keeps one-off helpers like a
 * credentials adapter from accreting onto the interface).
 *
 * Sections:
 *  - workspace configs — identity + URL resolution for drizzle.config.ts
 *  - layer seam (ADR 0033) — what a workspace's src/db/layer.ts consumes
 *  - test kit — what plugin test helpers use to boot a real database
 *  - host — the pg deprecation filter wired into the host program
 */

// workspace configs
export { PGLITE_DEFAULT_URL, resolveDatabaseUrl } from "./binding";
export type { MigrationStorage } from "./core";
// host
export { getMigrationStorage, pluginMigrationSlug, suppressPgQueryQueueDeprecation } from "./core";
// test kit
export { createDatabaseDriver, pluginSchemaName } from "./driver";
export { DatabaseError } from "./errors";
export type { WorkspaceIdentity } from "./identity";
export {
  workspaceIdentityFromModuleUrl,
  workspaceIdentityFromWorkspaceDir,
} from "./identity";
// layer seam (ADR 0033)
export { databaseLayer } from "./layer";
export type { LoadedMigrations, Migration } from "./run-migrations";
export { detectDrift, loadMigrations, runMigrations } from "./run-migrations";
