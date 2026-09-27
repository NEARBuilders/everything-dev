import { expect, test } from "@playwright/test";
import { type OnboardingCodeFixture, seedOnboardingCodes } from "../helpers/onboarding-seed";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("Onboarding page", () => {
  let seeded: Awaited<ReturnType<typeof seedOnboardingCodes>>;

  test.beforeAll(async () => {
    seeded = await seedOnboardingCodes();
  });

  async function openCode(page: import("@playwright/test").Page, fixture: OnboardingCodeFixture) {
    await page.goto(`/onboard?code=${seeded.codes[fixture]}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.waitForURL(/\/onboard\?code=/, { timeout: 15000, waitUntil: "commit" });
  }

  test("a valid code invites a signed-out visitor to the organization and event", async ({
    page,
  }) => {
    const pageErrors = collectErrors(page);

    await openCode(page, "valid");

    const invite = page.getByTestId("onboard.invite");
    await expect(invite).toBeVisible({ timeout: 15000 });
    await expect(invite).toContainText(seeded.organizationName);
    await expect(invite).toContainText(seeded.eventName);
    expectNoHydrationFailure(pageErrors);
  });

  const unavailable: Array<[OnboardingCodeFixture, string, RegExp]> = [
    ["expired", "an expired", /expired/i],
    ["revoked", "a revoked", /revoked/i],
    ["usedUp", "a used-up", /reached its limit/i],
  ];

  for (const [fixture, label, message] of unavailable) {
    test(`${label} code explains why it can't be used`, async ({ page }) => {
      await openCode(page, fixture);

      const status = page.getByTestId("onboard.unavailable");
      await expect(status).toBeVisible({ timeout: 15000 });
      await expect(status).toHaveText(message);
      await expect(page.getByTestId("onboard.invite")).toHaveCount(0);
    });
  }
});
