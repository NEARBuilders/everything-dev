export interface MigrationStorage {
  schema: string;
  table: string;
  slug: string;
}

const DEFAULT_MIGRATION_JOURNAL = {
  schema: "drizzle",
  table: "__drizzle_migrations",
} as const;

export function normalizeSlug(name: string): string {
  const basename = name.split("/").pop() ?? name;
  return basename
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/-plugin$/i, "")
    .replace(/-/g, "_")
    .toLowerCase();
}

export function pluginMigrationSlug(key: string): string {
  return normalizeSlug(key);
}

export function getMigrationStorage(
  slug?: string,
  options?: { isolated?: boolean },
): MigrationStorage {
  const s = normalizeSlug(slug ?? "unknown");
  const isolated = options?.isolated ?? false;
  if (isolated) {
    return {
      schema: DEFAULT_MIGRATION_JOURNAL.schema,
      table: `__drizzle_migrations_${s}`,
      slug: s,
    };
  }
  return {
    schema: DEFAULT_MIGRATION_JOURNAL.schema,
    table: DEFAULT_MIGRATION_JOURNAL.table,
    slug: s,
  };
}

export function getDatabaseUrlSecretName(slug: string): string {
  return `${slug.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
}

export function pluginSchemaName(pluginId: string): string {
  return `plugin_${pluginMigrationSlug(pluginId)}`;
}
