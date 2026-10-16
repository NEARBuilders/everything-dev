import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

/**
 * Docs plugin — public read path (gate-free). The docs list and reader are
 * served by the docs plugin's composed routes; content is the repository's
 * own markdown compiled at build time (velite), so the fixture set is
 * deterministic: every doc compiled from docs/** plus the glossary.
 */
test.use({ trace: "on" });

test.describe("Docs", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("docs index lists the repository's docs", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.heading")).toBeVisible({ timeout: 15000 });
    const items = page.getByTestId("docs.item");
    await expect(items.first()).toBeVisible({ timeout: 15000 });
    const count = await items.count();
    expect(count, "the compiled docs tree must surface at least ten docs").toBeGreaterThanOrEqual(
      10,
    );

    expectNoHydrationFailure(pageErrors);
  });

  test("clicking a doc opens the reader with rendered markdown", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const firstItem = page.getByTestId("docs.item").first();
    await expect(firstItem).toBeVisible({ timeout: 15000 });
    await firstItem.click();

    await expect(page).toHaveURL(/\/docs\/.+$/, { timeout: 10000, waitUntil: "commit" });
    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.markdown")).toBeVisible({ timeout: 15000 });

    expectNoHydrationFailure(pageErrors);
  });

  test("an unknown slug renders the not-found state", async ({ page }) => {
    await page.goto("/docs/does-not-exist-anywhere", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.not-found")).toBeVisible({ timeout: 15000 });

    expectNoHydrationFailure(pageErrors);
  });
});
