import { defineConfig } from "drizzle-kit";
import { getDatabaseUrlSecretName, SHARED_MIGRATION_STORAGE } from "everything-dev/db";

const slug = "api";
const databaseSecret = getDatabaseUrlSecretName(slug);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env[databaseSecret] ??
      (process.env.NODE_ENV === "production"
        ? (() => {
            throw new Error(
              `Missing ${databaseSecret} — required in production for drizzle-kit operations`,
            );
          })()
        : `pglite:.bos/${slug}/:memory:`),
  },
  migrations: {
    schema: SHARED_MIGRATION_STORAGE.schema,
    table: SHARED_MIGRATION_STORAGE.table,
  },
  verbose: true,
  strict: true,
});
