/**
 * Hermetic unit/integration tests: real outbound network is a bug — it makes
 * tests pass or fail with the office wifi and hides the seam they should
 * control. This guard replaces globalThis.fetch for the whole vitest run:
 * loopback targets (local server fixtures) pass through to the real fetch;
 * anything else throws with the offending URL and the way out. Tests that
 * intentionally exercise network stub at that same seam before the call —
 * `vi.stubGlobal("fetch", ...)`, a mock of `utils/http-client`, or an
 * injected `fetch` parameter — and are unaffected.
 */

const realFetch = globalThis.fetch;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

const guardedFetch: typeof globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (!parsed || !isLoopback(parsed)) {
    throw new Error(
      `[hermetic tests] outbound network blocked: ${url} — stub the fetch seam ` +
        `(vi.stubGlobal("fetch", ...), mock utils/http-client, or inject the fetch ` +
        "parameter) instead of reaching for the real network",
    );
  }
  return realFetch(input, init);
};

globalThis.fetch = guardedFetch;
