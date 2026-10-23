import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["tests/setup/hermetic-fetch.ts"],
    testTimeout: 30000,
  },
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
  ],
});
