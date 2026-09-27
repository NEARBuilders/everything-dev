import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";
import packageJson from "./package.json" with { type: "json" };

const SHEBANG = "#!/usr/bin/env bun\n";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/errors.ts",
    "src/remote-entry.ts",
    "src/runtime/index.ts",
    "src/testing/index.ts",
    "src/runtime/mf-config.ts",
    "src/runtime/services/normalize.ts",
    "src/build/shared-deps.ts",
    "src/build/rspack/index.ts",
    "src/ui/manifest/index.ts",
    "src/ui/manifest/generator.ts",
    "src/build/ui/index.ts",
    "src/dev/serve.ts",
    "src/cli.ts",
  ],
  format: ["cjs", "esm"],
  dts: { tsconfig: "./tsconfig.dts.json" },
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
  async onSuccess() {
    for (const file of ["cli.mjs", join("dev", "serve.mjs")]) {
      const filepath = join("dist", file);
      try {
        const content = await readFile(filepath, "utf8");
        if (!content.startsWith("#!")) {
          await writeFile(filepath, SHEBANG + content);
        }
        await chmod(filepath, 0o755);
      } catch (err) {
        console.warn(`[tsdown] Failed to set shebang/permissions on ${file}: ${String(err)}`);
      }
    }

    const rspackExports = await import(
      new URL("./dist/build/rspack/index.mjs", import.meta.url).href
    );
    for (const name of ["EmitPluginManifest", "EveryPluginBuild", "createPluginBaseConfig"]) {
      if (!(name in rspackExports)) {
        throw new Error(
          `[tsdown] dist consistency check failed: every-plugin/build/rspack is missing export "${name}" — chunk graph is inconsistent`,
        );
      }
    }
  },
});
