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

export function getMigrationStorage(dir?: string): MigrationStorage {
  return {
    schema: "drizzle",
    table: `__drizzle_migrations_${getMigrationSlug(dir)}`,
    slug: getMigrationSlug(dir),
  };
}

export function getLegacyCandidates(): { schema: string; table: string }[] {
  return [
    { schema: "drizzle", table: "__drizzle_migrations" },
    { schema: "public", table: "drizzle_migrations" },
  ];
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
