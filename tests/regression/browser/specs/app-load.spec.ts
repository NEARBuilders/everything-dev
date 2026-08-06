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

  test("backend assets reachable from browser", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const results = await page.evaluate(async () => {
      const [skill, llms, health] = await Promise.all([
        fetch("/skill.md"),
        fetch("/llms.txt"),
        fetch("/api/_health"),
      ]);
      return {
        skillStatus: skill.status,
        llmsStatus: llms.status,
        healthStatus: health.status,
      };
    });

    expect(results.skillStatus).toBe(200);
    expect(results.llmsStatus).toBe(200);
    expect(results.healthStatus).toBe(200);
    expectNoHydrationFailure(pageErrors);
  });

  test("about page navigates to skill", async ({ page }) => {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const skillLink = page.getByText("Open skill");
    await expect(skillLink).toBeVisible({ timeout: 10000 });
    await skillLink.click();

    await page.waitForURL(/\/skill$/, { timeout: 10000 });
    await expect(page.getByText("raw skill.md")).toBeVisible({ timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });
});
