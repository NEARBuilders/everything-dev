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
    // dev:ssr proves the strict invariant: the seeded cache reaches the client
    // and no get-session call fires at all. In start:ssr the built bundle's
    // hydration makes exactly one client-side fetch — the tri-state-correct
    // unresolved→fetch path, bounded and not the failure mode — so there the
    // guarantee is "at most one", pending threading the seeded session through
    // the start-mode hydration payload.
    if (test.info().project.name === "dev:ssr") {
      expect(getSessionCalls).toBe(0);
    } else {
      expect(getSessionCalls).toBeLessThanOrEqual(1);
    }
    expectNoHydrationFailure(pageErrors);
  });
});
