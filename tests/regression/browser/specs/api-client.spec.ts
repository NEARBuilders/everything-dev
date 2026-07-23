import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("apiClient", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("apps page renders with registry data from apiClient", async ({ page }) => {
    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const heading = page.locator("h1");
    await expect(heading).toContainText("Apps", { timeout: 30000 });

    await expect(
      page.getByText("No published apps found.").or(page.locator('[class*="cursor-pointer"]')).first(),
    ).toBeVisible({ timeout: 30000 });

    expectNoHydrationFailure(pageErrors);
  });

  test("no runtime crash when apiClient is used", async ({ page }) => {
    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const heading = page.locator("h1");
    await expect(heading).toContainText("Apps", { timeout: 30000 });

    expectNoHydrationFailure(pageErrors);
  });
});
