import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { isBuildInvocation, uiEntryFilename } from "every-plugin/build/artifact-names";
import { hashArtifactsPlugin } from "every-plugin/build/ui";
import {
  getPluginSharedDependencies,
  mergeSharedMaps,
  type SharedConfigInput,
} from "every-plugin/shared-deps-spec";

const __dirname = import.meta.dirname;
const require = createRequire(import.meta.url);

const resolvedConfigPath = path.resolve(__dirname, "../.bos/bos.resolved-config.json");
const rootBosConfigPath = path.resolve(__dirname, "../bos.config.json");
const configPath = fs.existsSync(resolvedConfigPath) ? resolvedConfigPath : rootBosConfigPath;

const bosConfigRaw = JSON.parse(fs.readFileSync(configPath, "utf8"));
const bosConfig = bosConfigRaw._resolved
  ? (() => {
      const { _resolved, ...data } = bosConfigRaw;
      return data;
    })()
  : bosConfigRaw;

function collectPluginShared(): Record<string, SharedConfigInput> {
  const plugins =
    bosConfig.plugins && typeof bosConfig.plugins === "object" ? bosConfig.plugins : {};
  const shared: Record<string, SharedConfigInput> = {};

  for (const plugin of Object.values(plugins as Record<string, unknown>)) {
    if (!plugin || typeof plugin !== "object") continue;
    const sharedDeps = (plugin as { shared?: Record<string, SharedConfigInput> }).shared;
    if (sharedDeps && typeof sharedDeps === "object") {
      for (const [name, config] of Object.entries(sharedDeps)) {
        shared[name] = config;
      }
    }
  }

  return shared;
}

const everyPluginShared = getPluginSharedDependencies();
const pluginShared = Object.fromEntries(
  Object.entries(everyPluginShared).map(([name, config]) => [name, { ...config }]),
);
const shared = mergeSharedMaps(
  (bosConfig.app?.api as { shared?: Record<string, SharedConfigInput> } | undefined)?.shared,
  (bosConfig.app?.auth as { shared?: Record<string, SharedConfigInput> } | undefined)?.shared,
  collectPluginShared(),
  pluginShared,
);

const plugins = [
  pluginReact(),
  ...(isBuildInvocation()
    ? [hashArtifactsPlugin({ entryBase: "remoteEntry", distRoot: path.join(__dirname, "dist") })]
    : []),
];

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
          filename: uiEntryFilename({ isBuild: isBuildInvocation() }),
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
