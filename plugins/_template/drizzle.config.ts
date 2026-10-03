import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl, workspaceIdentityFromModuleUrl } from "everything-dev/db";

const identity = workspaceIdentityFromModuleUrl(import.meta.url);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(identity),
  },
  migrations: {
    schema: identity.journal.schema,
    table: identity.journal.table,
  },
  verbose: true,
  strict: true,
});
