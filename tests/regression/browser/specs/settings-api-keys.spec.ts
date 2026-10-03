import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

test.describe("Settings → API Keys", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
    await injectCookies(page);
  });

  test("api keys page loads for authenticated user", async ({ page }) => {
    await page.goto("/settings/api-keys", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page).toHaveURL(/\/settings\/api-keys/, {
      timeout: 10000,
      waitUntil: "commit",
    });
    await expect(page.getByTestId("api-keys.heading")).toBeVisible({
      timeout: 10000,
    });

    expectNoHydrationFailure(pageErrors);
  });

  test("api keys tab visible in settings", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await page.waitForURL(/\/settings/, { timeout: 10000, waitUntil: "commit" });

    const apiKeysTab = page.getByTestId("settings-tab-api-keys");
    await expect(apiKeysTab).toBeVisible({ timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });
});
