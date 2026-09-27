import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import { FixMfDataUriPlugin } from "./fix-mf-data-uri-plugin";
import {
  EmitPluginManifest,
  EveryPluginBuild,
  type EveryPluginBuildOptions,
  type PluginManifestEmitterOptions,
} from "./plugin";

export interface EveryPluginComposedBuildOptions extends EveryPluginBuildOptions {
  manifest?: PluginManifestEmitterOptions;
}

export class EveryPluginComposedBuild implements RspackPluginInstance {
  name = "EveryPluginComposedBuild";

  constructor(private readonly options: EveryPluginComposedBuildOptions = {}) {}

  apply(compiler: Compiler) {
    new EmitPluginManifest(this.options.manifest ?? {}).apply(compiler);
    new EveryPluginBuild({ dts: this.options.dts }).apply(compiler);
    new FixMfDataUriPlugin().apply(compiler);
  }
}

export interface PluginBaseConfigOptions {
  drizzle?: boolean;
  externals?: string[];
  /** Concrete rspack fields to merge over the defaults (devtool, infrastructureLogging, ...). */
  rspack?: Partial<PluginBaseConfig>;
}

const pluginRequire = createRequire(import.meta.url);

export function findBosConfigPath(from: string = process.cwd()): string | null {
  let current = path.resolve(from);
  while (true) {
    const candidate = path.join(current, "bos.config.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadDrizzleMigrationsPlugin(): ((...args: unknown[]) => unknown) | null {
  try {
    const mod = pluginRequire("@proj-airi/unplugin-drizzle-orm-migrations/rspack");
    return (mod as { default?: (...args: unknown[]) => unknown }).default ?? mod;
  } catch {
    return null;
  }
}

export interface PluginBaseConfig {
  externals: string[];
  devtool: false | "source-map";
  plugins: unknown[];
  infrastructureLogging: { level: "error" };
  stats: "errors-warnings";
}

export function createPluginBaseConfig(options: PluginBaseConfigOptions = {}): PluginBaseConfig {
  const shouldDeploy = process.env.DEPLOY === "true";
  const plugins: unknown[] = [new EveryPluginComposedBuild({ dts: false })];

  if (options.drizzle !== false) {
    const drizzlePlugin = loadDrizzleMigrationsPlugin();
    if (drizzlePlugin) {
      plugins.push(drizzlePlugin());
    } else if (options.drizzle === true) {
      throw new Error(
        "createPluginBaseConfig({ drizzle: true }) requires @proj-airi/unplugin-drizzle-orm-migrations to be installed.",
      );
    }
  }

  return {
    ...options.rspack,
    externals: options.externals ?? options.rspack?.externals ?? ["pg", "@electric-sql/pglite"],
    devtool: options.rspack?.devtool ?? (shouldDeploy ? false : "source-map"),
    plugins,
    infrastructureLogging: options.rspack?.infrastructureLogging ?? { level: "error" },
    stats: options.rspack?.stats ?? "errors-warnings",
  };
}
