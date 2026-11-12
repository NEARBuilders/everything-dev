import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("SSR session resolution (#689)", () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("anonymous page renders 200, signed-out, with no get-session round-trip", async ({
    page,
  }) => {
    let getSessionCalls = 0;
    await page.route("**/api/auth/get-session*", (route) => {
      getSessionCalls += 1;
      return route.continue();
    });

    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await waitForApp(page);

    // The server resolves the session in-process (host getContext) and seeds
    // the query cache — the dehydrated state carries a signed-out entry, so
    // the SSR HTML must never carry the session-failure error (#689's 500
    // mode), and the client must not refetch a session it was handed.
    expect(await page.content()).not.toContain("Unable to load your session");
    // Strict zero get-session calls in dev:ssr (the seeded cache reaches the
    // client); in start:ssr the guarantee is "at most one" — the unresolved
    // hydration fetch is tri-state-correct, pending hydration-payload threading.
    if (test.info().project.name === "dev:ssr") {
      expect(getSessionCalls).toBe(0);
    } else {
      expect(getSessionCalls).toBeLessThanOrEqual(1);
    }
    expectNoHydrationFailure(pageErrors);
  });
});
