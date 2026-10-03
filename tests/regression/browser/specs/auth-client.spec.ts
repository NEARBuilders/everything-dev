import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("authClient", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("login page renders with auth options", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: 10000, waitUntil: "commit" });
    await waitForApp(page);

    await expect(page.getByTestId("login.heading")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("near.signin-button").first()).toBeVisible({
      timeout: 10000,
    });

    expectNoHydrationFailure(pageErrors);
  });
});
