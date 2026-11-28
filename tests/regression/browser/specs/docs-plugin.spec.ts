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

  test("docs index lists the repository's docs as a navigable tree", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.heading")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.tree")).toBeVisible({ timeout: 15000 });
    const items = page.getByTestId("docs.item");
    await expect(items.first()).toBeVisible({ timeout: 15000 });
    const count = await items.count();
    expect(count, "the compiled docs tree must surface at least ten docs").toBeGreaterThanOrEqual(
      10,
    );

    expectNoHydrationFailure(pageErrors);
  });

  test("the reader sidebar mirrors the docs tree", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.sidebar")).toBeVisible({ timeout: 15000 });
    const sidebarItems = page.getByTestId("docs.sidebar").getByTestId("docs.item");
    await expect(sidebarItems.first()).toBeVisible({ timeout: 15000 });
    expect(await sidebarItems.count()).toBeGreaterThanOrEqual(10);
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

  test("search matches against body text, not just titles", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const count = page.getByTestId("docs.count");
    await expect(count).toHaveText(/\d+ \/ \d+ docs/, { timeout: 15000 });
    const total = await count.innerText();

    await page.getByTestId("docs.search").fill("0017-session-gas-keys");
    await expect(page.getByTestId("docs.item")).toHaveCount(1, { timeout: 15000 });
    await expect(count).not.toHaveText(total);

    await page.getByTestId("docs.search").fill("ADR 0001");
    await expect(page.getByTestId("docs.item").first()).toBeVisible({ timeout: 15000 });
    const bodyMatches = await page.getByTestId("docs.item").count();
    expect(
      bodyMatches,
      "body search must surface more docs than the title-only match",
    ).toBeGreaterThan(1);
  });

  test("a directory route resolves to its README index, and in-corpus links resolve", async ({
    page,
  }) => {
    await page.goto("/docs/adr", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });

    const indexLink = page.getByTestId("docs.markdown").locator('a[href^="/docs/adr/"]').first();
    await expect(indexLink).toBeVisible({ timeout: 15000 });
    await indexLink.click();
    await expect(page).toHaveURL(/\/docs\/adr\/.+$/, { timeout: 10000, waitUntil: "commit" });
    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });
  });

  test("the reader shows prev/next navigation in tree order", async ({ page }) => {
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

  test("reader sections are deep-linkable with anchors and a TOC", async ({ page }) => {
    await page.goto("/docs/plugins/docs-plugin", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });

    const toc = page.getByTestId("docs.toc");
    await expect(toc).toBeVisible({ timeout: 15000 });
    const anchors = page.getByTestId("docs.heading-anchor");
    await expect(anchors.first()).toBeVisible({ timeout: 15000 });
    await anchors.first().click();
    await expect(page).toHaveURL(/#.+/);
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
