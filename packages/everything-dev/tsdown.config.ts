import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

const SHEBANG = "#!/usr/bin/env node\n";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/descriptor/index.ts",
    "src/config.ts",
    "src/resolution/session.ts",
    "src/dag.ts",
    "src/bundle-cache.ts",
    "src/bundle-fs-resolve.ts",
    "src/fingerprint.ts",
    "src/version-manifest-resolve.ts",
    "src/version-status.ts",
    "src/fastkv.ts",
    "src/contract.meta.ts",
    "src/db/index.ts",
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
    "src/ui/i18n.tsx",
    "src/ui/metadata.ts",
    "src/ui/router.ts",
    "src/ui/api.ts",
    "src/ui/auth.ts",
    "src/ui/version-check.ts",
    "src/api/auth-middleware.ts",
    "src/ui/tenant.ts",
    "src/start-config-source.ts",
    "src/ui/entry.ts",
    "src/ui/hydrate.tsx",
    "src/ui/router-client.tsx",
    "src/ui/router-server.tsx",
    "src/ui/router-defaults.tsx",
    "src/ui/router-error.tsx",
    "src/ui/manifest/index.ts",
    "src/ui/manifest-generator.ts",
  ],
  format: ["cjs", "esm"],
  dts: { tsconfig: "./tsconfig.dts.json" },
  clean: true,
  outDir: "dist",
  treeshake: true,
  sourcemap: true,
  minify: false,
  unbundle: true,
  deps: {
    onlyBundle: false,
    neverBundle: [
      "effect",
      "zod",
      /^@module-federation\/.*/,
      /^@orpc\/.*/,
      /^@standard-schema\/.*/,
      /^@effect\/.*/,
      /^@rsbuild\/.*/,
      /^@tanstack\/.*/,
      // MF shared singletons — the ui-surface dist must import them
      // externally; bundling them drags CJS-interop helpers into client code.
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react-dom/client",
      "@lingui/core",
      "@lingui/react",
      "chalk",
      "every-plugin",
      "tar",
      "glob",
      "@clack/prompts",
      "execa",
      "defu",
      "openapi-types",
      "pg",
      "@electric-sql/pglite",
      /^drizzle-orm(\/.*)?$/,
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
        console.warn(`[tsdown] Failed to set shebang/permissions on ${file}: ${String(err)}`);
      }
    }
  },
});
