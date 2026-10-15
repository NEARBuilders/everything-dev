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

  test("pairing params survive the signed-out sign-in redirect", async ({ page }) => {
    await page.goto(
      "/login/device/approve?user_code=ABCD2345&pubKey=ed25519%3Aabc123&contract=example.near&network=testnet&source=cli",
      { waitUntil: "domcontentloaded" },
    );
    await waitForApp(page);
    await page.getByTestId("device.approve-signin-button").click();

    await page.waitForURL(/\/login\?/, { timeout: 15000, waitUntil: "commit" });
    const redirect = new URL(page.url()).searchParams.get("redirect") ?? "";
    const deviceUrl = new URL(`https://device.local${redirect}`);
    expect(deviceUrl.pathname).toBe("/login/device");
    expect(deviceUrl.searchParams.get("user_code")).toBe("ABCD2345");
    expect(deviceUrl.searchParams.get("pubKey")).toBe("ed25519:abc123");
    expect(deviceUrl.searchParams.get("contract")).toBe("example.near");
    expect(deviceUrl.searchParams.get("network")).toBe("testnet");
    expect(deviceUrl.searchParams.get("source")).toBe("cli");
  });

  test("malformed codes are rejected client-side without a roundtrip", async ({ page }) => {
    const claimRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/device\?/.test(request.url())) claimRequests.push(request.url());
    });

    await page.goto("/login/device", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.getByTestId("device.user-code-input").fill("AB!");
    await page.getByTestId("device.verify-button").click();

    await expect(page.getByTestId("device.verify-error")).toBeVisible();
    expect(claimRequests).toEqual([]);
  });

  test("a failed claim shows its error once and never re-claims in a loop", async ({ page }) => {
    await injectAdminCookies(page);

    const claimRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/device\?/.test(request.url())) claimRequests.push(request.url());
    });

    await page.goto("/login/device?user_code=ZZZZZZZZ", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("device.verify-error")).toBeVisible({ timeout: 15000 });

    // The claim effect used to reset its guard on failure and re-claim the
    // same code forever — one request, then stable, is the regression lock.
    await page.waitForTimeout(2000);
    expect(claimRequests).toHaveLength(1);
    await expect(page.getByTestId("device.verify-error")).toBeVisible();
  });

  test("a network failure while claiming surfaces a connection error", async ({ page }) => {
    await injectAdminCookies(page);
    await page.route(/\/device\?/, (route) => route.abort("connectionrefused"));

    await page.goto("/login/device?user_code=ABCD2345", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("device.verify-error")).toHaveText(/connection/i, {
      timeout: 15000,
    });
  });

  test("deny consumes the request and returns the user home", async ({ browser, page }) => {
    const desktop = await browser.newContext();
    const desktopPage = await desktop.newPage();
    await desktopPage.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(desktopPage);
    await desktopPage.getByTestId("login.device-button").click();
    const desktopCode = desktopPage.getByTestId("device.user-code");
    await expect(desktopCode).toHaveText(/^[A-Z2-9]{8}$/, { timeout: 15000 });
    const userCode = (await desktopCode.textContent())?.trim() ?? "";

    await injectAdminCookies(page);
    await page.goto(`/login/device?user_code=${userCode}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.waitForURL(/\/login\/device\/approve/, { timeout: 15000, waitUntil: "commit" });
    await expect(page.getByTestId("device.approve-heading")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("device.deny-button").click();
    await page.waitForURL(/\/$|\/\?/, { timeout: 15000, waitUntil: "commit" });
    await desktop.close();
  });

  test("a failed deny keeps the request on screen with an error", async ({ browser, page }) => {
    const desktop = await browser.newContext();
    const desktopPage = await desktop.newPage();
    await desktopPage.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(desktopPage);
    await desktopPage.getByTestId("login.device-button").click();
    const desktopCode = desktopPage.getByTestId("device.user-code");
    await expect(desktopCode).toHaveText(/^[A-Z2-9]{8}$/, { timeout: 15000 });
    const userCode = (await desktopCode.textContent())?.trim() ?? "";

    await injectAdminCookies(page);
    await page.goto(`/login/device?user_code=${userCode}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.waitForURL(/\/login\/device\/approve/, { timeout: 15000, waitUntil: "commit" });
    await expect(page.getByTestId("device.approve-heading")).toBeVisible({ timeout: 10000 });

    await page.route(/\/device\/deny$/, (route) => route.abort("connectionrefused"));
    await page.getByTestId("device.deny-button").click();

    await expect(page.getByTestId("device.approve-error")).toBeVisible({ timeout: 10000 });
    expect(new URL(page.url()).pathname).toBe("/login/device/approve");
    await desktop.close();
  });
});
