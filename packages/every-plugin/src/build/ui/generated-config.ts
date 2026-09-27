import fs from "node:fs";
import path from "node:path";
import { findBosConfigPath } from "../rspack/compose";
import { getPluginInfo } from "../rspack/utils";

const UI_DIR = "ui";
const GENERATED_CONFIG_DIR = ".every-plugin";
const GENERATED_UI_CONFIG = "ui.rsbuild.config.generated.mjs";

/**
 * Folder-form UI source: a `ui/` directory with route files but no own
 * package.json — the plugin workspace owns the build (single-workspace
 * plugin, one dev process, one deploy train). Workspace-form ui sources
 * (own package.json + scripts) are NOT managed here.
 */
export function hasFolderFormUi(cwd: string): boolean {
  const uiDir = path.join(cwd, UI_DIR);
  return (
    fs.existsSync(path.join(uiDir, "src", "routes")) &&
    !fs.existsSync(path.join(uiDir, "package.json"))
  );
}

function generatedUiConfig(pluginId: string): string {
  return `import path from "node:path";
import { createUiRsbuildConfig } from "every-plugin/build/ui";
import pkg from "../package.json";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "ui");

export default createUiRsbuildConfig({
  workspaceRoot,
  pkg,
  role: "consumer",
  manifestName: ${JSON.stringify(pluginId)},
  devPort: Number(process.env.BOS_UI_PORT) || 0,
  webEntry: "./ui/src/routeConfig.gen.ts",
  webExposes: { "./routeConfig": "./ui/src/routeConfig.gen.ts" },
  nodeEntry: "./ui/src/routeConfig.gen.ts",
  nodeExposes: { "./routeConfig": "./ui/src/routeConfig.gen.ts" },
  routesDirectory: "./ui/src/routes",
});
`;
}

/**
 * Synthesize the rsbuild config for a folder-form ui source (the plugin
 * build contract, not per-plugin config — mirrors the rspack generated
 * config). Returns the config file path, or null when the workspace has no
 * folder-form ui source.
 */
export function ensureGeneratedUiRsbuildConfig(cwd: string): string | null {
  if (!hasFolderFormUi(cwd)) return null;
  const bosConfigPath = findBosConfigPath(cwd);
  const outDir = path.join(cwd, GENERATED_CONFIG_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, GENERATED_UI_CONFIG);
  // Canonical plugin key: the config-layout id (plugins/<id>) — the same key
  // the runtime config and composition use. plugin.dev.ts's pluginId is the
  // npm name, which does not match the composition keying.
  const layoutKey =
    bosConfigPath && path.relative(path.dirname(bosConfigPath), cwd).startsWith("plugins/")
      ? path.relative(path.dirname(bosConfigPath), cwd).split(path.sep)[1]?.split(path.sep)[0]
      : undefined;
  const pluginId = layoutKey ?? getPluginInfo(cwd).normalizedName;
  const next = generatedUiConfig(pluginId);
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== next) {
    fs.writeFileSync(outPath, next);
  }
  return outPath;
}

const CORE_UI_MARKERS = {
  routes: "src/routes",
  entry: "src/entry.ts",
  contract: "src/contract.ts",
};

/**
 * Workspace-form core ui: the workspace IS the ui (own package.json, route
 * tree, web entry) and is not plugin-shaped — the /api counterpart of the
 * plugin workspace form.
 */
export function hasCoreUiWorkspace(cwd: string = process.cwd()): boolean {
  return (
    fs.existsSync(path.join(cwd, CORE_UI_MARKERS.routes)) &&
    fs.existsSync(path.join(cwd, CORE_UI_MARKERS.entry)) &&
    !fs.existsSync(path.join(cwd, CORE_UI_MARKERS.contract)) &&
    !fs.existsSync(path.join(cwd, "plugin.dev.ts"))
  );
}

function generatedCoreUiConfig(): string {
  return `import { defineConfig } from "@rsbuild/core";
import { readAuthoredConfigInput } from "everything-dev/config";
import { createCoreUiRsbuildConfig } from "every-plugin/build/ui";

export default defineConfig(async () =>
  createCoreUiRsbuildConfig(await readAuthoredConfigInput()),
);
`;
}

/**
 * Synthesize the rsbuild config for a workspace-form core ui with no local
 * `rsbuild.config.ts` — the /api generated-config model. A local file is an
 * override and wins untouched. Returns the workspace-relative config path,
 * or null when the workspace is not a core ui (or has a local config).
 */
export function ensureGeneratedCoreUiRsbuildConfig(cwd: string = process.cwd()): string | null {
  if (!hasCoreUiWorkspace(cwd)) return null;
  if (fs.existsSync(path.join(cwd, "rsbuild.config.ts"))) return null;
  const outDir = path.join(cwd, GENERATED_CONFIG_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, GENERATED_UI_CONFIG);
  fs.writeFileSync(outPath, generatedCoreUiConfig());
  console.log("[every-plugin] rsbuild.config.ts not found — using the core ui build factory.");
  return path.join(GENERATED_CONFIG_DIR, GENERATED_UI_CONFIG);
}
