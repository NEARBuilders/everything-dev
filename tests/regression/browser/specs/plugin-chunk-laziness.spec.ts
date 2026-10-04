import { expect, test } from "@playwright/test";

/**
 * Plugin route laziness pin (ADR 0024 / ADR 0008's flagged coupling): in a
 * composed app, a plugin route's heavy code must load ON NAVIGATION, not at
 * compose. The build's code-splitter already defers the five heavy keys
 * (loader, component, pending/error/notFound components) into per-match
 * chunks; composition pulls only each route's eager policy module. This spec
 * proves the end-to-end behavior in a real stack: boot the landing page
 * (compose runs, both remotes registered), then client-navigate into the
 * auth plugin's /login route and observe a NEW chunk from the auth remote's
 * origin — something only navigation could have fetched.
 *
 * Scope note: the fixture stacks' only plugin route (/login) declares
 * `ssr: false`, so this pins lazy loading through the composed CLIENT path
 * (boot + navigate) on an SSR-capable stack. The server-renders-a-plugin-
 * -route-with-lazy-chunks case has no fixture route today and stays covered
 * structurally (constructTree awaits eager modules; split chunks load per
 * match in both environments).
 */
test.describe("plugin route chunk laziness", () => {
  test("the plugin route's chunks load on navigation, not at compose", async ({ page }) => {
    await page.goto("/");

    // The compose payload names the auth remote's entry — every auth-origin
    // resource URL the page will ever fetch derives from its directory.
    const authEntry = await page.evaluate(() => {
      const config = (window as unknown as {
        __RUNTIME_CONFIG__?: {
          ui?: { compose?: { remotes?: Array<{ key: string; entry?: string }> } };
        };
      }).__RUNTIME_CONFIG__;
      const remotes = config?.ui?.compose?.remotes ?? [];
      return remotes.find((remote) => remote.key !== "ui")?.entry ?? null;
    });
    expect(authEntry, "compose payload must carry a non-core remote").toBeTruthy();

    const remoteBase = authEntry!.replace(/[^/]*$/, "");
    const authOrigin = new URL(authEntry!).origin;
    const authJsResources = () =>
      page.evaluate(
        ({ base, origin }) => {
          return performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter(
              (name) =>
                name.endsWith(".js") && (name.startsWith(base) || new URL(name).origin === origin),
            );
        },
        { base: remoteBase, origin: authOrigin },
      );

    const beforeNavigation = await authJsResources();
    expect(beforeNavigation.length, "compose must register the auth remote").toBeGreaterThan(0);

    // Client-navigate into the plugin route via the header's sign-in link.
    const signIn = page.getByTestId("public-header-signin");
    await expect(signIn).toBeVisible();
    await signIn.click();

    await expect(page.getByTestId("login.passkey-button")).toBeVisible({
      timeout: 15_000,
    });

    const afterNavigation = await authJsResources();
    const fetchedOnNavigation = afterNavigation.filter(
      (name) => !beforeNavigation.includes(name),
    );
    expect(
      fetchedOnNavigation.length,
      `navigating to the plugin route must fetch its chunks on demand (before: ${beforeNavigation.length} chunk(s), after: ${afterNavigation.length})`,
    ).toBeGreaterThan(0);
  });
});
