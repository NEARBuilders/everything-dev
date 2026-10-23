import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@number-flow/react": new URL("./src/testing/number-flow-stub.tsx", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./vitest.global-setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
