import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies, seedRegressionThing } from "../helpers/seeded";

test.describe("apiClient", () => {
  let pageErrors: string[];

  test.beforeAll(async () => {
    await seedRegressionThing();
  });

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
    await injectCookies(page);
  });

  test("things page renders plugin data from apiClient", async ({ page }) => {
    await page.goto("/things", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByText("regression-plugin-test").first()).toBeVisible({
      timeout: 30000,
    });

    expectNoHydrationFailure(pageErrors);
  });

  test("no runtime crash when apiClient is used", async ({ page }) => {
    await page.goto("/things", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByText("regression-plugin-test").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("#root")).toBeAttached();

    expect(pageErrors, "apiClient usage must not produce page errors").toEqual([]);
    expectNoHydrationFailure(pageErrors);
  });
});
