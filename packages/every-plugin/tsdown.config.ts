import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";
import packageJson from "./package.json" with { type: "json" };
import { syncExports } from "./scripts/sync-exports.ts";
import { entries } from "./tsdown-entries.ts";

const SHEBANG = "#!/usr/bin/env bun\n";

await syncExports();

export default defineConfig({
  entry: entries.map((spec) => spec.entry),
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
