import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

const LIVE_ROOT_NAMESPACE = { account: "dev.everything.near", gateway: "everything.dev" };

test.describe("Deploys", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
    await injectCookies(page);
  });

  test("deploys page loads for authenticated user", async ({ page }) => {
    await page.goto("/deploys", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page).toHaveURL(/\/deploys/, {
      timeout: 10000,
      waitUntil: "commit",
    });
    await expect(page.getByTestId("deploys.heading")).toBeVisible({
      timeout: 10000,
    });

    expectNoHydrationFailure(pageErrors);
  });

  test("loading the live root namespace renders a deploy row", async ({ page }, testInfo) => {
    const traceDir = join(testInfo.outputDir, "traces");
    mkdirSync(traceDir, { recursive: true });
    await page.context().tracing.start({ screenshots: true, snapshots: true });

    await page.goto("/deploys", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("deploys.heading")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("deploys-account-input").fill(LIVE_ROOT_NAMESPACE.account);
    await page.getByTestId("deploys-gateway-input").fill(LIVE_ROOT_NAMESPACE.gateway);
    await page.getByTestId("deploys-namespace-apply").click();

    await page.waitForURL(/account=dev\.everything\.near/, {
      timeout: 10000,
      waitUntil: "commit",
    });

    const firstRow = page.getByTestId("deploys-row-0");
    await expect(firstRow).toBeVisible({ timeout: 30000 });
    await expect(firstRow.getByTestId("deploys-pointer-digest-0")).toContainText(/[0-9a-f]/);
    await expect(page.getByTestId("deploys-image-0")).toContainText(
      "ghcr.io/nearbuilders/everything-dev",
    );

    await page.context().tracing.stop({
      path: join(traceDir, "deploys-live-namespace.trace.zip"),
    });

    expectNoHydrationFailure(pageErrors);
  });
});
