import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { computeRegressionEnv } from "../lib/regression-env.mjs";

const stallWatchdog = fileURLToPath(new URL("./helpers/stall-watchdog.mjs", import.meta.url));
const mode = process.env.REGRESSION_MODE ?? "dev:ssr";
const command = `pnpm run regression:${mode}`;

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
  // One retry per failed test. Retries were zeroed when a degradation wedge
  // behind a starving fixture showed up as flaky-then-passed clusters that
  // doubled wall time (ADR 0009); that fixture's resource profile is fixed.
  // With ~10 parallel CI jobs sharing the runner, a single slow SSR compose
  // (e.g. theme.spec reload timing out in waitForApp) still turns a green
  // run red — one bounded retry is cheaper than a full CI re-run.
  retries: 1,
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
    // The ensure command is reconcile-first: a same-stamp healthy stack is
    // reused, anything else is reaped and rebuilt. Probing this URL before
    // the command runs cannot see a stale stack — the
    // test:regression:browser:start:* scripts run `cleanup` before Playwright
    // starts, so the only thing the probe can ever find is this run's stack.
    reuseExistingServer: true,
    // The pnpm-based image build + container boot outgrew the bun-era 2m
    // budget; 5m keeps headroom (an early exit still fails the webServer).
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: webServerEnv,
  },
  // start:* runs leave the stack down: the fixture container is removed
  // after every suite (dev modes no-op — they own no containers).
  globalTeardown: "./helpers/stack-teardown.mjs",
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
