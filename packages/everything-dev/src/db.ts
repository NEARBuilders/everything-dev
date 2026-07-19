import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface MigrationStorage {
  schema: string;
  table: string;
  slug: string;
}

function normalizeSlug(name: string): string {
  const basename = name.split("/").pop() ?? name;
  return basename
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/-plugin$/i, "")
    .replace(/-/g, "_")
    .toLowerCase();
}

export function getMigrationSlug(dir?: string): string {
  if (!dir) return normalizeSlug(process.env.npm_package_name ?? "unknown");
  let current = dir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
        return normalizeSlug(pkg.name ?? current);
      } catch {
        return normalizeSlug(current);
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return normalizeSlug(dir ?? "unknown");
}

/**
 * The canonical shared migration journal used by all DB-enabled plugins in
 * Phase 1.  Every plugin reads and writes the same `drizzle.__drizzle_migrations`
 * table.  Per-plugin journal isolation is deferred to Phase 2.
 */
export const SHARED_MIGRATION_STORAGE: MigrationStorage = {
  schema: "drizzle",
  table: "__drizzle_migrations",
  slug: "__drizzle_migrations",
};

export function getMigrationStorage(dir?: string): MigrationStorage {
  return {
    schema: "drizzle",
    table: `__drizzle_migrations_${getMigrationSlug(dir)}`,
    slug: getMigrationSlug(dir),
  };
}

export function getLegacyCandidates(): { schema: string; table: string }[] {
  return [{ schema: "drizzle", table: "__drizzle_migrations" }];
}

/**
 * Format a JavaScript string array as a PostgreSQL text array literal for use
 * with Drizzle's `sql` tag. Example return:
 *   `'{"h1","h2"}'::text[]`
 *
 * Usage: sql`WHERE col = ANY(${toSqlArray(values)})`
 *
 * Drizzle's default parameter binding does not handle array types correctly
 * with the pg driver (it emits `ANY(($1))` with a single string, which
 * Postgres rejects as a malformed array literal).
 */
export function toSqlArray(arr: string[]): string {
  if (arr.length === 0) return `'{}'::text[]`;
  const escaped = arr.map((v) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
  return `'{${escaped.map((v) => `"${v}"`).join(",")}}'::text[]`;
}

export function migrateSql(storage: MigrationStorage): MigrationStorage & { qualified: string } {
  return { ...storage, qualified: `"${storage.schema}"."${storage.table}"` };
}

export function pluginMigrationSlug(key: string): string {
  return normalizeSlug(key);
}

export function getDatabaseUrlSecretName(slug: string): string {
  return `${slug.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
}

export function extractExpectedTables(migrations: { sql: string[] }[]): string[] {
  const tables = new Set<string>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"\.)?"([^"]+)"/gi;
  for (const migration of migrations) {
    for (const stmt of migration.sql) {
      for (const match of stmt.matchAll(re)) {
        const tableName = match[2];
        if (tableName) {
          tables.add(tableName);
        }
      }
    }
  }
  return [...tables];
}
