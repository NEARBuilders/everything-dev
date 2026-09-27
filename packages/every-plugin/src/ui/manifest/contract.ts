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
 * the built container declares. Lives here so both sides agree without
 * importing the build toolchain into runtime bundles.
 */
export const sanitizeContainerName = (pkgName: string): string =>
  pkgName.replace(/[^A-Za-z0-9_]/g, "_");
