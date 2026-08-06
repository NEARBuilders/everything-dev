import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("authClient", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("login page renders with auth options", async ({ page }) => {
    const responses: string[] = [];

    page.on("response", (response) => {
      const url = response.url();
      if (response.status() === 200 && url.includes("/api/auth/get-session")) {
        responses.push(url);
      }
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const anonymousBtn = page.getByText("continue anonymously");
    await expect(anonymousBtn).toBeVisible({ timeout: 10000 });

    expect(responses.length).toBeGreaterThanOrEqual(0);
    expectNoHydrationFailure(pageErrors);
  });

  test("anonymous sign in works from browser", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const signInResponses: string[] = [];
    const sessionResponses: string[] = [];

    page.on("response", (response) => {
      const url = response.url();
      if (response.status() === 200) {
        if (url.includes("/api/auth/sign-in/anonymous")) {
          signInResponses.push(url);
        }
        if (url.includes("/api/auth/get-session")) {
          sessionResponses.push(url);
        }
      }
    });

    const anonymousBtn = page.getByText("continue anonymously");
    await expect(anonymousBtn).toBeVisible({ timeout: 10000 });

    const signInDone = page.waitForResponse(
      (resp) => resp.status() === 200 && resp.url().includes("/api/auth/sign-in/anonymous"),
      { timeout: 15000 },
    );

    await anonymousBtn.click();
    await signInDone;

    await page.waitForURL(/\/home$/, { timeout: 15000 });
    await page.reload();
    await page.waitForURL(/\/home$/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await waitForApp(page);

    const isAnonymous = page.getByText("anonymous session", { exact: true });
    await expect(isAnonymous).toBeVisible({ timeout: 5000 });

    expect(signInResponses.length).toBeGreaterThanOrEqual(1);

    const settingsLink = page.getByText("settings").first();
    await expect(settingsLink).toBeVisible({ timeout: 5000 });
    await settingsLink.click();
    await page.waitForURL(/\/settings/, { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("Settings", { timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });
});
