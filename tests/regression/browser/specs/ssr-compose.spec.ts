import { expect, test } from "@playwright/test";

/**
 * SSR compose pin — the dev project boots `bos dev --ssr`, so the served HTML
 * is the host's manifest-composed render. These assertions check the raw
 * server HTML (request API — no client JS) so a compose fallback to the
 * core-only shell fails loudly. The /login route declares `ssr: false`, so
 * its value here is the compose payload embedded for client hydration; the
 * server-rendered content pin uses /about, a core route.
 */
test.describe("SSR compose", () => {
  test("served /login HTML embeds the composed payload with the auth remote", async ({
    request,
  }) => {
    const response = await request.get("/login");
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html, "page must be server-rendered").toContain("data-everything-ssr");
    expect(html, "SSR must embed a compose payload").toContain('"compose"');

    // The embedded runtime config carries the compose payload — assert the
    // auth remote by KEY, not by its MF container name (the built remote
    // registers under the sanitized package name, e.g.
    // `_everything_dev_auth_plugin`, which is an implementation detail).
    const configMatch = html.match(/window\.__RUNTIME_CONFIG__=(\{.*?\});\s*function __hydrate/s);
    expect(configMatch, "runtime config must be embedded for hydration").toBeTruthy();
    const config = JSON.parse(configMatch![1]) as {
      ui?: { compose?: { remotes?: Array<{ key: string; entry?: string }> } };
    };
    const authRemote = config.ui?.compose?.remotes?.find((remote) => remote.key === "auth");
    expect(authRemote, "compose payload must include the auth remote (key: auth)").toBeTruthy();
    expect(authRemote?.entry, "auth remote must point at a remoteEntry").toMatch(
      /\/remoteEntry\.js$/,
    );
  });

  test("a core route is server-rendered with content (not the CSR shell)", async ({ request }) => {
    const response = await request.get("/about");
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html, "page must be server-rendered").toContain("data-everything-ssr");
    expect(html, "/about content must be server-rendered").toContain("about.open-skill-link");
    expect(html, "SSR must embed a compose payload").toContain('"compose"');
  });
});
