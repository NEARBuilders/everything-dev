import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let pkg: typeof import("../../package.json");

try {
  pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
} catch {
  pkg = require("every-plugin/package.json");
}

export interface SharedDependencyConfig {
  version: string;
  requiredVersion: string | false;
  singleton: boolean;
  strictVersion: boolean;
  eager: boolean;
  shareScope: string;
}

export type SharedDependencies = Record<string, SharedDependencyConfig>;

const DEFAULT_SHARE_CONFIG: Omit<SharedDependencyConfig, "version"> = {
  requiredVersion: false,
  singleton: true,
  strictVersion: false,
  eager: false,
  shareScope: "default",
};

function extractExactVersion(input: string): string {
  const match = input.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : input.replace(/^[\^~>=<\s]+/, "");
}

function getInstalledPackageVersion(packageName: string, fallbackVersion: string): string {
  try {
    let currentDir = dirname(require.resolve(packageName));
    for (let i = 0; i < 5; i += 1) {
      const packageJsonPath = join(currentDir, "package.json");
      if (existsSync(packageJsonPath)) {
        return (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string }).version;
      }
      currentDir = dirname(currentDir);
    }

    throw new Error(`Could not resolve installed version for ${packageName}`);
  } catch {
    return extractExactVersion(fallbackVersion);
  }
}

export const pluginSharedDependencies = {
  "every-plugin": { version: pkg.version, ...DEFAULT_SHARE_CONFIG },
  effect: {
    version: getInstalledPackageVersion("effect", pkg.peerDependencies.effect),
    ...DEFAULT_SHARE_CONFIG,
  },
  zod: {
    version: getInstalledPackageVersion("zod", pkg.peerDependencies.zod),
    ...DEFAULT_SHARE_CONFIG,
  },
  "@orpc/contract": {
    version: getInstalledPackageVersion("@orpc/contract", pkg.peerDependencies["@orpc/contract"]),
    ...DEFAULT_SHARE_CONFIG,
  },
  "@orpc/client": {
    version: getInstalledPackageVersion("@orpc/client", pkg.peerDependencies["@orpc/client"]),
    ...DEFAULT_SHARE_CONFIG,
  },
  "@orpc/server": {
    version: getInstalledPackageVersion("@orpc/server", pkg.peerDependencies["@orpc/server"]),
    ...DEFAULT_SHARE_CONFIG,
  },
} satisfies SharedDependencies;

export type PluginSharedDependencyName = keyof typeof pluginSharedDependencies;

export function getPluginSharedDependencies(): SharedDependencies {
  return pluginSharedDependencies;
}

export function getPluginSharedDependenciesVersionRange(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getPluginSharedDependencies()).map(([name, config]) => [
      name,
      getMajorMinorVersion(config.version),
    ]),
  );
}

export function getMajorMinorVersion(version: string): string {
  const clean = version.replace(/^[\^~>=<]+/, "");
  const match = clean.match(/^(\d+)\.(\d+)/);
  if (!match) return "^0.0.0";
  return `^${match[1]}.${match[2]}.0`;
}
