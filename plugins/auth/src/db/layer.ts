/**
 * The plugin's database seam (ADR 0033) — scaffolded once, owned by this
 * plugin, free to swap. The framework default (drizzle + Postgres/PGlite,
 * migrate-on-boot with the journal-scoped advisory lock, drift detection)
 * comes from `databaseLayer` in `everything-dev/db`; a different storage
 * situation is any other `Layer` provided for `DatabaseTag`.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Effect } from "effect";
import { Context } from "effect";
import {
  type DatabaseError,
  databaseLayer,
  type LoadedMigrations,
  loadMigrations as loadSharedMigrations,
} from "everything-dev/db";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DatabaseTag extends Context.Service<DatabaseTag, Database>()("auth/Database") {}

const loadMigrations: Effect.Effect<LoadedMigrations, DatabaseError> = loadSharedMigrations({
  fromDir: import.meta.dirname,
  virtual: () => import("virtual:drizzle-migrations.sql"),
});

export const DatabaseLive = (config: {
  pluginId: string;
  secrets: { AUTH_DATABASE_URL: string };
}) =>
  databaseLayer(DatabaseTag, config.secrets.AUTH_DATABASE_URL, {
    pluginId: config.pluginId,
    schema,
    migrations: loadMigrations,
    namespace: false,
  });
