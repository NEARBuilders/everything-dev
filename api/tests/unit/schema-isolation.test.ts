import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { getMigrationStorage } from "everything-dev/db";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseDriver, type Database } from "@/db/index";
import { detectDrift, loadMigrations, migrate } from "@/db/migrate";

let activeDirs: string[] = [];

afterEach(() => {
  for (const dir of activeDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  activeDirs = [];
});

function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  activeDirs.push(dir);
  return dir;
}

async function withDriver(
  url: string,
  schemaName: string | undefined,
  fn: (db: Database) => Promise<void>,
): Promise<void> {
  const driver = await createDatabaseDriver(url, schemaName);
  try {
    await fn(driver.db);
  } finally {
    await driver.close();
  }
}

describe("schema isolation", () => {
  it("current_schema() returns plugin schema after init", async () => {
    const dir = freshDir("schema-iso-1-");
    await withDriver(`pglite:${dir}`, "plugin_api", async (db) => {
      const result = await db.execute(sql`SELECT current_schema() as schema`);
      const row = (result as any).rows?.[0] ?? (result as any)[0];
      expect(row.schema).toBe("plugin_api");
    });
  });

  it("tables land in plugin schema, not public", async () => {
    const dir = freshDir("schema-iso-2-");
    await withDriver(`pglite:${dir}`, "plugin_api", async (db) => {
      const storage = getMigrationStorage("api");
      const { migrations } = await Effect.runPromise(loadMigrations());
      await Effect.runPromise(migrate(db, migrations, storage, "plugin_api"));

      const publicResult = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants'
      `);
      const publicRows = (publicResult as any).rows ?? (publicResult as any);
      expect(publicRows.length).toBe(0);

      const pluginResult = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'plugin_api' AND table_name = 'tenants'
      `);
      const pluginRows = (pluginResult as any).rows ?? (pluginResult as any);
      expect(pluginRows.length).toBe(1);
    });
  });

  it("detectDrift finds tables in plugin schema", async () => {
    const dir = freshDir("schema-iso-3-");
    await withDriver(`pglite:${dir}`, "plugin_api", async (db) => {
      const storage = getMigrationStorage("api");
      const { migrations } = await Effect.runPromise(loadMigrations());
      await Effect.runPromise(migrate(db, migrations, storage, "plugin_api"));

      const drift = await Effect.runPromise(detectDrift(db, migrations, storage, "plugin_api"));
      expect(drift.status).toBe("healthy");
      expect(drift.missingTables).toEqual([]);
    });
  });

  it("two plugins with same table name are isolated", async () => {
    const dirA = freshDir("schema-iso-4a-");
    const dirB = freshDir("schema-iso-4b-");
    const storage = getMigrationStorage("api");
    const { migrations } = await Effect.runPromise(loadMigrations());

    await withDriver(`pglite:${dirA}`, "plugin_api", async (dbA) => {
      await Effect.runPromise(migrate(dbA, migrations, storage, "plugin_api"));
      await dbA.execute(
        sql`INSERT INTO "tenants" ("account_id", "name") VALUES ('from-api', 'API Tenant')`,
      );
    });

    await withDriver(`pglite:${dirB}`, "plugin_template", async (dbB) => {
      await Effect.runPromise(migrate(dbB, migrations, storage, "plugin_template"));
      const result = await dbB.execute(sql`SELECT * FROM "tenants"`);
      const rows = (result as any).rows ?? (result as any);
      expect(rows.length).toBe(0);
    });
  });

  it("backward compat: no schemaName defaults to public", async () => {
    const dir = freshDir("schema-iso-5-");
    await withDriver(`pglite:${dir}`, undefined, async (db) => {
      const result = await db.execute(sql`SELECT current_schema() as schema`);
      const row = (result as any).rows?.[0] ?? (result as any)[0];
      expect(row.schema).toBe("public");
    });
  });

  it("isDuplicateObjectError: migration with pre-existing types does not crash", async () => {
    const dir = freshDir("schema-iso-6-");
    const storage = getMigrationStorage("api");
    const { migrations } = await Effect.runPromise(loadMigrations());

    await withDriver(`pglite:${dir}`, "plugin_api", async (db) => {
      await Effect.runPromise(migrate(db, migrations, storage, "plugin_api"));

      const journalRef = sql.raw(`"${storage.schema}"."${storage.table}"`);
      await db.execute(sql`DELETE FROM ${journalRef}`);

      await expect(Effect.runPromise(migrate(db, migrations, storage, "plugin_api"))).resolves.toBe(
        migrations.length,
      );
    });
  });
});
