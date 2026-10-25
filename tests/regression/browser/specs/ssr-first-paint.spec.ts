import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

/**
 * SSR first paint — pins that the SSR'd HTML paints real content (never the
 * Loading shell), hydration consumes the $_TSR bootstrap, and first paint
 * stays inside the pathological budget. Runs under the SSR projects
 * (dev:ssr, start:ssr) only; CSR stacks have no server-rendered content by
 * design. Traces are always retained for this spec (the artifact), and the
 * measured paint numbers attach to the report — numbers are recorded, never
 * asserted tight (the 60s pathological budget is the only guard).
 */
const MODE = process.env.REGRESSION_MODE ?? "";
const SSR_MODES = new Set(["dev:ssr", "start:ssr"]);

test.use({ trace: "on" });

test.describe("SSR first paint", () => {
  test("/about paints SSR content and hydrates the server tree", async ({ page }, testInfo) => {
    test.skip(!SSR_MODES.has(MODE), `REGRESSION_MODE=${MODE || "unset"} is not an SSR mode`);
    const errors = collectErrors(page);

    const startedAt = Date.now();
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const navigationMs = Date.now() - startedAt;

    // The served document is the server render, not the client shell.
    const ssrAttr = await page.evaluate(() =>
      document.documentElement.hasAttribute("data-everything-ssr"),
    );
    expect(ssrAttr, "the served <html> must carry data-everything-ssr").toBe(true);

    // Real content paints — not the Loading shell.
    const content = page.getByTestId("about.open-skill-link");
    await expect(content).toBeVisible({ timeout: 15000 });
    const contentVisibleMs = Date.now() - startedAt;
    const shellCount = await page.locator("#root p", { hasText: "Loading..." }).count();
    expect(shellCount, "the Loading shell must not be what paints").toBe(0);

    await waitForApp(page);

    // Hydration consumed the server bootstrap: the progress array is the
    // reliable signal (mark() only console-logs in DEV builds; the no-watch
    // regression stack serves a production build). Marks are timestamped —
    // always substring-match.
    const progress = await page.evaluate(
      () => (window as { __CLIENT_PROGRESS__?: string[] }).__CLIENT_PROGRESS__ ?? [],
    );
    expect(
      progress.some((mark) => mark.includes("$_TSR present: true")),
      `expected the $_TSR bootstrap mark, got: ${progress.join(" | ")}`,
    ).toBeTruthy();
    expect(
      progress.some((mark) => mark.includes("tree constructed")),
      `expected a "tree constructed" mark, got: ${progress.join(" | ")}`,
    ).toBeTruthy();
    expect(
      progress.some((mark) => mark.includes("hydration consumed ($_TSR deleted")),
      `expected the hydration-consumed mark, got: ${progress.join(" | ")}`,
    ).toBeTruthy();
    expect(
      progress.find(
        (mark) =>
          mark.includes("CLIENT COMPOSE ERROR") ||
          mark.includes("DIGEST PARITY FAILURE") ||
          mark.includes("core-only tree constructed") ||
          mark.includes("degraded compose"),
      ),
      "the hydrated path must not degrade",
    ).toBeUndefined();

    expectNoHydrationFailure(errors);

    // Pathological guard only — the numbers themselves attach as an artifact.
    await testInfo.attach("ssr-first-paint-numbers.json", {
      body: JSON.stringify({ mode: MODE, navigationMs, contentVisibleMs }, null, 2),
      contentType: "application/json",
    });
    expect(contentVisibleMs, "pathological first-paint budget (60s)").toBeLessThan(60_000);
  });
});
