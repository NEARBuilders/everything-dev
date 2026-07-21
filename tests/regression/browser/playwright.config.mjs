import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:4100",
  },
  projects: [
    {
      name: "dev",
      webServer: {
        command: "bun run regression:start:dev",
        url: "http://127.0.0.1:4100/health",
        reuseExistingServer: !process.env.CI,
      },
    },
    {
      name: "prod",
      webServer: {
        command: "bun run regression:start:prod",
        url: "http://127.0.0.1:4100/health",
        reuseExistingServer: !process.env.CI,
      },
    },
  ],
});
