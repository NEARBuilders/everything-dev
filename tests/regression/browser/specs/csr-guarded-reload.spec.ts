import { expect, test } from "@playwright/test";
import { waitForApp } from "../helpers/page-ready";
import { injectAdminCookies, injectCookies } from "../helpers/seeded";

/**
 * Client-rendered full-page loads must not read an unresolved session as
 * signed-out (#818): the mount guard resolves through the session query
 * cache, so a signed-in reload of a guarded page stays put, an admin keeps
 * the admin route across a reload, and a signed-out visit keeps the
 * ?redirect= return path. Signed-out means no cookies at all — the seeded
 * "logout" jar is an anonymous signed-in session, which guards treat as
 * authed.
 */
test.describe("CSR guarded reloads", () => {
  test("a signed-in full page load of a guarded route stays put", async ({ page }) => {
    await injectCookies(page);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000, waitUntil: "commit" });
    await expect(page.getByTestId("login.heading")).toHaveCount(0);
  });

  test("an admin's full page load stays on the admin route", async ({ page }) => {
    await injectAdminCookies(page);

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page).toHaveURL(/\/admin/, { timeout: 15000, waitUntil: "commit" });
    await expect(page.getByTestId("login.heading")).toHaveCount(0);
  });

  test("a signed-out full page load of an admin route keeps the return path", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: 15000, waitUntil: "commit" });

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect"), "return path points at /admin").toContain("/admin");
  });
});
