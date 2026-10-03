import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnvFile } from "dotenv";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

if (process.env.TEST_DATABASE === "postgres") {
  const envPath = path.join(workspaceRoot, ".env.test");
  if (existsSync(envPath)) {
    loadEnvFile({ path: envPath, override: true, quiet: true });
  }
} else {
  process.env.API_DATABASE_URL = process.env.API_TEST_DATABASE_URL ?? "pglite::memory:";
}
