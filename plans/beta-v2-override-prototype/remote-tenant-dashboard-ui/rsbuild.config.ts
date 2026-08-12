import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: "remote_tenant_dashboard_ui",
      filename: "remoteEntry.js",
      exposes: {
        "./tree": "./src/tree.tsx",
      },
      shared: {
        react: { singleton: true, requiredVersion: false },
        "react-dom": { singleton: true, requiredVersion: false },
        "@tanstack/react-router": { singleton: true, requiredVersion: false },
      },
    }),
  ],
  server: {
    port: 3104,
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
        uniqueName: "remote_tenant_dashboard_ui",
      },
    },
  },
});
