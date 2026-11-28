import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/integration/runtime-remote.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // KEEP: server-booting integration tests allocate ports probe-then-bind
    // (helpers/ports.ts) and several mutate process.env (NODE_ENV/PORT) —
    // parallel files race both. Serialized files cost ~15s on the host suite.
    fileParallelism: false,
  },
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
  ],
});
