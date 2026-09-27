import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure } from "../helpers/page-ready";
import { injectAdminCookies, loadAdminSeedData, verifyAuthenticated } from "../helpers/seeded";

test.describe("orgSwitcher", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
    await injectAdminCookies(page);
  });

  test("renders seeded organizations in the switcher", async ({ page }) => {
    const { orgAName, orgBName } = loadAdminSeedData();

    await verifyAuthenticated(page);

    const orgSwitcher = page.getByTestId("org-switcher");
    await expect(orgSwitcher).toBeVisible({ timeout: 10000 });

    await orgSwitcher.click();

    await expect(page.getByRole("menuitem").filter({ hasText: orgAName })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("menuitem").filter({ hasText: orgBName })).toBeVisible({
      timeout: 5000,
    });

    expectNoHydrationFailure(pageErrors);
  });
});
