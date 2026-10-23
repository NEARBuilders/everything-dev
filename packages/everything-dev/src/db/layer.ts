import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { type Context, Effect, Layer } from "effect";
import { getMigrationStorage, pluginMigrationSlug } from "./core";
import { createDatabaseDriver, pluginSchemaName } from "./driver";
import { DatabaseError } from "./errors";
import { detectDrift, type LoadedMigrations, runMigrations } from "./run-migrations";

/**
 * The plugin author's whole database surface (ADR 0033): one call that
 * acquires the driver against the plugin's lifecycle scope, applies
 * migrations on boot (journal-scoped advisory lock, ADR 0019), detects
 * drift, and provides the typed drizzle database on the **plugin-owned tag**
 * — the swap seam. A different engine, a different drizzle setup, or a
 * totally different storage situation is the same interface: provide any
 * `Layer` for your own tag and nothing else in the plugin changes.
 *
 * `namespace: true` (the default) scopes the workspace into the
 * `plugin_<slug>` schema on the shared database; `namespace: false` keeps
 * the public topology (the api shell, or a dedicated database like auth's).
 * `migrations` is the workspace-bound loader Effect (`loadMigrations` from
 * this package, instantiated with the workspace's `import.meta.dirname` and
 * its bundle's `virtual:drizzle-migrations.sql` module); omit it to skip
 * boot migration entirely.
 */
export function databaseLayer<Identifier, TSchema extends Record<string, unknown>>(
  tag: Context.Service<Identifier, PgDatabase<PgQueryResultHKT, TSchema>>,
  url: string,
  options: {
    pluginId: string;
    schema: TSchema;
    migrations?: Effect.Effect<LoadedMigrations, DatabaseError>;
    namespace?: boolean;
  },
): Layer.Layer<Identifier, DatabaseError> {
  return Layer.effect(
    tag,
    Effect.gen(function* () {
      const { pluginId, schema, migrations, namespace = true } = options;
      const slug = pluginMigrationSlug(pluginId);
      const schemaName = namespace ? pluginSchemaName(pluginId) : undefined;

      const driver = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => createDatabaseDriver(url, schema, schemaName),
          catch: (cause) => new DatabaseError({ stage: "driver", cause }),
        }),
        (driver) =>
          Effect.tryPromise({
            try: () => driver.close(),
            catch: (cause) => new DatabaseError({ stage: "close", cause }),
          }).pipe(Effect.ignore),
      );

      if (!migrations) {
        return driver.db;
      }

      const storage = getMigrationStorage(slug);
      const { migrations: loaded, source } = yield* migrations;

      if (loaded.length === 0) {
        yield* Effect.logWarning(
          `[Database] No migrations found (source: ${source}) — schema may be missing`,
        );
      } else {
        const report = yield* runMigrations(driver.db, loaded, {
          journal: storage,
          schemaName,
        });
        const applied = report.applied;

        if (applied === 0) {
          yield* Effect.logInfo(
            `[Database] Schema up to date (0 migrations needed, source: ${source})`,
          );
        } else {
          yield* Effect.logInfo(
            `[Database] Applied ${applied}/${loaded.length} migration(s) (source: ${source}, journal: ${storage.schema}.${storage.table}, schema: ${schemaName ?? "public"})`,
          );
        }

        const drift = yield* detectDrift(driver.db, loaded, storage, schemaName);
        if (drift.status === "healthy" || drift.status === "untracked-existing-schema") {
          yield* Effect.logInfo(`[Database] Ready`);
        } else if (drift.status === "drift-safe-repair") {
          yield* Effect.logWarning(
            `[Database] ⚠️ Migration drift detected: ${drift.missingTables.length} expected table(s) missing: ${drift.missingTables.join(", ")}`,
          );
          yield* Effect.logWarning(
            `[Database] Run \`bos db doctor ${storage.slug}\` to diagnose and \`bos db repair ${storage.slug}\` to fix.`,
          );
          return yield* new DatabaseError({
            stage: "migration",
            migrationTag: "drift-safe-repair",
            cause: new Error(
              `Migration journal has ${drift.appliedHashes} applied hashes but all ${drift.expectedTables.length} expected table(s) are missing. ` +
                `Run \`bos db repair ${storage.slug}\` to reset the migration history and reapply migrations. ` +
                `Missing tables: ${drift.missingTables.join(", ")}`,
            ),
          });
        }
        if (drift.status === "drift-manual") {
          yield* Effect.logWarning(
            `[Database] ⚠️ Partial migration drift detected: ${drift.missingTables.length}/${drift.expectedTables.length} expected table(s) missing.`,
          );
          return yield* new DatabaseError({
            stage: "migration",
            migrationTag: "drift-manual",
            cause: new Error(
              `Partial schema drift — ${drift.missingTables.length}/${drift.expectedTables.length} expected table(s) are missing. ` +
                `Run \`bos db doctor ${storage.slug}\` for details. Manual intervention required. ` +
                `Missing tables: ${drift.missingTables.join(", ")}`,
            ),
          });
        }
      }

      return driver.db;
    }),
  );
}
