import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("apiClient", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("apps page renders with registry data from apiClient", async ({ page }) => {
    const responses: string[] = [];

    page.on("response", (response) => {
      const url = response.url();
      if (response.status() === 200) {
        if (url.includes("/api/v1/registry/status") || url.includes("/api/v1/registry/apps")) {
          responses.push(url);
        }
      }
    });

    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const heading = page.locator("h1");
    await expect(heading).toContainText("Apps", { timeout: 30000 });

    expect(responses.length).toBeGreaterThanOrEqual(1);
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
