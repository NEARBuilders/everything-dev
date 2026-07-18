import { defineConfig } from "drizzle-kit";
import { getDatabaseUrlSecretName, getMigrationStorage } from "everything-dev/db";

const storage = getMigrationStorage(import.meta.dirname);
const databaseSecret = getDatabaseUrlSecretName(storage.slug);

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
        : `pglite:.bos/${storage.slug}/:memory:`),
  },
  migrations: {
    schema: storage.schema,
    table: storage.table,
  },
  verbose: true,
  strict: true,
});
