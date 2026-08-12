import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: "host",
      filename: "remoteEntry.js",
      shared: {
        react: { singleton: true, requiredVersion: false, eager: true },
        "react-dom": { singleton: true, requiredVersion: false, eager: true },
        "@tanstack/react-router": { singleton: true, requiredVersion: false, eager: true },
      },
    }),
  ],
  source: {
    entry: {
      index: "./src/main.tsx",
    },
  },
  html: {
    template: "./src/index.html",
  },
  server: {
    port: 3000,
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
});