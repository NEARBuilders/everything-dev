import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("logout", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("sign out lands on public page and session is cleared", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const anonymousBtn = page.getByText("continue anonymously");
    await expect(anonymousBtn).toBeVisible({ timeout: 10000 });

    const signInDone = page.waitForResponse(
      (resp) => resp.status() === 200 && resp.url().includes("/api/auth/sign-in/anonymous"),
      { timeout: 15000 },
    );

    await anonymousBtn.click();
    await signInDone;

    await page.waitForURL(/\/dashboard$/, { timeout: 15000 });
    await page.reload();
    await page.waitForURL(/\/dashboard$/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await waitForApp(page);
    await page.locator("button[title='account menu']").click();

    const signOutItem = page.getByRole("menuitem", { name: "sign out" });
    await expect(signOutItem).toBeVisible({ timeout: 5000 });
    await signOutItem.click();

    await page.waitForURL(/\/$/, { timeout: 15000 });
    await expect(page.getByText("Get started")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button[title='account menu']")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByText("Get started")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button[title='account menu']")).toHaveCount(0);

    expectNoHydrationFailure(pageErrors);
  });
});
