import { defineConfig } from "tsdown";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/effect.ts",
    "src/zod.ts",
    "src/zod-core.ts",
    "src/orpc.ts",
    "src/orpc-openapi.ts",
    "src/errors.ts",
    "src/runtime/index.ts",
    "src/testing/index.ts",
    "src/runtime/mf-config.ts",
    "src/runtime/services/normalize.ts",
    "src/build/shared-deps.ts",
    "src/build/rspack/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  treeshake: true,
  sourcemap: true,
  minify: false,
  unbundle: true,
  define: {
    __EVERY_PLUGIN_VERSION__: JSON.stringify(packageJson.version),
  },
  deps: { neverBundle: ["effect", "zod", /^@orpc\/.*/, /^@module-federation\/.*/] },
});
