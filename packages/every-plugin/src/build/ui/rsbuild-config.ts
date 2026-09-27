import path from "node:path";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { defineConfig, type EnvironmentConfig, type RsbuildConfig, rspack } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { TanStackRouterRspack } from "@tanstack/router-plugin/rspack";
import { FixMfDataUriPlugin } from "../../build/rspack";
import { sanitizeContainerName } from "../../ui/manifest/contract";
import {
  createUiSharedDeps,
  MANIFEST_FILENAME,
  restoreManifestPublicPath,
  UI_REMOTE_ENTRY_FILENAME,
  UI_REMOTE_SERVER_ENTRY_FILENAME,
} from "./index";
import { uiManifestGenPlugin } from "./manifest-plugin";

/**
 * The full dual-environment rsbuild config for a manifest-composed ui source
 * (ADR 0008 §7 — the plugin build contract, not per-plugin config). The core
 * ui and every plugin ui source build from this one factory: `web` emits the
 * browser remote, `node` the commonjs SSR container; shared deps are strict
 * singletons in the given role.
 */
export interface UiRsbuildConfigOptions {
  /** the ui source root — contains package.json, src/, and the routes dir */
  workspaceRoot: string;
  /** the ui workspace's package.json (shared-dep version resolution) */
  pkg: {
    name: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  /** core provides the shared singletons; plugin remotes consume (`import: false`) */
  role: "provider" | "consumer";
  /** the composition key written into manifest.gen.json (the config-side key) */
  manifestName: string;
  devPort: number;
  webEntry: string;
  webExposes: Record<string, string>;
  nodeEntry: string;
  nodeExposes: Record<string, string>;
  copy?: Array<{ from: string; to: string }>;
  define?: Record<string, string>;
  /** routes dir relative to the rsbuild cwd — folder-form ui sources live at
   * `ui/src/routes` while the build runs from the plugin root */
  routesDirectory?: string;
}

export { sanitizeContainerName };

/**
 * The node environment never owns the routeTree write: the web env's
 * generator produces identical content, and both environments resolve the
 * same on-disk tree. Redirecting the node write to scratch removes the
 * concurrent-writers race on src/routeTree.gen.ts (the generator's
 * "Cannot overwrite" retry noise).
 */
const NODE_ROUTE_TREE_SCRATCH = "./node_modules/.cache/manifest-compose/routeTree.node.gen.ts";

export function createUiRsbuildConfig(options: UiRsbuildConfigOptions): RsbuildConfig {
  const {
    workspaceRoot,
    pkg,
    role,
    manifestName,
    devPort,
    webEntry,
    webExposes,
    nodeEntry,
    nodeExposes,
    copy = [],
    define,
    routesDirectory,
  } = options;
  const workspaceRootAbsolute = path.resolve(workspaceRoot);
  const normalizedName = sanitizeContainerName(pkg.name);
  const manifestGen = () =>
    uiManifestGenPlugin({ workspaceRoot: workspaceRootAbsolute, pluginName: manifestName });
  const uiSharedDeps = createUiSharedDeps(pkg, { role, workspaceRoot: workspaceRootAbsolute });

  const webEnvironment: EnvironmentConfig = {
    plugins: [
      pluginReact(),
      manifestGen(),
      pluginModuleFederation(
        {
          name: normalizedName,
          filename: UI_REMOTE_ENTRY_FILENAME,
          dts: false,
          exposes: webExposes,
          shared: uiSharedDeps,
        },
        { environment: "web" },
      ),
    ],
    source: { entry: { index: webEntry }, ...(define ? { define } : {}) },
    resolve: { alias: { "@": path.join(workspaceRootAbsolute, "src") } },
    tools: {
      rspack: (config) => {
        const cssPlugin = config.plugins?.find((p) => p instanceof rspack.CssExtractRspackPlugin) as
          | { options?: Record<string, string> }
          | undefined;
        if (cssPlugin) {
          cssPlugin.options ??= {};
          cssPlugin.options.chunkFilename = "static/css/async/[name].[contenthash].css";
        }
        Object.assign(config, {
          target: "web",
          output: {
            ...config.output,
            publicPath: "auto",
            uniqueName: normalizedName,
            chunkFilename: "static/js/async/[name].[contenthash].js",
            crossOriginLoading: "anonymous",
          },
          resolve: {
            ...config.resolve,
            fallback: { bufferutil: false, "utf-8-validate": false },
          },
          infrastructureLogging: { level: "error" },
          stats: "errors-warnings",
          plugins: [
            ...(config.plugins ?? []),
            TanStackRouterRspack({
              target: "react",
              autoCodeSplitting: true,
              routeFileIgnorePattern: "\\.(test|spec)\\.(ts|tsx)$",
              ...(routesDirectory ? { routesDirectory } : {}),
            }),
            new FixMfDataUriPlugin(),
          ],
        });
        return config;
      },
    },
    output: {
      // Absolute: the ui source root owns dist even when the build cwd is the
      // parent plugin workspace (folder-form ui sources).
      distPath: {
        root: path.join(workspaceRootAbsolute, "dist"),
        css: "static/css",
        js: "static/js",
      },
      assetPrefix: "auto",
      filename: { js: "[name].js", css: "style.css" },
      copy: [
        ...copy,
        { from: path.join(workspaceRootAbsolute, "src", MANIFEST_FILENAME), to: "./" },
      ],
    },
  };

  // Dev without SSR skips the node environment: it exists for the host's dev
  // SSR container and nothing else. Builds always emit both.
  const includeNodeEnv =
    process.env.BOS_SSR === "1" ||
    process.env.DEPLOY === "true" ||
    process.env.NODE_ENV !== "development";

  const nodeEnvironment: EnvironmentConfig = {
    plugins: [
      pluginReact(),
      manifestGen(),
      pluginModuleFederation(
        {
          name: normalizedName,
          filename: UI_REMOTE_SERVER_ENTRY_FILENAME,
          dts: false,
          exposes: nodeExposes,
          shared: uiSharedDeps,
        },
        { target: "node", environment: "node" },
      ),
      restoreManifestPublicPath(path.resolve(workspaceRootAbsolute, "dist", "ssr")),
    ],
    source: { entry: { index: nodeEntry } },
    resolve: {
      alias: {
        "@": path.join(workspaceRootAbsolute, "src"),
        "@tanstack/react-devtools": false,
        "@tanstack/react-router-devtools": false,
      },
    },
    tools: {
      rspack: (config) => {
        Object.assign(config, {
          output: { ...config.output, uniqueName: `${normalizedName}_server` },
          resolve: {
            ...config.resolve,
            fallback: { bufferutil: false, "utf-8-validate": false },
          },
          externals: [/^node:/],
          infrastructureLogging: { level: "error" },
          stats: "errors-warnings",
          plugins: [
            ...(config.plugins ?? []),
            TanStackRouterRspack({
              target: "react",
              autoCodeSplitting: false,
              routeFileIgnorePattern: "\\.(test|spec)\\.(ts|tsx)$",
              generatedRouteTree: NODE_ROUTE_TREE_SCRATCH,
              ...(routesDirectory ? { routesDirectory } : {}),
            }),
            new FixMfDataUriPlugin(),
          ],
        });
        return config;
      },
    },
    // Absolute, like the web dist above — the node container must land in the
    // ui source root's dist/ssr where the host's local container server looks.
    output: { distPath: { root: path.join(workspaceRootAbsolute, "dist", "ssr") } },
  };

  return defineConfig({
    environments: {
      web: webEnvironment,
      ...(includeNodeEnv ? { node: nodeEnvironment } : {}),
    },
    dev: {
      lazyCompilation: false,
      progressBar: false,
      writeToDisk: true,
      client: { overlay: false },
    },
    server: {
      port: Number(process.env.PORT) || devPort,
      printUrls: ({ urls }) => urls.filter((url) => url.includes("localhost")),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    },
  });
}
