import { expect, test } from "@playwright/test";
import { waitForApp } from "../helpers/page-ready";

/**
 * CSR (no-SSR) compose regression — the default `bos dev` path. The shell
 * must carry the compose payload so the browser itself registers the plugin
 * remotes, loads their routeConfig, and constructs the route tree. Guards
 * against the failure class where plugin routes are absent client-side and
 * dynamic core routes (/_public/$accountId) swallow static paths like
 * /login. Complements the SSR (dev) project which covers the server-composed
 * path; see auth-redirect.spec.ts for the redirect flows shared by both.
 */
test.describe("CSR compose", () => {
  test("/login renders the auth plugin's sign-in page client-side", async ({ page }) => {
    const consoleMarks: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[Hydrate]")) consoleMarks.push(text);
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const signInHeading = page.getByTestId("login.heading");
    await expect(signInHeading).toBeVisible({ timeout: 15000 });
    await expect(signInHeading).toHaveText("Sign in to CityNode");

    // The payload must be present client-side with the auth remote registered.
    const compose = await page.evaluate(() => {
      const config = (
        window as {
          __RUNTIME_CONFIG__?: {
            ui?: { compose?: { remotes?: Array<{ key: string; entry: string }> } };
          };
        }
      ).__RUNTIME_CONFIG__;
      return config?.ui?.compose ?? null;
    });
    expect(compose, "CSR shell must carry a compose payload").toBeTruthy();
    const authRemote = compose!.remotes?.find((remote) => remote.key === "auth");
    expect(authRemote, "auth ui remote must be in the payload").toBeTruthy();

    // The runtime registers the remote via its mf-manifest.json (the entry
    // URL's remoteEntry.js is rewritten to it in hydrate) — that manifest
    // fetch is the exact point the client compose previously failed.
    const manifestUrl = authRemote!.entry.replace(/\/?remoteEntry\.js$/, "/mf-manifest.json");
    const entryStatus = await page.evaluate(async (url: string) => {
      const response = await fetch(url, { method: "GET" });
      return response.status;
    }, manifestUrl);
    expect(entryStatus, `auth mf-manifest at ${manifestUrl}`).toBe(200);

    // The tree was constructed from core + auth manifests (2 sources). The
    // progress array is the reliable signal: mark() only console-logs in DEV
    // builds, and the no-watch regression stack serves a production build.
    const progress = await page.evaluate(
      () => (window as { __CLIENT_PROGRESS__?: string[] }).__CLIENT_PROGRESS__ ?? [],
    );
    const constructed = progress.find((mark) => mark.includes("tree constructed"));
    expect(
      constructed,
      `expected a "tree constructed" mark, got: ${progress.join(" | ")}`,
    ).toBeTruthy();

    const failed =
      consoleMarks.find((mark) => mark.includes("Client compose failed")) ??
      progress.find((mark) => mark.includes("CLIENT COMPOSE ERROR"));
    expect(failed, "client compose must not fail").toBeUndefined();
  });

  test("a static plugin route beats the dynamic $accountId route", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("login.heading")).toBeVisible({ timeout: 15000 });
    const pathname = new URL(page.url()).pathname;
    expect(pathname).toBe("/login");
  });

  test("an account path renders the account page, not the sign-in page", async ({ page }) => {
    await page.goto("/regression-no-account.near", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const pathname = new URL(page.url()).pathname;
    expect(pathname, "account path must not redirect to /login").toBe(
      "/regression-no-account.near",
    );
    await expect(page.getByTestId("login.heading")).toHaveCount(0);
  });
});

test.describe("CSR compose CSP", () => {
  test("loading the composed app raises no securitypolicyviolation", async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __CSP_VIOLATIONS__?: string[] }).__CSP_VIOLATIONS__ = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        const violations = (window as { __CSP_VIOLATIONS__?: string[] }).__CSP_VIOLATIONS__ ?? [];
        const target = event.target as HTMLElement | null;
        violations.push(
          [
            event.violatedDirective,
            // An empty blockedURL (e.g. an <img src=""> resolving to the
            // document) renders as "#document" via the target fallback —
            // keep both so the real source is always visible.
            `blocked=${event.blockedURL || "(empty)"}`,
            `at=${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
            `target=${target?.tagName ?? "?"}${target?.outerHTML ? ` ${target.outerHTML.slice(0, 120)}` : ""}`,
          ].join(" "),
        );
      });
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("login.heading")).toBeVisible({ timeout: 15000 });

    const violations = await page.evaluate(
      () => (window as { __CSP_VIOLATIONS__?: string[] }).__CSP_VIOLATIONS__ ?? [],
    );
    expect(violations, `CSP violations: ${violations.join("; ")}`).toEqual([]);
  });
});
