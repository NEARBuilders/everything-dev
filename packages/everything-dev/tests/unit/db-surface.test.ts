import { describe, expect, it } from "vitest";
import {
  type DriftReport,
  detectDrift,
  type LoadedMigrations,
  type LoadMigrationsOptions,
  loadMigrations,
  type Migration,
  type MigrationDatabase,
  type MigrationReport,
  type RunMigrationsOptions,
  runMigrations,
} from "../../src/db/index";

const storage = { schema: "drizzle", table: "__drizzle_migrations", slug: "surface" };

describe("everything-dev/db export surface", () => {
  it("exports the support types its function signatures use", () => {
    const db: MigrationDatabase = {
      execute: async () => ({ rows: [] }),
      transaction: async (fn) => fn({ execute: async () => ({ rows: [] }) }),
    };
    const migrations: Migration[] = [{ idx: 0, when: 0, tag: "0000_init", hash: 0, sql: [] }];
    const loaded: LoadedMigrations = { migrations: [], source: "virtual" };
    const loadOpts: LoadMigrationsOptions = { fromDir: "drizzle" };
    const runOpts: RunMigrationsOptions = { journal: storage, schemaName: "plugin_surface" };
    const report: MigrationReport = { applied: 0, total: 1, storage, schema: "plugin_surface" };
    const drift: DriftReport = {
      status: "healthy",
      expectedTables: [],
      missingTables: [],
      appliedHashes: 0,
      localHashes: 0,
      storage,
    };

    expect(loadOpts.fromDir).toBe("drizzle");
    expect(runOpts.journal).toEqual(storage);
    expect(loaded.source).toBe("virtual");
    expect(report.applied).toBe(0);
    expect(drift.status).toBe("healthy");
    expect(Object.keys(db).sort()).toEqual(["execute", "transaction"]);
    expect(migrations[0]?.tag).toBe("0000_init");
  });

  it("exports the migration runner functions", () => {
    expect(runMigrations).toBeTypeOf("function");
    expect(detectDrift).toBeTypeOf("function");
    expect(loadMigrations).toBeTypeOf("function");
  });
});
