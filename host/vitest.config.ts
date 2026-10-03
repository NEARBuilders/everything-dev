import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/integration/runtime-remote.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
  },
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
  ],
});
