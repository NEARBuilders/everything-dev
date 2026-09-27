import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("not found", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("unknown URL renders the 404 fallback with a working back-home link", async ({ page }) => {
    await page.goto("/definitely-not-a-real-page/inner", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("document-fallback")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page.getByText("Page not found")).toBeVisible();

    const homeLink = page.getByTestId("fallback-home");
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", "/");
    await homeLink.click();

    await expect(page).toHaveURL(/\/(\?.*)?$/, { timeout: 10000, waitUntil: "commit" });

    expectNoHydrationFailure(pageErrors);
  });
});
