import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

const SHEBANG = "#!/usr/bin/env node\n";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/config.ts",
    "src/dag.ts",
    "src/fastkv.ts",
    "src/contract.meta.ts",
    "src/db.ts",
    "src/mf.ts",
    "src/integrity.ts",
    "src/plugin.ts",
    "src/sdk.ts",
    "src/cli.ts",
    "src/cli/init.ts",
    "src/ui/index.ts",
    "src/ui/types.ts",
    "src/ui/runtime.ts",
    "src/ui/head.ts",
    "src/ui/metadata.ts",
    "src/ui/router.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  treeshake: true,
  sourcemap: true,
  minify: false,
  unbundle: true,
  deps: {
    neverBundle: [
      "effect",
      "zod",
      /^@module-federation\/.*/,
      /^@orpc\/.*/,
      /^@standard-schema\/.*/,
      /^@effect\/.*/,
      "ink",
      "react",
      "react-dom",
      /^@tanstack\/.*/,
      "chalk",
      "gradient-string",
      "every-plugin",
      "tar",
      "glob",
      "@clack/prompts",
      "execa",
      "defu",
      "openapi-types",
      "pg",
    ],
  },
  async onSuccess() {
    for (const file of ["cli.mjs", "cli.cjs"]) {
      const filepath = join("dist", file);
      try {
        const content = await readFile(filepath, "utf8");
        if (!content.startsWith("#!")) {
          await writeFile(filepath, SHEBANG + content);
        }
        await chmod(filepath, 0o755);
      } catch (err) {
        console.warn(`[tsdown] Failed to set shebang/permissions on ${file}: ${err}`);
      }
    }
  },
});
