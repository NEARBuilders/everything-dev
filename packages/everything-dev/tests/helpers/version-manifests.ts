import { computeManifestSri } from "../../src/services/deploy/manifest-verify";

/**
 * Shared Module-Federation version-manifest fixtures for the deploy-train
 * composition tests: content-shaped manifest text, pins whose SRI matches
 * the served bytes, and a fetch seam serving a route map without any socket.
 */

export function versionManifestText(shared: Record<string, string>): string {
  return JSON.stringify({
    version: "0123456789abcdef",
    entry: "remoteEntry.js",
    entryIntegrity: "sha384-AAAAAA==",
    shared,
  });
}

/** A pin pointing `file` (relative to a slot base) at these exact bytes. */
export function pinFor(
  file: string,
  shared: Record<string, string>,
): { manifest: string; integrity: string } {
  return { manifest: file, integrity: computeManifestSri(versionManifestText(shared)) };
}

/** A `fetch` serving JSON documents from an in-memory route map — 404s
 * otherwise. Route keys are full URLs including any slot base prefix. */
export const versionManifestFetcher: (routes: Record<string, string>) => typeof fetch = (routes) =>
  (async (input: Parameters<typeof fetch>[0]) => {
    const text = routes[String(input)];
    if (!text) {
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    }
    return { ok: true, status: 200, text: async () => text } as unknown as Response;
  }) as typeof fetch;
