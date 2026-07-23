import { defineConfig } from "@playwright/test";

const mode = process.env.REGRESSION_MODE ?? "dev";
const command =
  mode === "prod"
    ? "bun run regression:start:prod"
    : "bun run regression:start:dev";

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
  },
  projects: [
    { name: "dev" },
    { name: "prod" },
  ],
});