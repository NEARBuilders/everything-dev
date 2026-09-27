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

export const EFFECT_CRITICAL_SHARED_DEPS = [
  "every-plugin",
  "effect",
  "@orpc/contract",
  "@orpc/client",
  "@orpc/server",
  "@orpc/experimental-effect",
] as const;

export type EffectCriticalSharedDepName = (typeof EFFECT_CRITICAL_SHARED_DEPS)[number];

export function isEffectCriticalSharedDep(name: string): boolean {
  return (EFFECT_CRITICAL_SHARED_DEPS as readonly string[]).includes(name);
}

export function strictShareConfigFor(
  name: string,
  version: string,
): Omit<SharedDependencyConfig, "version"> {
  return isEffectCriticalSharedDep(name)
    ? { ...DEFAULT_SHARE_CONFIG, requiredVersion: version, strictVersion: true }
    : DEFAULT_SHARE_CONFIG;
}

function extractExactVersion(input: string): string {
  const match = input.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : input.replace(/^[\^~>=<\s]+/, "");
}

export function getInstalledSharedDepVersion(packageName: string, fallbackVersion: string): string {
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

function getInstalledPackageVersion(packageName: string, fallbackVersion: string): string {
  return getInstalledSharedDepVersion(packageName, fallbackVersion);
}

type PluginSharedSources = Record<
  | "every-plugin"
  | "effect"
  | "zod"
  | "@orpc/contract"
  | "@orpc/client"
  | "@orpc/server"
  | "@orpc/openapi"
  | "@orpc/experimental-effect"
  | "@orpc/publisher",
  { version: string }
>;

const sharedDepSources = {
  "every-plugin": { version: pkg.version },
  effect: { version: getInstalledPackageVersion("effect", pkg.peerDependencies.effect) },
  zod: { version: getInstalledPackageVersion("zod", pkg.peerDependencies.zod) },
  "@orpc/contract": {
    version: getInstalledPackageVersion("@orpc/contract", pkg.peerDependencies["@orpc/contract"]),
  },
  "@orpc/client": {
    version: getInstalledPackageVersion("@orpc/client", pkg.peerDependencies["@orpc/client"]),
  },
  "@orpc/server": {
    version: getInstalledPackageVersion("@orpc/server", pkg.peerDependencies["@orpc/server"]),
  },
  "@orpc/openapi": {
    version: getInstalledPackageVersion(
      "@orpc/openapi",
      (pkg.peerDependencies as Record<string, string>)["@orpc/openapi"] ?? "latest",
    ),
  },
  "@orpc/experimental-effect": {
    version: getInstalledPackageVersion(
      "@orpc/experimental-effect",
      (pkg.dependencies as Record<string, string>)["@orpc/experimental-effect"] ?? "latest",
    ),
  },
  "@orpc/publisher": {
    version: getInstalledPackageVersion(
      "@orpc/publisher",
      (pkg.dependencies as Record<string, string>)["@orpc/publisher"] ?? "latest",
    ),
  },
} satisfies PluginSharedSources;

export const pluginSharedDependencies: SharedDependencies = Object.fromEntries(
  Object.entries(sharedDepSources).map(([name, source]) => [
    name,
    { version: source.version, ...strictShareConfigFor(name, source.version) },
  ]),
) as SharedDependencies;

export type PluginSharedDependencyName = keyof typeof sharedDepSources;

export function getPluginSharedDependencies(): SharedDependencies {
  return pluginSharedDependencies;
}

export function getMajorMinorVersion(version: string): string {
  const clean = version.replace(/^[\^~>=<]+/, "");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return "^0.0.0";
  const [, major, minor, patch, prerelease] = match;
  if (prerelease) return `^${major}.${minor}.${patch}-${prerelease}`;
  return `^${major}.${minor}.0`;
}
