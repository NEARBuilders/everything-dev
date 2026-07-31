import type { Migration } from "virtual:drizzle-migrations.sql";
import { sql } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { getMigrationStorage } from "everything-dev/db";
import { describe, expect, it } from "vitest";
import { createDatabaseDriver } from "../../src/db/index";
import { detectDrift, migrate } from "../../src/db/migrate";

const TEST_MIGRATIONS: Migration[] = [
  {
    idx: 0,
    when: 1778470014668,
    tag: "0000_test_init",
    hash: "a".repeat(64),
    sql: [
      'CREATE TABLE "things" ("thing_id" text PRIMARY KEY NOT NULL, "plugin_id" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL)',
    ],
  },
];

async function withDriver(
  url: string,
  schemaName: string | undefined,
  fn: (db: Awaited<ReturnType<typeof createDatabaseDriver>>) => Promise<void>,
) {
  const driver = await createDatabaseDriver(url, schemaName);
  try {
    await fn(driver);
  } finally {
    await driver.close();
  }
}

describe("schema isolation", () => {
  describe("PGlite with schemaName", () => {
    it("creates the plugin schema and sets search_path", async () => {
      await withDriver(":memory:", "plugin_test", async (driver) => {
        const result = await driver.db.execute(sql`SELECT current_schema() as schema`);
        const rows = result as unknown as { rows: { schema: string }[] };
        expect(rows.rows[0]?.schema).toBe("plugin_test");
      });
    });

    it("creates tables in the plugin schema, not public", async () => {
      await withDriver(":memory:", "plugin_test", async (driver) => {
        const storage = getMigrationStorage("test");
        await Effect.runPromise(migrate(driver.db, TEST_MIGRATIONS, storage, "plugin_test"));

        const tablesInPlugin = await driver.db.execute(sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'plugin_test'
        `);
        const pluginRows = tablesInPlugin as unknown as { rows: { table_name: string }[] };
        const pluginTableNames = pluginRows.rows.map((r) => r.table_name);
        expect(pluginTableNames).toContain("things");

        const tablesInPublic = await driver.db.execute(sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
        `);
        const publicRows = tablesInPublic as unknown as { rows: { table_name: string }[] };
        const publicTableNames = publicRows.rows.map((r) => r.table_name);
        expect(publicTableNames).not.toContain("things");
      });
    });

    it("detectDrift finds tables in the plugin schema", async () => {
      await withDriver(":memory:", "plugin_test", async (driver) => {
        const storage = getMigrationStorage("test");
        await (await import("effect")).Effect.runPromise(
          migrate(driver.db, TEST_MIGRATIONS, storage, "plugin_test"),
        );

        const drift = await Effect.runPromise(
          detectDrift(driver.db, TEST_MIGRATIONS, storage, "plugin_test"),
        );
        expect(drift.status).toBe("healthy");
        expect(drift.missingTables).toHaveLength(0);
      });
    });

    it("isolates two plugins with same table name", async () => {
      const driverA = await createDatabaseDriver(":memory:", "plugin_a");
      const driverB = await createDatabaseDriver(":memory:", "plugin_b");
      try {
        const storage = getMigrationStorage("test");

        await Effect.runPromise(migrate(driverA.db, TEST_MIGRATIONS, storage, "plugin_a"));
        await Effect.runPromise(migrate(driverB.db, TEST_MIGRATIONS, storage, "plugin_b"));

        await driverA.db.execute(
          sql`INSERT INTO "things" ("thing_id", "plugin_id") VALUES ('thing-a', 'a')`,
        );
        await driverB.db.execute(
          sql`INSERT INTO "things" ("thing_id", "plugin_id") VALUES ('thing-b', 'b')`,
        );

        const rowsA = await driverA.db.execute(sql`SELECT thing_id FROM "things"`);
        const resultA = rowsA as unknown as { rows: { thing_id: string }[] };
        expect(resultA.rows.map((r) => r.thing_id)).toEqual(["thing-a"]);

        const rowsB = await driverB.db.execute(sql`SELECT thing_id FROM "things"`);
        const resultB = rowsB as unknown as { rows: { thing_id: string }[] };
        expect(resultB.rows.map((r) => r.thing_id)).toEqual(["thing-b"]);
      } finally {
        await driverA.close();
        await driverB.close();
      }
    });
  });

  describe("PGlite without schemaName (backward compat)", () => {
    it("defaults to public schema", async () => {
      await withDriver(":memory:", undefined, async (driver) => {
        const result = await driver.db.execute(sql`SELECT current_schema() as schema`);
        const rows = result as unknown as { rows: { schema: string }[] };
        expect(rows.rows[0]?.schema).toBe("public");
      });
    });

    it("migrations land in public", async () => {
      await withDriver(":memory:", undefined, async (driver) => {
        const storage = getMigrationStorage("test");
        await Effect.runPromise(migrate(driver.db, TEST_MIGRATIONS, storage));

        const tablesInPublic = await driver.db.execute(sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
        `);
        const publicRows = tablesInPublic as unknown as { rows: { table_name: string }[] };
        expect(publicRows.rows.map((r) => r.table_name)).toContain("things");
      });
    });
  });
});
