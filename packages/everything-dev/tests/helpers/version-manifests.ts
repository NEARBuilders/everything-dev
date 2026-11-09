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

/** A pin pointing `file` (relative to a remote base) at these exact bytes. */
export function pinFor(
  file: string,
  shared: Record<string, string>,
): { manifest: string; integrity: string } {
  return { manifest: file, integrity: computeManifestSri(versionManifestText(shared)) };
}

/** A `fetch` serving JSON documents from an in-memory route map — 404s
 * otherwise. Route keys are full URLs including any remote base prefix. */
export const versionManifestFetcher: (routes: Record<string, string>) => typeof fetch = (routes) =>
  (async (input: Parameters<typeof fetch>[0]) => {
    const text = routes[String(input)];
    return new Response(text ?? "", { status: text === undefined ? 404 : 200 });
  }) as typeof fetch;
