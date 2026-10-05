import { readFileSync } from "node:fs";
import { buildMfCoreSharedDependencies, type CoreSharedDepName } from "../shared-deps-spec";

declare const __EVERY_PLUGIN_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    // Not createRequire(import.meta.url): under tsx the require's resolution
    // base can come up empty in spawned child processes ("Cannot find module
    // from ''"), reading 0.0.0 and tripping the shared-identity check.
    return (
      JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as {
        version: string;
      }
    ).version;
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

export const MF_CORE_SHARED_DEPS = buildMfCoreSharedDependencies({ ownVersion: PLUGIN_VERSION });

export type { CoreSharedDepName };
