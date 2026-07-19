import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractExpectedTables,
  getDatabaseUrlSecretName,
  getMigrationSlug,
  getMigrationStorage,
  pluginMigrationSlug,
  toSqlArray,
} from "../../src/db";

describe("getMigrationSlug", () => {
  it("falls back to npm_package_name when no dir given", () => {
    const prev = process.env.npm_package_name;
    process.env.npm_package_name = "@everything-dev/test-plugin";
    try {
      expect(getMigrationSlug()).toBe("test");
    } finally {
      process.env.npm_package_name = prev;
    }
  });

  it("derives from a workspace directory's package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "everything-dev-db-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "@everything-dev/foo-plugin" })}\n`,
      );
      expect(getMigrationSlug(dir)).toBe("foo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getMigrationStorage", () => {
  it("returns the shared journal coords with the caller's slug (phase 1)", () => {
    const storage = getMigrationStorage("api");
    expect(storage.schema).toBe("drizzle");
    expect(storage.table).toBe("__drizzle_migrations");
    expect(storage.slug).toBe("api");
  });

  it("defaults slug to getMigrationSlug() when none provided", () => {
    const prev = process.env.npm_package_name;
    process.env.npm_package_name = "api";
    try {
      const storage = getMigrationStorage();
      expect(storage.slug).toBe("api");
      expect(storage.table).toBe("__drizzle_migrations");
    } finally {
      process.env.npm_package_name = prev;
    }
  });

  it("normalizes a raw plugin key without pre-normalization", () => {
    const storage = getMigrationStorage("@everything-dev/foo-plugin");
    expect(storage.slug).toBe("foo");
    expect(storage.table).toBe("__drizzle_migrations");
  });
});

describe("getMigrationStorage (isolated)", () => {
  it("returns the per-plugin journal table when isolated: true", () => {
    const storage = getMigrationStorage("api", { isolated: true });
    expect(storage.schema).toBe("drizzle");
    expect(storage.table).toBe("__drizzle_migrations_api");
    expect(storage.slug).toBe("api");
  });

  it("normalizes a raw plugin key and applies it to the isolated table name", () => {
    const storage = getMigrationStorage("@everything-dev/foo-plugin", { isolated: true });
    expect(storage.slug).toBe("foo");
    expect(storage.table).toBe("__drizzle_migrations_foo");
  });

  it("isolated: false explicitly selects the shared journal", () => {
    const storage = getMigrationStorage("api", { isolated: false });
    expect(storage.table).toBe("__drizzle_migrations");
  });
});

describe("toSqlArray", () => {
  it("formats a string array as PostgreSQL text array literal", () => {
    const result = toSqlArray(["abc", "def"]);
    expect(result).toBe('\'{"abc","def"}\'::text[]');
  });

  it("escapes double quotes in values", () => {
    const result = toSqlArray(['has"h']);
    expect(result).toBe('\'{"has\\"h"}\'::text[]');
  });

  it("returns empty array literal for empty input", () => {
    const result = toSqlArray([]);
    expect(result).toBe("'{}'::text[]");
  });
});

describe("extractExpectedTables", () => {
  it("extracts unqualified table names", () => {
    expect(
      extractExpectedTables([{ sql: ['CREATE TABLE IF NOT EXISTS "builders" (...)'] }]),
    ).toEqual(["builders"]);
  });

  it("extracts schema-qualified table names", () => {
    expect(extractExpectedTables([{ sql: ['CREATE TABLE "public"."things" (...)'] }])).toEqual([
      "things",
    ]);
  });

  it("returns empty array when no CREATE TABLE", () => {
    expect(extractExpectedTables([{ sql: ["CREATE INDEX idx ON t (c)"] }])).toEqual([]);
  });
});

describe("pluginMigrationSlug", () => {
  it("normalizes plugin keys", () => {
    expect(pluginMigrationSlug("@everything-dev/builders-plugin")).toBe("builders");
    expect(pluginMigrationSlug("api")).toBe("api");
    expect(pluginMigrationSlug("my-app")).toBe("my_app");
  });
});

describe("getDatabaseUrlSecretName", () => {
  it("returns correct secret names", () => {
    expect(getDatabaseUrlSecretName("builders")).toBe("BUILDERS_DATABASE_URL");
    expect(getDatabaseUrlSecretName("api")).toBe("API_DATABASE_URL");
    expect(getDatabaseUrlSecretName("my_plugin")).toBe("MY_PLUGIN_DATABASE_URL");
  });
});
