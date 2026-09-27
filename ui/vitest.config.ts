import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globalSetup: ["./vitest.global-setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
