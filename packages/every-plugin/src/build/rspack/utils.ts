import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { remoteName } from "../../identity";

// Bare `require` only exists under bun's ESM; node ESM needs an explicit
// binding. tsx patches the module loader, so this require still loads the
// plugin.dev.ts source.
const require = createRequire(import.meta.url);

export interface PluginInfo {
  name: string;
  version: string;
  normalizedName: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

export function getPluginInfo(context: string): PluginInfo {
  const pkgPath = path.join(context, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  return {
    name: pkg.name,
    version: pkg.version,
    normalizedName: remoteName(pkg.name),
    dependencies: pkg.dependencies || {},
    peerDependencies: pkg.peerDependencies || {},
  };
}

const loadedModules = new Set<string>();

export function loadDevConfig(devConfigPath: string) {
  if (process.env.DEPLOY === "true") {
    return null;
  }

  try {
    const fullPath = path.resolve(devConfigPath);

    if (loadedModules.has(fullPath)) {
      delete require.cache[fullPath];
      const dirPath = path.dirname(fullPath);
      for (const key of Object.keys(require.cache)) {
        if (key.startsWith(dirPath) && key !== fullPath) {
          delete require.cache[key];
        }
      }
    }

    const module = require(fullPath).default;
    loadedModules.add(fullPath);
    return module;
  } catch (error) {
    console.warn(`Could not load dev config from ${devConfigPath}:`, (error as Error).message);
    return null;
  }
}

export function cleanupDevConfig() {
  for (const modulePath of loadedModules) {
    delete require.cache[modulePath];
  }
  loadedModules.clear();
}

/**
 * Resolves `dependency`'s on-disk package root (pnpm's symlinked layout), and
 * optionally `sibling`'s root beside it in the same node_modules directory —
 * so build-time resolution targets can be aliased without embedding
 * machine-specific paths in module identifiers.
 */
export function resolvePackageRoot(dependency: string, sibling?: string): string | null {
  try {
    let dir = path.dirname(require.resolve(dependency));
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, "package.json"))) break;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    if (!sibling) return dir;
    const siblingRoot = path.join(path.dirname(dir), sibling);
    return fs.existsSync(siblingRoot) ? siblingRoot : null;
  } catch {
    return null;
  }
}

/**
 * Aliases for the MF runtime's data-URI module imports. FixMfDataUriPlugin
 * strips the machine-absolute node_modules prefix from those imports (bare
 * specifiers keep the module — and therefore the module id space —
 * machine-independent); these aliases point the specifiers back at this
 * machine's on-disk copies so every build resolves identically. The node
 * runtimePlugin subpath is not in that package's exports map, so the original
 * absolute-path request only ever resolved by bypassing it.
 */
export function mfDataUriAliases(): Record<string, string> {
  const alias: Record<string, string> = {};
  const bundlerRuntimeRoot = resolvePackageRoot(
    "@module-federation/enhanced",
    "@module-federation/webpack-bundler-runtime",
  );
  if (bundlerRuntimeRoot) {
    alias["@module-federation/webpack-bundler-runtime"] = bundlerRuntimeRoot;
  }
  const nodeRoot = resolvePackageRoot("@module-federation/node");
  if (nodeRoot) {
    alias["@module-federation/node/dist/src/runtimePlugin.js"] = path.join(
      nodeRoot,
      "dist",
      "src",
      "runtimePlugin.js",
    );
  }
  return alias;
}
