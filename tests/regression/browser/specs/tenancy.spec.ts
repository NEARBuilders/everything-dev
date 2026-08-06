import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies, loadSeedData } from "../helpers/seeded";

test.describe("tenancy", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
    await injectCookies(page);
  });

  test("renders seeded tenant detail page", async ({ page }) => {
    const { tenantID, subdomain } = loadSeedData();

    await page.goto(`/tenant/${tenantID}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await waitForApp(page);

    await expect(page.locator("h1")).toContainText("Regression Tenant", { timeout: 10000 });

    await expect(page.getByText("regression-tenant-", { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });

    expectNoHydrationFailure(pageErrors);
  });
});
