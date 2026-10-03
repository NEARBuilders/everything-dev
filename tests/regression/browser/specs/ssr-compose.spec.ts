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
    // auth remote through the payload's own identity: each remote's key must
    // match one of the embedded manifest names (the composition identity),
    // never a config label, which is an implementation detail.
    const configMatch = html.match(/window\.__RUNTIME_CONFIG__=(\{.*?\});\s*function __hydrate/s);
    expect(configMatch, "runtime config must be embedded for hydration").toBeTruthy();
    const config = JSON.parse(configMatch![1]) as {
      ui?: {
        compose?: {
          remotes?: Array<{ key: string; entry?: string }>;
          manifests?: Array<{ name: string }>;
        };
      };
    };
    const manifestNames = new Set((config.ui?.compose?.manifests ?? []).map((m) => m.name));
    const authRemote = config.ui?.compose?.remotes?.find((remote) => manifestNames.has(remote.key));
    expect(
      authRemote,
      "compose payload must include a remote keyed by a manifest name",
    ).toBeTruthy();
    expect(manifestNames.size, "payload must embed both core and auth manifests").toBe(2);
    // Dev stacks serve the fixed dev entry; pinned (start) stacks serve the
    // content-hashed entry derived from the slot's version manifest.
    expect(authRemote?.entry, "auth remote must point at a remoteEntry").toMatch(
      /\/remoteEntry(\.[a-f0-9]+)?\.js$/,
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
