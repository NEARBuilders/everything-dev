import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

test.describe("Error boundary", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("UI survives an injected 500 API response without an uncaught error", async ({ page }) => {
    await injectCookies(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    void page.route("**/api/rpc/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      }),
    );

    await page.getByTestId("sidebar-nav-my-node").click();
    await page.waitForTimeout(2500);

    await expect(page.locator("#root")).toBeAttached({ timeout: 15000 });

    expect(pageErrors, "an injected 500 must not produce an uncaught page error").toEqual([]);
    expectNoHydrationFailure(pageErrors);
  });
});
