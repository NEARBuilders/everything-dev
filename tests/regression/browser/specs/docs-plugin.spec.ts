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

  test("search narrows the catalog count", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const count = page.getByTestId("docs.count");
    await expect(count).toHaveText(/\d+ \/ \d+ docs/, { timeout: 15000 });
    const total = await count.innerText();

    await page.getByTestId("docs.search").fill("ADR 0001");
    await expect(page.getByTestId("docs.item")).toHaveCount(1, { timeout: 15000 });
    await expect(count).not.toHaveText(total);
  });

  test("the reader shows prev/next navigation", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await page.getByTestId("docs.item").first().click();
    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });

    const readerNav = page.getByTestId("docs.reader-nav");
    await expect(readerNav).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.next")).toBeVisible();
    await expect(page.getByTestId("docs.prev")).toHaveCount(0);

    await page.getByTestId("docs.next").click();
    await expect(page).toHaveURL(/\/docs\/.+/, { timeout: 10000, waitUntil: "commit" });
    await expect(page.getByTestId("docs.prev")).toBeVisible({ timeout: 15000 });
  });

  test("code blocks render with a copy affordance", async ({ page }) => {
    await page.goto("/docs/plugins/docs-plugin", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.code-block").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.copy-code").first()).toBeVisible();

    expectNoHydrationFailure(pageErrors);
  });
});
