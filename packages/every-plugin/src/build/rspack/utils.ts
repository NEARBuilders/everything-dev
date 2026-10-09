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
