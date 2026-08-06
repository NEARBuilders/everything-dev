import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("logout", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("sign out redirects to login and session is cleared", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const anonymousBtn = page.getByText("continue anonymously");
    await expect(anonymousBtn).toBeVisible({ timeout: 10000 });
    await anonymousBtn.click();

    await page.waitForURL(/\/home$/, { timeout: 15000 });
    await expect(page.getByText("settings")).toBeVisible({ timeout: 10000 });

    const menuButton = page.locator("button[title='menu']");
    await expect(menuButton).toBeVisible({ timeout: 5000 });
    await menuButton.click();

    const signOutItem = page.getByRole("menuitem", { name: "sign out" });
    await expect(signOutItem).toBeVisible({ timeout: 5000 });
    await signOutItem.click();

    await page.waitForURL(/\/login/, { timeout: 15000 });
    await expect(page.getByText("continue anonymously")).toBeVisible({ timeout: 10000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByText("continue anonymously")).toBeVisible({ timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });
});
