import { createRequire } from "node:module";
import pkg from "../../package.json";
import { getInstalledSharedDepVersion, strictShareConfigFor } from "../build/shared-deps";

const require = createRequire(import.meta.url);
declare const __EVERY_PLUGIN_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    return (require("../../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
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

const coreSharedFallbacks: Record<string, string> = {
  effect: pkg.peerDependencies.effect,
  zod: pkg.peerDependencies.zod,
  "@orpc/contract": pkg.peerDependencies["@orpc/contract"],
  "@orpc/client": pkg.peerDependencies["@orpc/client"],
  "@orpc/server": pkg.peerDependencies["@orpc/server"],
  "@orpc/openapi": (pkg.peerDependencies as Record<string, string>)["@orpc/openapi"] ?? "latest",
  "@orpc/experimental-effect":
    (pkg.dependencies as Record<string, string>)["@orpc/experimental-effect"] ?? "latest",
  "@orpc/publisher": (pkg.dependencies as Record<string, string>)["@orpc/publisher"] ?? "latest",
};

const coreSharedVersions: Record<string, string> = {
  "every-plugin": PLUGIN_VERSION,
};

for (const [name, fallback] of Object.entries(coreSharedFallbacks)) {
  coreSharedVersions[name] = getInstalledSharedDepVersion(name, fallback);
}

export const MF_CORE_SHARED_DEPS: Record<
  string,
  { version: string; shareScope: string; shareConfig: SharedConfig }
> = Object.fromEntries(
  Object.entries(coreSharedVersions).map(([name, version]) => [
    name,
    {
      version,
      shareScope: "default",
      shareConfig: strictShareConfigFor(name, version) satisfies SharedConfig,
    },
  ]),
);

export type CoreSharedDepName = keyof typeof coreSharedFallbacks | "every-plugin";

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
