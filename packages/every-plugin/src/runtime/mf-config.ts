import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import pkg from "../../package.json";

const require = createRequire(import.meta.url);
declare const __EVERY_PLUGIN_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    return (require("../../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function getInstalledPackageVersion(packageName: string, fallbackRange: string): string {
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
    const match = fallbackRange.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
    return match ? match[0] : fallbackRange.replace(/^[\^~>=<\s]+/, "");
  }
}

export const PLUGIN_VERSION =
  typeof __EVERY_PLUGIN_VERSION__ === "string" ? __EVERY_PLUGIN_VERSION__ : readPackageVersion();

export interface SharedConfig {
  singleton: boolean;
  requiredVersion: string | false;
  strictVersion: boolean;
  eager: boolean;
}

export const SHARE_CONFIG: SharedConfig = {
  singleton: true,
  requiredVersion: false,
  strictVersion: false,
  eager: false,
};

export const MF_CORE_SHARED_DEPS = {
  "every-plugin": {
    version: PLUGIN_VERSION,
    shareScope: "default",
    shareConfig: SHARE_CONFIG,
  },
  effect: {
    version: getInstalledPackageVersion("effect", pkg.peerDependencies.effect),
    shareScope: "default",
    shareConfig: SHARE_CONFIG,
  },
  zod: {
    version: getInstalledPackageVersion("zod", pkg.peerDependencies.zod),
    shareScope: "default",
    shareConfig: SHARE_CONFIG,
  },
  "@orpc/contract": {
    version: getInstalledPackageVersion("@orpc/contract", pkg.peerDependencies["@orpc/contract"]),
    shareScope: "default",
    shareConfig: SHARE_CONFIG,
  },
  "@orpc/client": {
    version: getInstalledPackageVersion("@orpc/client", pkg.peerDependencies["@orpc/client"]),
    shareScope: "default",
    shareConfig: SHARE_CONFIG,
  },
  "@orpc/server": {
    version: getInstalledPackageVersion("@orpc/server", pkg.peerDependencies["@orpc/server"]),
    shareScope: "default",
    shareConfig: SHARE_CONFIG,
  },
} as const;

export type CoreSharedDepName = keyof typeof MF_CORE_SHARED_DEPS;

export interface AppSharedDepConfig {
  version: string;
  requiredVersion?: string | false;
  singleton?: boolean;
  strictVersion?: boolean;
  eager?: boolean;
  shareScope?: string;
}

export type AppSharedDeps = Record<string, AppSharedDepConfig>;

export function buildMergedSharedDeps(
  appShared?: AppSharedDeps,
): Record<string, { version: string; shareScope: string; shareConfig: SharedConfig }> {
  const merged: Record<string, { version: string; shareScope: string; shareConfig: SharedConfig }> =
    {};

  for (const [name, config] of Object.entries(MF_CORE_SHARED_DEPS)) {
    merged[name] = {
      version: config.version,
      shareScope: config.shareScope,
      shareConfig: config.shareConfig,
    };
  }

  if (appShared) {
    for (const [name, config] of Object.entries(appShared)) {
      merged[name] = {
        version: config.version,
        shareScope: config.shareScope ?? "default",
        shareConfig: {
          singleton: config.singleton ?? false,
          requiredVersion: config.requiredVersion ?? false,
          strictVersion: config.strictVersion ?? false,
          eager: config.eager ?? false,
        },
      };
    }
  }

  return merged;
}
