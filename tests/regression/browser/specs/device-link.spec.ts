import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectAdminCookies } from "../helpers/seeded";

test.describe("Device Link", () => {
  test("a signed-out phone signs in and lands back on device approval with its code intact", async ({
    browser,
    page,
  }) => {
    const pageErrors = collectErrors(page);

    const desktop = await browser.newContext();
    const desktopPage = await desktop.newPage();
    await desktopPage.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(desktopPage);
    await desktopPage.getByTestId("login.device-button").click();
    const desktopCode = desktopPage.getByTestId("device.user-code");
    await expect(desktopCode).toHaveText(/^[A-Z2-9]{8}$/, { timeout: 15000 });
    const userCode = (await desktopCode.textContent())?.trim() ?? "";

    await page.goto(`/login/device?user_code=${userCode}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.getByTestId("device.signin-redirect-button").click();

    await page.waitForURL(/\/login\?/, { timeout: 15000, waitUntil: "commit" });
    const loginUrl = new URL(page.url());
    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("redirect")).toBe(`/login/device?user_code=${userCode}`);
    await expect(page.getByTestId("login.heading")).toBeVisible({ timeout: 10000 });

    await injectAdminCookies(page);
    await page.goto(loginUrl.href, { waitUntil: "domcontentloaded" });

    await page.waitForURL(/\/login\/device\/approve/, { timeout: 15000, waitUntil: "commit" });
    expect(new URL(page.url()).searchParams.get("user_code")).toBe(userCode);
    await expect(page.getByTestId("device.approve-heading")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("device.approve-code")).toContainText(userCode);

    expectNoHydrationFailure(pageErrors);
    await desktop.close();
  });
});
