import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

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
    const list = page.getByTestId("docs.list");
    await expect(list.getByTestId("docs.tree")).toBeVisible({ timeout: 15000 });
    const items = list.getByTestId("docs.item");
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

  test("the index renders the documentation map above the tree", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.heading")).toHaveText("Documentation map", {
      timeout: 15000,
    });
    await expect(page.getByTestId("docs.map")).toBeVisible();
    await expect(page.getByTestId("docs.all-documents")).toBeVisible();
    await expect(page.getByTestId("docs.list").getByTestId("docs.tree")).toBeVisible();

    expectNoHydrationFailure(pageErrors);
  });

  test("the first section starts open and the rest wait until entered", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const sections = page
      .getByTestId("docs.list")
      .locator(':scope > ul > li > details[data-testid="docs.tree-dir"]');
    await expect(sections.first()).toBeVisible({ timeout: 15000 });
    await expect(sections.first().locator(":scope > summary")).toHaveText("Book");
    await expect(sections.first()).toHaveAttribute("open", "");

    const ledger = sections.filter({
      has: page.locator(":scope > summary", { hasText: /^ADR$/ }),
    });
    await expect(ledger).toHaveCount(1);
    await expect(ledger).not.toHaveAttribute("open", /.*/);
  });

  test("the reader lays out a sidebar and an on-this-page TOC on a desktop viewport", async ({
    page,
  }) => {
    await page.goto("/docs/book/01-the-model", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.sidebar")).toBeVisible();
    await expect(page.getByTestId("docs.mobile-tree")).toBeHidden();
    await expect(page.getByTestId("docs.toc")).toBeVisible();
  });

  test("the read API serves the corpus over REST", async ({ page }) => {
    const list = await page.request.get("/api/docs?limit=2");
    expect(list.ok()).toBe(true);
    expect((await list.json()).data).toHaveLength(2);

    const response = await page.request.get("/api/docs/book/01-the-model");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.doc.file).toBe("docs/book/01-the-model.md");
    expect(body.doc.raw).toContain("One authored file is the whole argument");

    const nav = await page.request.get("/api/docs/nav");
    expect(nav.ok()).toBe(true);
    expect((await nav.json()).nav.length).toBeGreaterThan(0);
  });

  test("a chapter links into the ledger, the skill family, and the repository", async ({
    page,
  }) => {
    await page.goto("/docs/book/01-the-model", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("docs.reader-title")).toHaveText("01 · The model", {
      timeout: 15000,
    });
    const markdown = page.getByTestId("docs.markdown");

    await expect(
      markdown.locator('a[href="/skills/everything-dev/init-upgrade/SKILL.md"]'),
    ).toBeVisible();
    await expect(
      markdown.locator(
        'a[href="https://github.com/nearbuilders/everything-dev/blob/HEAD/bos.app.ts"]',
      ),
    ).toBeVisible();

    await markdown.locator('a[href="/docs/adr/0005-app-ts-authored-descriptor"]').first().click();
    await expect(page).toHaveURL(/\/docs\/adr\/0005-app-ts-authored-descriptor$/, {
      timeout: 10000,
      waitUntil: "commit",
    });
    await expect(page.getByTestId("docs.reader-title")).toContainText("ADR 0005", {
      timeout: 15000,
    });

    expectNoHydrationFailure(pageErrors);
  });

  test("clicking a doc opens the reader with rendered markdown", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const firstItem = page.getByTestId("docs.list").getByTestId("docs.item").first();
    await expect(firstItem).toBeVisible({ timeout: 15000 });
    await firstItem.click();

    await expect(page).toHaveURL(/\/docs\/.+$/, { timeout: 10000, waitUntil: "commit" });
    await expect(page.getByTestId("docs.reader-title")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("docs.markdown")).toBeVisible({ timeout: 15000 });

    expectNoHydrationFailure(pageErrors);
  });

  test("an ADR's status renders as a badge with its qualifier in a popover", async ({ page }) => {
    await page.goto("/docs/adr/0038-pglite-only-local-db", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const badge = page.getByTestId("docs.status-badge");
    await expect(badge).toBeVisible({ timeout: 15000 });
    await expect(badge).toContainText("accepted", { ignoreCase: true });

    await badge.click();
    const note = page.getByTestId("docs.status-note");
    await expect(note).toBeVisible({ timeout: 5000 });
    await expect(note).toContainText("superseded by ADR 0044", { ignoreCase: true });

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

    const results = page.getByTestId("docs.list").getByTestId("docs.item");
    await page.getByTestId("docs.search").fill("0017-session-gas-keys");
    await expect(results).toHaveCount(1, { timeout: 15000 });
    await expect(count).not.toHaveText(total);

    await page.getByTestId("docs.search").fill("ADR 0001");
    await expect(results.nth(1)).toBeVisible({ timeout: 15000 });
    const bodyMatches = await results.count();
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

    await page.getByTestId("docs.list").getByTestId("docs.item").first().click();
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
