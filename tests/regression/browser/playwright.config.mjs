import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { computeRegressionEnv } from "../lib/regression-env.mjs";

const stallWatchdog = fileURLToPath(new URL("./helpers/stall-watchdog.mjs", import.meta.url));
const mode = process.env.REGRESSION_MODE ?? "dev:ssr";
const command = `bun run regression:${mode}`;

const regressionEnv = computeRegressionEnv();

const derivedEnv = {
  ...regressionEnv.dbUrls,
  CORS_ORIGIN: regressionEnv.baseUrl,
  BETTER_AUTH_SECRET: regressionEnv.authSecret,
  RATE_LIMIT_WINDOW_MS: "1000",
  RATE_LIMIT_MAX: "100",
  BODY_LIMIT_MAX: "65536",
  CI: "true",
};

const webServerEnv = Object.fromEntries(
  Object.entries(derivedEnv).filter(([key]) => process.env[key] === undefined),
);

export default defineConfig({
  testDir: "./specs",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  // Retries off: a degradation wedge showed up as a cluster of flaky-then-
  // passed pairs that doubled the wall time behind a starving fixture (ADR 0009).
  retries: 0,
  reporter: [["list"], [stallWatchdog]],
  globalSetup: "./helpers/global-setup.ts",
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: regressionEnv.baseUrl,
    trace: "retain-on-failure",
  },
  webServer: {
    command,
    url: `${regressionEnv.baseUrl}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: webServerEnv,
  },
  projects: [
    {
      // Start-command stacks (ADR 0009) run the FULL suite: the artifacts the
      // branch builds are what CI validates.
      name: "start:ssr",
    },
    {
      // The csr stack cannot render SSR assertions (no ssr URL — the CSR
      // shell has no server-rendered content), so it runs only the
      // variant-sensitive specs; the variant-blind majority is identical on
      // start:ssr and gains nothing from a second run.
      name: "start:csr",
      testMatch: [
        "specs/csr-compose.spec.ts",
        "specs/auth-redirect.spec.ts",
        "specs/app-load.spec.ts",
      ],
    },
    {
      // The dev server is smoke-only — boot + one page per render mode + the
      // redirect spec. Its resource profile must never stall CI again.
      name: "dev:ssr",
      testMatch: ["specs/csr-compose.spec.ts", "specs/auth-redirect.spec.ts"],
    },
    {
      name: "dev:csr",
      testMatch: ["specs/csr-compose.spec.ts", "specs/auth-redirect.spec.ts"],
    },
    { name: "backcompat" },
  ],
});
