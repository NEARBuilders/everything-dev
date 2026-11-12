import { expect, type Page, type Route, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

/**
 * Soft-refresh banner end to end (fly-hosting 14): a signed-in open tab
 * notices a newer published generation within the watch+poll window, offers
 * Refresh, and the reload lands on a live page; dismissal lasts the session;
 * anonymous tabs never poll. The regression harness boots a single instance
 * from a staged config — it cannot publish a new pointer to a registry (no
 * FastKV, no NEAR credentials) and cannot replace the instance (reconciler,
 * fly-hosting 08) — so the "newer generation" is simulated at the
 * `/.well-known/version` boundary the banner actually polls. The
 * reconciler-driven variants (real second instance, refresh onto new bytes)
 * are tracked in the ticket; everything this spec proves — poll → banner →
 * reload → dismiss → session persistence, plus poll resilience to a failing
 * endpoint — is the real UI contract.
 */

const VERSION_ENDPOINT = "**/.well-known/version";

interface VersionPayload {
  deploymentDigest?: string;
  restartRequired?: string[];
  pendingRestart?: string[];
  [key: string]: unknown;
}

/** Node-side counter bumped by the route handler on every version fetch the
 * page makes — the observable "a poll round-tripped" signal the assertions
 * wait on. */
interface PollCounter {
  value: number;
}

const nextDigestOf = (digest: string) => `${digest}-published-next`;

async function servingDigest(page: Page): Promise<string> {
  const digest = await page.evaluate(() => {
    const config = (window as { __RUNTIME_CONFIG__?: { deploymentDigest?: string } })
      .__RUNTIME_CONFIG__;
    return config?.deploymentDigest;
  });
  expect(digest, "the client config carries the serving generation's digest").toBeTruthy();
  return digest as string;
}

/** Publishes a simulated newer generation: every subsequent poll of
 * `/.well-known/version` from this page reports the overridden payload. The
 * fulfilled response is no-store so the endpoint's 30s browser cache can
 * never mask a later poll. */
async function publishVersion(page: Page, polls: PollCounter, override: Partial<VersionPayload>) {
  await page.route(VERSION_ENDPOINT, async (route: Route) => {
    polls.value += 1;
    const response = await route.fetch();
    const body = (await response.json()) as VersionPayload;
    await route.fulfill({
      response,
      body: JSON.stringify({ ...body, ...override }),
      headers: { ...response.headers(), "cache-control": "no-store" },
    });
  });
}

/** The watch polls on its 60s interval; a visibility flip is the same
 * trigger a user fires by returning to the tab. The banner arms its poller
 * asynchronously (a session round-trip), so early flips hit no listener —
 * dispatch until a poll actually lands through the route. */
async function pollUntilLanded(page: Page, polls: PollCounter) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const before = polls.value;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(750);
    if (polls.value > before) return;
  }
  throw new Error("the page never polled /.well-known/version after the visibility flip");
}

test.describe("version refresh banner", () => {
  test("a UI-only publish: banner appears, refresh reloads, dismiss lasts the session", async ({
    page,
  }) => {
    const pageErrors = collectErrors(page);
    await injectCookies(page);
    const polls: PollCounter = { value: 0 };

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    const digest = await servingDigest(page);
    await expect(page.getByTestId("version-refresh-banner")).toHaveCount(0);

    await publishVersion(page, polls, { deploymentDigest: nextDigestOf(digest) });
    await pollUntilLanded(page, polls);
    const banner = page.getByTestId("version-refresh-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });

    const reloaded = page.waitForLoadState("load");
    await page.getByTestId("version-refresh-button").click();
    await reloaded;
    await waitForApp(page);

    // The harness cannot publish real bytes, so the refreshed page still
    // serves the old generation and the (simulated) newer deploy remains
    // available — the banner re-arming proves the reload served a live,
    // polling page.
    await pollUntilLanded(page, polls);
    await expect(page.getByTestId("version-refresh-banner")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("version-refresh-dismiss").click();
    await expect(page.getByTestId("version-refresh-banner")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("version-refresh-banner")).toHaveCount(0);

    expectNoHydrationFailure(pageErrors);
  });

  test("a backend publish: the replaced instance's new digest drives the same banner and refresh", async ({
    page,
  }) => {
    const pageErrors = collectErrors(page);
    await injectCookies(page);
    const polls: PollCounter = { value: 0 };

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    const digest = await servingDigest(page);

    await publishVersion(page, polls, {
      deploymentDigest: nextDigestOf(digest),
      restartRequired: ["app.api"],
      pendingRestart: ["app.api"],
    });
    await pollUntilLanded(page, polls);
    await expect(page.getByTestId("version-refresh-banner")).toBeVisible({ timeout: 15000 });

    const reloaded = page.waitForLoadState("load");
    await page.getByTestId("version-refresh-button").click();
    await reloaded;
    await waitForApp(page);

    expectNoHydrationFailure(pageErrors);
  });

  test("polling survives a failing version endpoint and recovers when it returns", async ({
    page,
  }) => {
    const pageErrors = collectErrors(page);
    await injectCookies(page);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    const digest = await servingDigest(page);

    const polls: PollCounter = { value: 0 };
    await page.route(VERSION_ENDPOINT, async (route: Route) => {
      polls.value += 1;
      if (polls.value <= 2) {
        await route.abort("connectionrefused");
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as VersionPayload;
      await route.fulfill({
        response,
        body: JSON.stringify({ ...body, deploymentDigest: nextDigestOf(digest) }),
        headers: { ...response.headers(), "cache-control": "no-store" },
      });
    });

    await pollUntilLanded(page, polls);
    await expect(page.getByTestId("version-refresh-banner")).toHaveCount(0);
    await pollUntilLanded(page, polls);
    await expect(page.getByTestId("version-refresh-banner")).toHaveCount(0);

    await pollUntilLanded(page, polls);
    await expect(page.getByTestId("version-refresh-banner")).toBeVisible({ timeout: 15000 });

    expect(pageErrors, "no unhandled errors across failed polls").toEqual([]);
  });

  test("an anonymous tab never polls and never sees the banner", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    const digest = await servingDigest(page);

    const polls: PollCounter = { value: 0 };
    await publishVersion(page, polls, { deploymentDigest: nextDigestOf(digest) });

    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1500);

    expect(polls.value, "no version polling without a signed-in session").toBe(0);
    await expect(page.getByTestId("version-refresh-banner")).toHaveCount(0);
  });
});
