import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

const LIVE_ROOT_NAMESPACE = { account: "dev.everything.near", gateway: "everything.dev" };

/** A disposable namespace the runtime's rollback key may sign for — the owner
 * configures `hosting.rollback` + `ROLLBACK_PRIVATE_KEY` on the stack and
 * points this spec at it; unset (CI default) skips the end-to-end leg. */
const ROLLBACK_NAMESPACE = {
  account: process.env.ROLLBACK_SPEC_ACCOUNT,
  gateway: process.env.ROLLBACK_SPEC_GATEWAY,
};

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

  test("loading the live root namespace renders a deploy row", async ({ page }) => {
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

    expectNoHydrationFailure(pageErrors);
  });

  test("own-namespace rows offer rollback and surface the outcome", async ({ page }) => {
    await page.goto("/deploys", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("deploys.heading")).toBeVisible({ timeout: 10000 });

    const firstRow = page.getByTestId("deploys-row-0");
    await expect(firstRow).toBeVisible({ timeout: 30000 });

    const rollbackButton = firstRow.getByTestId("deploys-rollback-0");
    await expect(rollbackButton).toBeVisible();
    await rollbackButton.click();

    const confirm = page.getByTestId("confirm-dialog-confirm");
    await expect(confirm).toBeVisible();
    await confirm.click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 30000 });
    await expect(toast).toContainText(/rolled back|refus|not configured|signing key/i, {
      timeout: 15000,
    });

    expectNoHydrationFailure(pageErrors);
  });

  test("publish v2 → roll back → the config pointer shows rolledBackFrom", async ({ page }) => {
    test.skip(
      !ROLLBACK_NAMESPACE.account || !ROLLBACK_NAMESPACE.gateway,
      "owner step: set ROLLBACK_SPEC_ACCOUNT/GATEWAY to a disposable namespace the stack's rollback key signs for, with two publishes behind it",
    );
    if (!ROLLBACK_NAMESPACE.account || !ROLLBACK_NAMESPACE.gateway) return;

    await page.goto("/deploys", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("deploys.heading")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("deploys-account-input").fill(ROLLBACK_NAMESPACE.account);
    await page.getByTestId("deploys-gateway-input").fill(ROLLBACK_NAMESPACE.gateway);
    await page.getByTestId("deploys-namespace-apply").click();

    await page.waitForURL(/account=/, { timeout: 10000, waitUntil: "commit" });

    const firstRow = page.getByTestId("deploys-row-0");
    await expect(firstRow).toBeVisible({ timeout: 30000 });

    await firstRow.getByTestId("deploys-rollback-0").click();
    await page.getByTestId("confirm-dialog-confirm").click();

    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 30000 });
    await expect(toast).toContainText(/Rolled back to the snapshot/i, { timeout: 15000 });

    const rolledBackBadge = page.getByTestId("deploys-rolled-back-0");
    await expect(rolledBackBadge).toBeVisible({ timeout: 30000 });
    await expect(rolledBackBadge).toContainText(/rolled back from/);

    expectNoHydrationFailure(pageErrors);
  });
});
