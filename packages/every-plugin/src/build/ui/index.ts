/**
 * Shared build surface for ui plugins (dual MF targets).
 *
 * `createUiSharedDeps` resolves the canonical singleton shared list
 * (react, react-dom, @orpc/client, @orpc/contract, @tanstack/react-query,
 * @tanstack/react-router) with `requiredVersion` from the building
 * workspace's installed version so version mismatches fail the build —
 * the #106 guardrail extended to the react/TanStack/orpc set.
 *
 * `CORE_UI_DEPLOY_FIELDS` names the bos.config.json fields the publish
 * writes deploy URLs back to.
 *
 * A ui source's rsbuild.config.ts mirrors ui/rsbuild.config.ts with these
 * helpers: the web target is an MF remote exposing `./routeConfig` (the
 * generated import map); the node target is a commonjs container exposing
 * `./routeConfig` with the `@module-federation/node` runtime plugin and
 * `autoCodeSplitting` off. Shared deps are strict singletons; consumers
 * (plugin remotes) additionally set `import: false` — no bundled fallback
 * copy, the provider (core ui) provides through the share scope only.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import { PLUGIN_UI_SHARED_EXPOSES } from "../../ui/manifest/contract";
import { type UiManifestGenPluginOptions, uiManifestGenPlugin } from "./manifest-plugin";

const require = createRequire(import.meta.url);

export { type CoreUiRsbuildConfigInput, createCoreUiRsbuildConfig } from "./factory";
export {
  ensureGeneratedCoreUiRsbuildConfig,
  ensureGeneratedUiRsbuildConfig,
  hasCoreUiWorkspace,
  hasFolderFormUi,
} from "./generated-config";
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

const SHARE_MODULE_NAMES = [
  "react",
  "react-dom",
  "@orpc/client",
  "@orpc/contract",
  "@tanstack/react-query",
  "@tanstack/react-router",
] as const;

/**
 * The session/auth client module — the single authoritative session read
 * path (`sessionQueryOptions`, guards, post-sign-in refresh) shared by the
 * core ui and every plugin ui. Declared as a strict singleton below so
 * exactly one runtime copy exists: a mixed deploy (one remote rebuilt, the
 * other stale) can no longer run two divergent copies whose guard decisions
 * disagree ("Too many redirects").
 */
const AUTH_SESSION_SHARED_MODULE = "everything-dev/ui/auth";

export interface UiSharedDepEntry {
  version: string;
  requiredVersion: string | false;
  singleton: true;
  strictVersion: boolean;
  eager: false;
  shareScope: "default";
  /** consumer role only: no bundled fallback copy — the provider provides */
  import?: false;
}

function getInstalledVersion(pkgName: string, fallback?: string): string {
  try {
    let currentDir = path.dirname(require.resolve(pkgName));
    for (let i = 0; i < 5; i += 1) {
      const packageJsonPath = path.join(currentDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        return (JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version: string })
          .version;
      }
      currentDir = path.dirname(currentDir);
    }
    throw new Error(`unresolved: ${pkgName}`);
  } catch (error) {
    const match = fallback?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
    const resolved = match?.[0];
    if (!resolved) {
      console.warn(
        `[mf-build] Could not resolve an installed version for "${pkgName}" (${error instanceof Error ? error.message : error}); falling back to requiredVersion "*" — the strict singleton guard is disabled for this dependency`,
      );
      return "*";
    }
    return resolved;
  }
}

function extractExactVersion(input: string): string {
  const match = input.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? "";
}

/**
 * Resolves the version of a subpath-shared module's package. Subpath requests
 * like `everything-dev/ui/auth` resolve from the building workspace's own
 * dependencies (workspace symlink in the monorepo, real install in children);
 * the walk-up lands on the package root's package.json either way.
 */
function getSubpathSharedModuleVersion(
  packageName: string,
  subpath: string,
  workspaceRoot?: string,
): string | null {
  const pkgName = packageName.split("/")[0] ?? packageName;
  const candidates: Array<string> = [];
  if (workspaceRoot) {
    candidates.push(path.join(workspaceRoot, "node_modules", pkgName, "package.json"));
  }
  const resolveRequests: Array<{ request: string; paths?: string[] }> = [
    {
      request: `${packageName}/${subpath}`,
      ...(workspaceRoot ? { paths: [workspaceRoot] } : {}),
    },
    { request: `${packageName}/${subpath}` },
    {
      request: `${packageName}/package.json`,
      ...(workspaceRoot ? { paths: [workspaceRoot] } : {}),
    },
    { request: `${packageName}/package.json` },
  ];
  for (const { request, paths } of resolveRequests) {
    try {
      const resolved = require.resolve(request, paths ? { paths } : undefined);
      candidates.push(
        resolved.endsWith("package.json")
          ? resolved
          : path.resolve(path.dirname(resolved), "..", "..", "package.json"),
      );
    } catch {
      // try the next request shape
    }
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const version = (JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: string })
        .version;
      if (version) return version;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Catalog-enforced singleton shared list for ui remotes. `requiredVersion`
 * resolves from the installed package (not the declared range), so a shared
 * version mismatch fails at build time instead of loading a second React.
 * `role: "consumer"` (plugin remotes) adds `import: false` — without it the
 * container's own router copy wins and its context objects mismatch.
 */
export function createUiSharedDeps(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  options?: { strictVersion?: boolean; role?: "provider" | "consumer"; workspaceRoot?: string },
): Record<string, UiSharedDepEntry> {
  const fallbacks = { ...pkg.dependencies, ...pkg.devDependencies };
  const deps: Record<string, UiSharedDepEntry> = {};
  for (const name of SHARE_MODULE_NAMES) {
    const version = getInstalledVersion(name, fallbacks[name]);
    deps[name] = {
      version,
      requiredVersion: options?.strictVersion === false ? false : version,
      singleton: true,
      strictVersion: options?.strictVersion !== false,
      eager: false,
      shareScope: "default",
      ...(options?.role === "consumer" ? { import: false } : {}),
    };
  }

  const [packageName, subpath] = splitSubpathRequest(AUTH_SESSION_SHARED_MODULE);
  const fallback = fallbacks[packageName] ?? fallbacks[AUTH_SESSION_SHARED_MODULE];
  const version =
    getSubpathSharedModuleVersion(packageName, subpath, options?.workspaceRoot) ??
    (fallback ? extractExactVersion(fallback) : "");
  if (!version) return deps;

  deps[AUTH_SESSION_SHARED_MODULE] = {
    version,
    requiredVersion: options?.strictVersion === false ? false : version,
    singleton: true,
    strictVersion: options?.strictVersion !== false,
    eager: false,
    shareScope: "default",
    ...(options?.role === "consumer" ? { import: false } : {}),
  };
  return deps;
}

function splitSubpathRequest(request: string): [string, string] {
  const [pkgName = request, ...segments] = request.split("/");
  return [pkgName, segments.join("/")];
}
