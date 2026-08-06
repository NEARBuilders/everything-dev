import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("orgSwitcher", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("can create and switch between organizations", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const anonymousBtn = page.getByText("continue anonymously");
    await expect(anonymousBtn).toBeVisible({ timeout: 10000 });
    await anonymousBtn.click();

    await page.waitForURL(/\/home$/, { timeout: 15000 });
    await expect(page.getByText("settings")).toBeVisible({ timeout: 10000 });

    const orgAName = `test-org-a-${Date.now()}`;
    const orgBName = `test-org-b-${Date.now()}`;
    const orgASlug = orgAName.toLowerCase().replace(/\s+/g, "-");
    const orgBSlug = orgBName.toLowerCase().replace(/\s+/g, "-");

    const createResp = await page.evaluate(
      async (name, slug) => {
        const res = await fetch("/api/auth/organization/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, slug }),
          credentials: "include",
        });
        return { status: res.status, data: await res.json() };
      },
      orgAName,
      orgASlug,
    );
    expect(createResp.status).toBe(200);

    const createRespB = await page.evaluate(
      async (name, slug) => {
        const res = await fetch("/api/auth/organization/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, slug }),
          credentials: "include",
        });
        return { status: res.status, data: await res.json() };
      },
      orgBName,
      orgBSlug,
    );
    expect(createRespB.status).toBe(200);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await page.waitForURL(/\/home$/, { timeout: 15000 });
    await expect(page.getByText("settings")).toBeVisible({ timeout: 10000 });

    const orgSwitcher = page.locator("button", { has: page.locator("span.truncate") }).first();
    await expect(orgSwitcher).toBeVisible({ timeout: 10000 });
    await orgSwitcher.click();

    const orgBOption = page.getByRole("menuitem").filter({ hasText: orgBName });
    await expect(orgBOption).toBeVisible({ timeout: 5000 });
    await orgBOption.click();

    await page.waitForTimeout(1000);

    const updatedSwitcher = page
      .locator("button", { has: page.locator("span.truncate") })
      .first();
    await expect(updatedSwitcher).toContainText(orgBName, { timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });
});
