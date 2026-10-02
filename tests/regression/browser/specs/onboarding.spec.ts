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

  test("short viewport can scroll the full onboard panel without a stuck page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await openCode(page, "valid");

    await expect(page.getByTestId("onboard.heading")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("onboard.create-account-button")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const panel = document.querySelector("[data-testid=auth-panel]");
      if (!(panel instanceof HTMLElement)) return null;
      return {
        panelScrollHeight: panel.scrollHeight,
        panelClientHeight: panel.clientHeight,
        documentScrollable:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      };
    });
    if (!metrics) throw new Error("auth panel scroll region must mount");
    expect(
      metrics.panelScrollHeight,
      "onboard content must overflow the short viewport so the panel can scroll",
    ).toBeGreaterThan(metrics.panelClientHeight);
    expect(metrics.documentScrollable, "document must not grow a second scrollbar").toBe(false);

    const bottomCta = page.getByTestId("onboard.existing-account-button");
    await bottomCta.scrollIntoViewIfNeeded();
    await expect(bottomCta).toBeInViewport();

    const scrolled = await page.evaluate(() => {
      const panel = document.querySelector("[data-testid=auth-panel]");
      return panel instanceof HTMLElement ? panel.scrollTop : 0;
    });
    expect(
      scrolled,
      "auth panel must actually move when reaching below-the-fold controls",
    ).toBeGreaterThan(0);

    await page.setViewportSize({ width: 390, height: 320 });
    const stillScrollable = await page.evaluate(() => {
      const panel = document.querySelector("[data-testid=auth-panel]");
      if (!(panel instanceof HTMLElement)) return false;
      panel.scrollTop = 0;
      const canOverflow = panel.scrollHeight > panel.clientHeight;
      panel.scrollTop = panel.scrollHeight;
      return canOverflow && panel.scrollTop > 0;
    });
    expect(stillScrollable, "a keyboard-shortened viewport must still scroll the panel").toBe(true);
  });
});
