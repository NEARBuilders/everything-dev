import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectLogoutCookies, loadAdminSeedData } from "../helpers/seeded";

test.describe("logout", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("sign out lands on public page and session is cleared", async ({ page }) => {
    await injectLogoutCookies(page);
    const { logoutName } = loadAdminSeedData();

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await waitForApp(page);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000, waitUntil: "commit" });

    const accountButton = page.getByRole("button", { name: new RegExp(logoutName) }).first();
    await expect(accountButton).toBeVisible({ timeout: 10000 });
    await accountButton.click();

    const signOutItem = page.getByTestId("account.signout-menuitem");
    await expect(signOutItem).toBeVisible({ timeout: 5000 });
    await signOutItem.click();

    await page.waitForURL(/\/$/, { timeout: 15000, waitUntil: "commit" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByRole("button", { name: new RegExp(logoutName) })).toHaveCount(0);

    expectNoHydrationFailure(pageErrors);
  });
});
