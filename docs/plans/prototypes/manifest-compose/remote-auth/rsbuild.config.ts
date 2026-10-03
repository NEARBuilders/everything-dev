import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

// Dual-environment MF remote (web = browser chunks, node = SSR bundle),
// the proven PR #134 shape: the node recipe activates via the plugin's
// `{ target: "node" }` second argument, emitting dist/ssr/remoteEntry.server.js
// (CJS container, async-node chunk loading).
export default defineConfig({
  environments: {
    web: {
      source: { entry: { index: "./src/routeConfig.gen.ts" } },
      plugins: [
        pluginReact(),
        pluginModuleFederation({
          name: "auth",
          filename: "remoteEntry.js",
          exposes: { "./routeConfig": "./src/routeConfig.gen.ts" },
          shared: {
            react: { version: "19.2.4", requiredVersion: "19.2.4", singleton: true, strictVersion: true, eager: false, shareScope: "default" },
            "react-dom": { version: "19.2.4", requiredVersion: "19.2.4", singleton: true, strictVersion: true, eager: false, shareScope: "default" },
            "@tanstack/react-router": { version: "1.170.32", requiredVersion: "1.170.32", singleton: true, strictVersion: true, eager: false, shareScope: "default" },
          },
        }),
      ],
      output: { crossOriginLoading: "anonymous" },
    },
    node: {
      plugins: [
        pluginReact(),
        pluginModuleFederation(
          {
            name: "auth",
            exposes: {
              "./routeConfig": process.env.MF_GUARD_BUILD ? "./src/guard-entry.ts" : "./src/routeConfig.gen.ts",
            },
            shared: {
              react: {
                version: "19.2.4",
                requiredVersion: process.env.MF_REACT_REQUIRED_VERSION ?? "19.2.4",
                singleton: true,
                strictVersion: true,
                eager: false,
                import: false,
                shareScope: "default",
              },
              "react-dom": { version: "19.2.4", requiredVersion: "19.2.4", singleton: true, strictVersion: true, eager: false, import: false, shareScope: "default" },
              "@tanstack/react-router": { version: "1.170.32", requiredVersion: "1.170.32", singleton: true, strictVersion: true, eager: false, import: false, shareScope: "default" },
            },
            filename: "remoteEntry.server.js",
          },
          { target: "node", environment: "node" },
        ),
      ],
      source: { entry: { index: "./src/routeConfig.gen.ts" } },
      output: {
        target: "node",
        distPath: { root: process.env.MF_GUARD_BUILD ? "dist-bad/ssr" : "dist/ssr" },
        filename: { js: "[name].js" },
      },
    },
  },
  tools: {
    rspack: (config, { environment }) => {
      if (environment.name === "web" && config.output) {
        config.output.publicPath = "auto";
      }
      return config;
    },
  },
  // Remote chunk loading must derive its base from WHERE the remoteEntry was
  // loaded from (the remote's own origin), not the composing page's origin —
  // a root-relative "/" publicPath makes containers request their chunks from
  // the host page and 404. NOTE: environments.*.output.publicPath does not
  // survive rsbuild 2.2.8's rsbuild→rspack conversion (verified empirically);
  // the tools.rspack mutation does reach the emitted runtime.
  tools: {
    rspack: (config, { environment }) => {
      if (environment.name === "web" && config.output) {
        config.output.publicPath = "auto";
      }
      return config;
    },
  },
  dev: { progressBar: false },
});
