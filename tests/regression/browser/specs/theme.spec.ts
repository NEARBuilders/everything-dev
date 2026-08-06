import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("theme", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("toggles between light and dark theme", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    const themeToggle = page.locator("button[aria-label='Switch to dark theme']").first();
    await expect(themeToggle).toBeVisible({ timeout: 10000 });
    await themeToggle.click();

    await expect(html).toHaveClass(/dark/);

    const lightToggle = page.locator("button[aria-label='Switch to light theme']").first();
    await expect(lightToggle).toBeVisible({ timeout: 5000 });
    await lightToggle.click();

    await expect(html).not.toHaveClass(/dark/);

    expectNoHydrationFailure(pageErrors);
  });

  test("dark theme persists across page reload", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const themeToggle = page.locator("button[aria-label='Switch to dark theme']").first();
    await expect(themeToggle).toBeVisible({ timeout: 10000 });
    await themeToggle.click();

    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);

    const storedTheme = await page.evaluate(() => localStorage.getItem("theme"));
    expect(storedTheme).toBe("dark");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(html).toHaveClass(/dark/);

    const darkToggle = page.locator("button[aria-label='Switch to light theme']").first();
    await expect(darkToggle).toBeVisible({ timeout: 10000 });
    await darkToggle.click();

    await expect(html).not.toHaveClass(/dark/);

    const storedAfterLight = await page.evaluate(() => localStorage.getItem("theme"));
    expect(storedAfterLight).toBe("light");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(html).not.toHaveClass(/dark/);

    expectNoHydrationFailure(pageErrors);
  });
});
