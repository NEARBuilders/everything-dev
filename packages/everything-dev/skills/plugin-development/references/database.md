# Database Layer Pattern (ADR 0033)

`DatabaseLive` is a Layer built by `databaseLayer` (`everything-dev/db`): it creates the driver with `acquireRelease`, runs migrations on boot (journal-scoped advisory lock), detects drift, and returns the typed `db` on the **plugin-owned tag** — the swap seam. The driver closes when the layer's scope closes. Migrations run **inside** the scoped layer so the pool stays open for the migration queries.

The plugin's whole surface is a ~15-line `src/db/layer.ts`:

```ts
// src/db/layer.ts — scaffolded once, owned by the plugin, free to swap
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Context } from "effect";
import type { Effect } from "effect";
import {
  databaseLayer,
  type DatabaseError,
  type LoadedMigrations,
  loadMigrations as loadSharedMigrations,
} from "everything-dev/db";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DatabaseTag extends Context.Service<DatabaseTag, Database>()("your-plugin/Database") {}

const loadMigrations: Effect.Effect<LoadedMigrations, DatabaseError> = loadSharedMigrations({
  fromDir: import.meta.dirname,
  virtual: () => import("virtual:drizzle-migrations.sql"),
});

export const DatabaseLive = (config: { pluginId: string; secrets: { YOURPLUGIN_DATABASE_URL: string } }) =>
  databaseLayer(DatabaseTag, config.secrets.YOURPLUGIN_DATABASE_URL, {
    pluginId: config.pluginId,
    schema,
    migrations: loadMigrations,
  });
```

`namespace: true` (the default) scopes the plugin into `plugin_<slug>` on the shared database; `namespace: false` keeps the public schema (the api shell) or a dedicated database (auth). `pluginId` arrives on the initialize input — the same id the host uses for secret injection and namespacing.

## Swapping the storage situation

The tag is the seam — the test adapter proves it:

```ts
// unit test: fake db through the same interface
MyServiceLive.pipe(Layer.provide(Layer.succeed(DatabaseTag, fakeDb)))

// different engine/setup: any other Layer for the tag
const MyDatabaseLive = Layer.effect(DatabaseTag, myOwnBackend())
```

## Migration Generation

1. Create `drizzle.config.ts` in your plugin directory
2. Run `drizzle-kit generate` to produce SQL migration files
3. Store migrations in `src/db/migrations/`
4. The workspace-bound `loadMigrations` (above) passes an explicit `storage`/`fromDir` so the journal slug is reliable under rspack/Module Federation bundling (the no-arg fallback reads `npm_package_name`, which is unreliable in bundled remotes).

Migrations run inside `DatabaseLive`'s scoped layer. The critical rule is to **build the DB-backed service via `buildScoped`** so the scope (and the pool) lives for the plugin's lifetime. Do NOT call `DatabaseLive` directly in `initialize` and extract the driver — that creates a transient scope that releases the pool immediately:

```ts
// CORRECT — buildScoped binds the scope to the plugin lifecycle
initialize: (config, _plugins) =>
  Effect.gen(function* () {
    const database = DatabaseLive(config);
    const serviceLayer = MyServiceLive.pipe(Layer.provide(database));
    const myService = yield* buildScoped(MyServiceTag, serviceLayer);

    return { myService };
  }),

// WRONG — transient scope: pool.end() fires immediately, migrations fail
initialize: (config) =>
  Effect.gen(function* () {
    const driver = yield* DatabaseLive(config);
    return { db: driver.db };
  }),
```
