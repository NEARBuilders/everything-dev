import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("Error boundary", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("host returns structured JSON for an unhandled server error (no HTML leak)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/errors?kind=internal");
      const text = await res.text();
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        isJson: parsed !== null,
        code: parsed?.code,
        hasMessage: typeof parsed?.message === "string" && parsed.message.length > 0,
        text,
      };
    });

    expect(result.status).toBe(500);
    expect(result.contentType).toContain("application/json");
    expect(result.isJson).toBe(true);
    expect(result.code).toBe("INTERNAL_SERVER_ERROR");
    expect(result.hasMessage).toBe(true);
    expect(result.text, "must never return an HTML error page").not.toContain("<html");
    expectNoHydrationFailure(pageErrors);
  });

  test("unauthorized API request returns JSON 401, not HTML", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/tenants");
      const text = await res.text();
      let code = "";
      try {
        code = JSON.parse(text).code;
      } catch {
        /* not JSON */
      }
      return { status: res.status, code, text };
    });

    expect(result.status).toBe(401);
    expect(result.code).toBe("UNAUTHORIZED");
    expect(result.text).not.toContain("<html");
  });

  test("UI survives an injected 500 API response without an uncaught error", async ({
    page,
  }) => {
    await page.route("**/api/rpc/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      }),
    );

    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.locator("#root")).toBeAttached({ timeout: 15000 });
    await page.waitForTimeout(1500);

    expect(pageErrors, "an injected 500 must not produce an uncaught page error").toEqual([]);
    expectNoHydrationFailure(pageErrors);
  });
});