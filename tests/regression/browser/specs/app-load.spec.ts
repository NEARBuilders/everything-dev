import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("App load", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("page loads without hydration failure", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    expectNoHydrationFailure(pageErrors);
  });

  test("window.__RUNTIME_CONFIG__ has correct shape", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const config = await page.evaluate(() => window.__RUNTIME_CONFIG__);
    expect(config).toBeTruthy();
    expect(config.apiBase).toBe("/api");
    expect(config.rpcBase).toBe("/api/rpc");
    expect(config.assetsUrl).toBeTruthy();
    expect(config.hostUrl).toBeTruthy();
  });

  test("about page navigates to skill", async ({ page }) => {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.waitForLoadState("networkidle");

    const skillLink = page.getByTestId("about.open-skill-link");
    await expect(skillLink).toBeVisible({ timeout: 10000 });
    await skillLink.click();

    await expect(page).toHaveURL(/\/skill$/, { timeout: 10000, waitUntil: "commit" });
    await expect(page.getByTestId("skill.raw-link")).toBeVisible({ timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });
});
