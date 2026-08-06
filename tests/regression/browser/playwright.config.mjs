import { defineConfig } from "@playwright/test";

const mode = process.env.REGRESSION_MODE ?? "dev";
const command = mode === "prod" ? "bun run regression:start:prod" : "bun run regression:start:dev";

export default defineConfig({
  testDir: "./specs",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://localhost:4100",
  },
  webServer: {
    command,
    url: "http://localhost:4100/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      API_DATABASE_URL: "postgres://everythingdev:everythingdev@127.0.0.1:5432/api_db",
      AUTH_DATABASE_URL: "postgres://everythingdev:everythingdev@127.0.0.1:5433/auth_db",
      TEMPLATE_DATABASE_URL: "postgres://everythingdev:everythingdev@127.0.0.1:5434/template_db",
      CORS_ORIGIN: "http://localhost:4100",
      BETTER_AUTH_SECRET: "regression-test-secret-do-not-use-in-production",
      RATE_LIMIT_WINDOW_MS: "1000",
      RATE_LIMIT_MAX: "100",
      BODY_LIMIT_MAX: "65536",
      CI: "true",
    },
  },
  projects: [{ name: "dev" }, { name: "prod" }],
});
