/**
 * Shared build surface for ui plugins (dual MF targets).
 *
 * Shared dependencies (react, react-dom, the orpc client/contract pair, the
 * TanStack query/router pair, lingui, and the everything-dev session/i18n
 * subpath modules) come from the SharedDependencySpec — the canonical list in
 * `every-plugin/shared-deps-spec` — resolved from the building workspace's
 * installed versions so a mismatch fails the build instead of loading a
 * second React. Consumers (plugin remotes) set `import: false` — no bundled
 * fallback copy, the provider (core ui) provides through the share scope
 * only.
 *
 * `CORE_UI_DEPLOY_FIELDS` names the bos.config.json fields the publish
 * writes deploy URLs back to.
 *
 * A ui source's rsbuild.config.ts mirrors ui/rsbuild.config.ts with these
 * helpers: the web target is an MF remote exposing `./routeConfig` (the
 * generated import map); the node target is a commonjs container exposing
 * `./routeConfig` with the `@module-federation/node` runtime plugin and
 * `autoCodeSplitting` off.
 */

import fs from "node:fs";
import path from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import { PLUGIN_UI_SHARED_EXPOSES } from "../../ui/manifest/contract";
import { type UiManifestGenPluginOptions, uiManifestGenPlugin } from "./manifest-plugin";

export { type CoreUiRsbuildConfigInput, createCoreUiRsbuildConfig } from "./factory";
export {
  ensureGeneratedCoreUiRsbuildConfig,
  ensureGeneratedUiRsbuildConfig,
  hasCoreUiWorkspace,
  hasFolderFormUi,
} from "./generated-config";
export {
  type HashArtifactsPluginOptions,
  hashArtifactsPlugin,
} from "./hash-artifacts-plugin";
export {
  createUiRsbuildConfig,
  sanitizeContainerName,
  type UiRsbuildConfigOptions,
} from "./rsbuild-config";
export type { UiManifestGenPluginOptions };
export { uiManifestGenPlugin };

export interface UiDeployFields {
  urlField: string;
  integrityField: string;
  ssrUrlField?: string;
  ssrIntegrityField?: string;
}

/** Core shell field paths — unchanged from the v1 remote. */
export const CORE_UI_DEPLOY_FIELDS: UiDeployFields = {
  urlField: "app.ui.production",
  integrityField: "app.ui.integrity",
  ssrUrlField: "app.ui.ssr",
  ssrIntegrityField: "app.ui.ssrIntegrity",
};

/** Canonical exposes every manifest-composed ui source ships. */
export { PLUGIN_UI_SHARED_EXPOSES };

/**
 * Part of the plugin build contract, not per-plugin config: container chunks
 * must resolve against the origin that served the remote entry. rsbuild's MF
 * manifest stamps an absolute dev-server publicPath into metaData — rewrite
 * it to `auto` after the node environment compiles so runtime resolution
 * stays origin-relative.
 */
export function restoreManifestPublicPath(distRoot: string): RsbuildPlugin {
  return {
    name: "restore-manifest-public-path",
    setup(api) {
      api.onAfterEnvironmentCompile(({ environment, stats }) => {
        if (!stats || stats.hasErrors() || environment.name !== "node") return;
        const manifestPath = path.resolve(distRoot, "mf-manifest.json");
        if (!fs.existsSync(manifestPath)) return;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.metaData?.publicPath && manifest.metaData.publicPath !== "auto") {
          manifest.metaData.publicPath = "auto";
          fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        }
      });
    },
  };
}

export {
  CORE_UI_PLUGIN_KEY,
  MANIFEST_FILENAME,
  ROUTE_CONFIG_FILENAME,
  UI_REMOTE_ENTRY_FILENAME,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "../../ui/manifest/contract";
