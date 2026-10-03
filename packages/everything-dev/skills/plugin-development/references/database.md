# Database Layer Pattern

`DatabaseLive` is a `Layer.scoped` that creates the driver, runs migrations, and returns the `db`. The `acquireRelease` ensures `driver.close()` runs when the scope is released. Migrations run **inside** the scoped layer so the pool stays open for the migration queries:

```ts
// src/db/layer.ts
import { PluginIdTag } from "every-plugin";
import { Context, Effect, Layer } from "effect";
import { getMigrationStorage, pluginMigrationSlug } from "everything-dev/db";
import { createDatabaseDriver, type Database, DatabaseError } from "./index";
import { detectDrift, loadMigrations, migrate } from "./migrate";

export class DatabaseTag extends Context.Tag("Database")<Database, Database>() {}

export const DatabaseLive = (url: string) =>
  Layer.scoped(
    DatabaseTag,
    Effect.gen(function* () {
      const pluginId = yield* PluginIdTag;
      const slug = pluginMigrationSlug(pluginId);
      const schemaName = `plugin_${slug}`;

      const driver = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => createDatabaseDriver(url, schemaName),
          catch: (cause) => new DatabaseError({ stage: "driver", cause }),
        }),
        (driver) =>
          Effect.tryPromise({
            try: () => driver.close(),
            catch: (cause) => new DatabaseError({ stage: "close", cause }),
          }).pipe(Effect.ignore),
      );

      const storage = getMigrationStorage(slug);
      const { migrations, source } = yield* loadMigrations();

      if (migrations.length > 0) {
        const applied = yield* migrate(driver.db, migrations, storage, schemaName);
        yield* Effect.logInfo(
          `[Database] Applied ${applied}/${migrations.length} migration(s) (source: ${source})`,
        );
        const drift = yield* detectDrift(driver.db, migrations, storage, schemaName);
        if (drift.status === "healthy" || drift.status === "untracked-existing-schema") {
          yield* Effect.logInfo(`[Database] Ready`);
        }
      }

      return driver.db;
    }),
  );
```

## Migration Generation

1. Create `drizzle.config.ts` in your plugin directory
2. Run `drizzle-kit generate` to produce SQL migration files
3. Store migrations in `src/db/migrations/`
4. Pass an explicit `storage` resolved from the workspace so the journal slug is reliable
   under rspack/Module Federation bundling (the no-arg fallback reads
   `npm_package_name`, which is unreliable in bundled remotes).

Migrations run inside `DatabaseLive`'s scoped layer. The critical rule is to **build the DB-backed service via `buildScoped`** so the scope (and the pool) lives for the plugin's lifetime. Do NOT call `DatabaseLive` directly in `initialize` and extract the driver — that creates a transient scope that releases the pool immediately:

```ts
// CORRECT — buildScoped binds the scope to the plugin lifecycle
initialize: (config, _plugins) =>
  Effect.gen(function* () {
    const database = DatabaseLive(config.secrets.DATABASE_URL);
    const serviceLayer = MyServiceLive.pipe(Layer.provide(database));
    const myService = yield* buildScoped(MyServiceTag, serviceLayer);

    return { myService };
  }),

// WRONG — transient scope: pool.end() fires immediately, migrations fail
initialize: (config) =>
  Effect.gen(function* () {
    const driver = yield* DatabaseLive(config.secrets.DATABASE_URL);
    return { db: driver.db };
  }),
```
