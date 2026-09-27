import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";

/**
 * The host CLIENT build — the browser twin of the proven server recipe
 * (rsbuild.config.ts): plain tools.rspack, ModuleFederationPlugin with the
 * SAME exact-strict singleton shared map, NO build remotes (dynamic
 * registration at runtime), and an async-boundary entry (entry-web.tsx →
 * client) so non-eager shared scope init resolves before the app module runs.
 *
 * The build's own MF runtime owns the share scope — one React/router across
 * host client and containers by the same negotiation already green on the
 * server and in production everything.dev. No import map, no hand-built
 * vendor artifacts: rspack compiles the whole graph (CJS interop included).
 *
 * Build:  bunx rsbuild build -c rsbuild.client.config.ts   (from host/)
 * Output: dist-web/static/js/client.js (publicPath /__host/)
 */
export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      client: "./src/entry-web.tsx",
    },
  },
  dev: {
    progressBar: false,
  },
  tools: {
    rspack: {
      target: "web",
      optimization: {
        nodeEnv: "production",
      },
      output: {
        uniqueName: "host",
        publicPath: "/__host/",
      },
      infrastructureLogging: { level: "error" },
      stats: "errors-warnings",
      plugins: [
        new ModuleFederationPlugin({
          name: "host",
          filename: "remoteEntry.js",
          dts: false,
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
    distPath: { root: "dist-web" },
    filename: { js: "[name].js" },
    minify: false,
    clean: false,
  },
});
