import { createRequire } from "node:module";
import { buildMfCoreSharedDependencies, type CoreSharedDepName } from "../shared-deps-spec";

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

export const MF_CORE_SHARED_DEPS = buildMfCoreSharedDependencies({ ownVersion: PLUGIN_VERSION });

export type { CoreSharedDepName };
