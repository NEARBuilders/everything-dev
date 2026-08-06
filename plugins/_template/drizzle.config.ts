import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.TEMPLATE_DATABASE_URL || "pglite:.bos/_template/:memory:",
  },
  verbose: true,
  strict: true,
});