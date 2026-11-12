/**
 * Cross-workspace composition contract: file names, MF expose names, and the
 * core's identity — the literals every consumer of the composed tree must
 * agree on. Browser-safe, node-safe, zero imports.
 */

/** The core ui's composition key — `bos.config.json`'s `app.ui` identity. */
export const CORE_UI_PLUGIN_KEY = "ui";

export const UI_REMOTE_ENTRY_FILENAME = "remoteEntry.js";
export const UI_REMOTE_SERVER_ENTRY_FILENAME = "remoteEntry.server.js";
export const MANIFEST_FILENAME = "manifest.gen.json";
export const ROUTE_CONFIG_FILENAME = "routeConfig.gen.ts";

/**
 * mf-manifest documents ship in two naming regimes: the fixed mutable name
 * (`mf-manifest.json`) and additive immutable hashed copies
 * (`mf-manifest.<hash>.json` — the document a version pin names). URL-shape
 * consumers must never distinguish them by exact string; these helpers are
 * the single shape authority.
 */
export const MANIFEST_DOCUMENT_PATTERN = /\/mf-manifest(?:\.[a-f0-9]{8,})?\.json(?:$|[?#])/i;

export function isManifestDocumentUrl(url: string): boolean {
  return MANIFEST_DOCUMENT_PATTERN.test(url);
}

/** The slot (or version-directory) base a manifest document is served from —
 * the directory holding the document, with a trailing slash. */
export function manifestBaseOf(url: string): string {
  const start = url.search(MANIFEST_DOCUMENT_PATTERN);
  return start < 1 ? "/" : `${url.slice(0, start)}/`;
}

/** Canonical MF exposes every manifest-composed ui source ships. */
export const UI_EXPOSES = {
  routeConfig: "./routeConfig",
  compose: "./compose",
  router: "./Router",
} as const;

/** Exposes a PLUGIN ui source ships (the core additionally exposes compose/Router). */
export const PLUGIN_UI_SHARED_EXPOSES = {
  routeConfig: UI_EXPOSES.routeConfig,
} as const;

/**
 * MF container naming rule shared by the build (rsbuild config) and runtime
 * config resolution — the host must register remotes under exactly the name
 * the built container declares. Delegates to the canonical identity module
 * (`every-plugin/identity`), which owns the derivation.
 */
export { containerName as sanitizeContainerName } from "../../identity";
