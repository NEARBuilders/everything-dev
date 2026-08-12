import { defineConfig } from "@rsbuild/core";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";

export default defineConfig({
  plugins: [
    pluginModuleFederation({
      name: "remote_dashboard_api",
      filename: "remoteEntry.js",
      exposes: {
        "./api": "./src/index.ts",
      },
    }),
  ],
  server: {
    port: 3101,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  },
  dev: {
    progressBar: false,
  },
  output: {
    assetPrefix: "auto",
  },
  tools: {
    rspack: {
      output: {
        uniqueName: "remote_dashboard_api",
      },
    },
  },
});
