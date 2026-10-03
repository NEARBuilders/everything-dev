import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

test.describe("Auth redirect", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("unauthenticated /settings redirects to /login with a redirect target", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await page.waitForURL(/\/login/, { timeout: 15000, waitUntil: "commit" });

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect"), "redirect param should point at /settings").toContain(
      "/settings",
    );

    const signInHeading = page.getByTestId("login.heading");
    await expect(signInHeading).toBeVisible({ timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });

  test("unauthenticated /dashboard redirects to /login", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await page.waitForURL(/\/login/, { timeout: 15000, waitUntil: "commit" });

    const signInHeading = page.getByTestId("login.heading");
    await expect(signInHeading).toBeVisible({ timeout: 10000 });

    expectNoHydrationFailure(pageErrors);
  });

  test("authenticated /login refuses an off-site redirect target", async ({ page }) => {
    await injectCookies(page);

    await page.goto(`/login?redirect=${encodeURIComponent("https://example.com/")}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(/\/dashboard/, { timeout: 15000, waitUntil: "commit" });
    await waitForApp(page);

    const landed = new URL(page.url());
    expect(landed.hostname).not.toBe("example.com");
    expect(landed.pathname).toBe("/dashboard");
    expectNoHydrationFailure(pageErrors);
  });

  // Regression: the login route redirected authed visitors to the redirect
  // target while the authed guard, reading a stale (signed-out) session cache
  // via ensureQueryData, bounced them straight back — ping-ponging past the
  // router's redirect limit into "Too many redirects" on the root boundary.
  test("authenticated /login lands on the redirect target without a redirect loop", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // The server-side cookie cache must stay disabled: the session_data
    // cache cookie is only ever set when `session.cookieCache` is enabled,
    // and a re-enabled cache is what lets a get-session read serve a stale
    // snapshot (the original loop class). Paramless /get-session requests in
    // the network log are expected — better-auth's internal session atom
    // (subscribed via useNearAccountId) fetches without query params, and
    // with the cache disabled those are DB-truth reads.
    const cacheCookieResponses: string[] = [];
    page.on("response", (response) => {
      const setCookie = response.headers()["set-cookie"];
      if (setCookie?.toLowerCase().includes("session_data")) {
        cacheCookieResponses.push(`${response.url()} → ${setCookie}`);
      }
    });

    await injectCookies(page);

    await page.goto("/login?redirect=%2Fdashboard", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/dashboard/, { timeout: 15000, waitUntil: "commit" });
    await waitForApp(page);

    await expect(page.getByText("Application error")).toHaveCount(0);
    await expect(
      page.getByText("Something went wrong before the app layout could render."),
    ).toHaveCount(0);
    expect(consoleErrors.join("\n")).not.toContain("Too many redirects");
    expect(consoleErrors.join("\n")).not.toContain("Error in route match");
    expectNoHydrationFailure(pageErrors);

    expect(
      cacheCookieResponses,
      "no response may set the better-auth session_data cache cookie",
    ).toEqual([]);
  });
});
