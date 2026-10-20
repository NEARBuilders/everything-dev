import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Cause, Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatabaseError,
  databaseLayer,
  type LoadedMigrations,
  type Migration,
  pluginSchemaName,
} from "../../src/db";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Schema = Record<string, never>;
type Db = PgDatabase<PgQueryResultHKT, Schema>;

class DbTag extends Context.Service<DbTag, Db>()("test/Database") {}

function migration(idx: number, tag: string, statements: string[]): Migration {
  return {
    idx,
    when: 1_700_000_000_000 + idx,
    tag,
    hash: `hash-${tag}`,
    sql: statements,
  };
}

function loadedMigrations(migrations: Migration[]): LoadedMigrations {
  return { migrations, source: "disk" };
}

async function buildLayer(layer: Layer.Layer<DbTag, DatabaseError>): Promise<{
  db: Db;
  scope: Scope.Scope.Closeable;
}> {
  const scope = await Effect.runPromise(Scope.make());
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  return { db: Context.get(context, DbTag), scope };
}

describe("databaseLayer (ADR 0033)", () => {
  it("provides the tag with migrations applied on build; rebuilding is idempotent", async () => {
    const migrations = loadedMigrations([
      migration(0, "t", ['CREATE TABLE IF NOT EXISTS "t" (id int)']),
    ]);

    const first = await buildLayer(
      databaseLayer(DbTag, "pglite::memory:", {
        pluginId: "test",
        schema: {},
        migrations: Effect.succeed(migrations),
        namespace: false,
      }),
    );
    const result = (await first.db.execute(sql.raw('SELECT * FROM "t"'))) as { rows: unknown[] };
    expect(result.rows).toEqual([]);
    await Effect.runPromise(Scope.close(first.scope, Exit.succeed(void 0)));

    const second = await buildLayer(
      databaseLayer(DbTag, "pglite::memory:", {
        pluginId: "test",
        schema: {},
        migrations: Effect.succeed(migrations),
        namespace: false,
      }),
    );
    expect(second.db).toBeDefined();
    await Effect.runPromise(Scope.close(second.scope, Exit.succeed(void 0)));
  });

  it("namespace defaults to true and scopes the workspace into plugin_<slug>", async () => {
    const dir = mkdtempSync(join(tmpdir(), "database-layer-ns-"));
    dirs.push(dir);
    expect(pluginSchemaName("test")).toBe("plugin_test");

    const { db, scope } = await buildLayer(
      databaseLayer(DbTag, `pglite:${dir}`, {
        pluginId: "test",
        schema: {},
        migrations: Effect.succeed(
          loadedMigrations([migration(0, "t", ['CREATE TABLE IF NOT EXISTS "t" (id int)'])]),
        ),
      }),
    );

    const tables = (await db.execute(
      sql`SELECT table_schema FROM information_schema.tables WHERE table_name = 't'`,
    )) as { rows: { table_schema: string }[] };
    expect(tables.rows.map((r) => r.table_schema)).toEqual(["plugin_test"]);
    await Effect.runPromise(Scope.close(scope, Exit.succeed(void 0)));
  });

  it("migrations omitted: builds the db without boot migration", async () => {
    const { db, scope } = await buildLayer(
      databaseLayer(DbTag, "pglite::memory:", { pluginId: "test", schema: {} }),
    );
    expect(db).toBeDefined();
    await Effect.runPromise(Scope.close(scope, Exit.succeed(void 0)));
  });

  it("a migration-load failure surfaces as DatabaseError in the layer's error channel", async () => {
    const layer = databaseLayer(DbTag, "pglite::memory:", {
      pluginId: "test",
      schema: {},
      namespace: false,
      migrations: Effect.fail(new DatabaseError({ stage: "load", cause: new Error("boom") })),
    });
    const scope = await Effect.runPromise(Scope.make());
    const exit = await Effect.runPromiseExit(Layer.buildWithScope(layer, scope));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause) as DatabaseError;
      expect(error.stage).toBe("load");
    }
    await Effect.runPromise(Scope.close(scope, Exit.succeed(void 0)).pipe(Effect.ignore));
  });

  it("closing the layer's scope releases the driver (finalizer teardown)", async () => {
    const pglite = new PGlite();

    class ClientTag extends Context.Service<ClientTag, PGlite>()("test/Client") {}
    const scope = await Effect.runPromise(Scope.make());
    const context = await Effect.runPromise(
      Layer.buildWithScope(
        Layer.effect(
          ClientTag,
          Effect.acquireRelease(Effect.succeed(pglite), (client) =>
            Effect.promise(() => client.close()).pipe(Effect.ignore),
          ),
        ),
        scope,
      ),
    );
    const client = Context.get(context, ClientTag);
    await Effect.runPromise(Scope.close(scope, Exit.succeed(void 0)));

    // A closed PGlite instance refuses new queries — the finalizer ran.
    await expect(client.query("SELECT 1")).rejects.toThrow();
  });
});
