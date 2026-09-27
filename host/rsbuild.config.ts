import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { getPluginSharedDependencies } from "every-plugin/build/rspack";

const __dirname = import.meta.dirname;
const require = createRequire(import.meta.url);

const resolvedConfigPath = path.resolve(__dirname, "../.bos/bos.resolved-config.json");
const rootBosConfigPath = path.resolve(__dirname, "../bos.config.json");
const configPath =
  process.env.BOS_CONFIG_PATH ??
  (fs.existsSync(resolvedConfigPath) ? resolvedConfigPath : rootBosConfigPath);

const bosConfigRaw = JSON.parse(fs.readFileSync(configPath, "utf8"));
const bosConfig = bosConfigRaw._resolved
  ? (() => {
      const { _resolved, ...data } = bosConfigRaw;
      return data;
    })()
  : bosConfigRaw;

function mergeSharedMaps(
  ...maps: Array<Record<string, Record<string, unknown>> | undefined>
): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [name, config] of Object.entries(map)) {
      const existing = merged[name];
      if (existing && !isSameSharedConfig(existing, config)) {
        throw new Error(`Conflicting shared dependency "${name}" in host build config`);
      }
      merged[name] = config;
    }
  }
  return merged;
}

function normalizeSharedConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    version: config.version,
    requiredVersion: config.requiredVersion ?? false,
    singleton: config.singleton ?? false,
    strictVersion: config.strictVersion ?? false,
    eager: config.eager ?? false,
    shareScope: config.shareScope ?? "default",
  };
}

function isSameSharedConfig(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = normalizeSharedConfig(a);
  const right = normalizeSharedConfig(b);
  return (
    left.version === right.version &&
    left.requiredVersion === right.requiredVersion &&
    left.singleton === right.singleton &&
    left.strictVersion === right.strictVersion &&
    left.eager === right.eager &&
    left.shareScope === right.shareScope
  );
}

function collectPluginShared(): Record<string, Record<string, unknown>> {
  const plugins =
    bosConfig.plugins && typeof bosConfig.plugins === "object" ? bosConfig.plugins : {};
  const shared: Record<string, Record<string, unknown>> = {};

  for (const plugin of Object.values(plugins as Record<string, unknown>)) {
    if (!plugin || typeof plugin !== "object") continue;
    const sharedDeps = (plugin as { shared?: Record<string, Record<string, unknown>> }).shared;
    if (sharedDeps && typeof sharedDeps === "object") {
      for (const [name, config] of Object.entries(sharedDeps)) {
        const existing = shared[name];
        if (existing && !isSameSharedConfig(existing, config)) {
          throw new Error(`Conflicting shared dependency "${name}" across plugins in host build`);
        }
        shared[name] = config;
      }
    }
  }

  return shared;
}

const everyPluginShared = getPluginSharedDependencies();
const pluginShared: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(everyPluginShared).map(([name, config]) => [name, { ...config }]),
);
const shared = mergeSharedMaps(
  (bosConfig.app?.api as { shared?: Record<string, Record<string, unknown>> } | undefined)?.shared,
  (bosConfig.app?.auth as { shared?: Record<string, Record<string, unknown>> } | undefined)?.shared,
  collectPluginShared(),
  pluginShared,
);

const plugins = [pluginReact()];

export default defineConfig({
  plugins,
  source: {
    entry: {
      index: "./src/program.ts",
    },
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
  dev: {
    progressBar: false,
  },
  tools: {
    rspack: {
      target: "async-node",
      optimization: {
        nodeEnv: false,
      },
      output: {
        uniqueName: "host",
        library: { type: "commonjs-module" },
      },
      externals: [/^node:/, /^bun:/],
      resolve: {
        fallback: { bufferutil: false, "utf-8-validate": false },
      },
      infrastructureLogging: {
        level: "error",
      },
      stats: "errors-warnings",
      ignoreWarnings: [
        {
          module: /node_modules[\\/]@module-federation/,
          message: /Critical dependency/,
        },
      ],
      plugins: [
        new ModuleFederationPlugin({
          name: "host",
          filename: "remoteEntry.js",
          dts: false,
          runtimePlugins: [require.resolve("@module-federation/node/runtimePlugin")],
          library: { type: "commonjs-module" },
          exposes: {
            "./Server": "./src/program.ts",
          },
          shared,
        }),
      ],
    },
  },
  output: {
    minify: false,
    distPath: {
      root: "dist",
    },
    assetPrefix: "/",
    filename: {
      js: "[name].js",
    },
  },
});
