import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * The prototype host in its PRODUCTION shape — mirroring the proven PR #134
 * host build exactly: plain tools.rspack with target async-node (no rsbuild
 * environments), ModuleFederationPlugin with the node runtime plugin,
 * commonjs-module library, exact-strict shared maps, NO build remotes
 * (dynamic registration), and an async-boundary entry (entry.tsx → server).
 */
export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: "./src/entry.tsx",
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
      infrastructureLogging: { level: "error" },
      stats: "errors-warnings",
      plugins: [
        new ModuleFederationPlugin({
          name: "host",
          filename: "remoteEntry.server.js",
          dts: false,
          runtimePlugins: [require.resolve("@module-federation/node/runtimePlugin")],
          library: { type: "commonjs-module" },
          shared: {
            react: { version: "19.2.4", requiredVersion: "19.2.4", singleton: true, strictVersion: true, eager: false, shareScope: "default" },
            "react-dom": { version: "19.2.4", requiredVersion: "19.2.4", singleton: true, strictVersion: true, eager: false, shareScope: "default" },
            "@tanstack/react-router": { version: "1.170.32", requiredVersion: "1.170.32", singleton: true, strictVersion: true, eager: false, shareScope: "default" },
          },
        }),
      ],
    },
  },
  performance: {
    chunkSplit: { strategy: "custom" },
  },
  output: {
    distPath: { root: "dist" },
    filename: { js: "[name].js" },
    minify: false,
    clean: false,
  },
});
