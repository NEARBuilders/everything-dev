import { existsSync, readFileSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { defineConfig } from "tsdown";

const SHEBANG = "#!/usr/bin/env node\n";

// The dts emit of src/ui/auth.ts resolves the client-plugin chain through
// better-near-auth's built dist. When those types are missing (stale or
// unbuilt dependency), rolldown-plugin-dts silently collapses the whole
// chain to `any` — shipped verbatim to npm. Guard both ends: the dep types
// must resolve before the build, and the emitted client factory must not
// be `any` after it.
const require = createRequire(import.meta.url);

function declaredTypesPath(packageDir: string, subpath: string): string | null {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8")) as {
    exports?: Record<string, unknown>;
  };
  const entry = manifest.exports?.[subpath];
  if (!entry || typeof entry !== "object") return null;
  const types = (entry as Record<string, unknown>).types;
  if (typeof types !== "string") return null;
  const distTypes = join(packageDir, types);
  return distTypes.startsWith(join(packageDir, "src")) ? null : distTypes;
}

function workspacePackageDir(name: string): string {
  try {
    return join(require.resolve(`${name}/package.json`), "..");
  } catch {
    return join(import.meta.dirname, "..", name);
  }
}

function assertWorkspaceDtsDependencies() {
  const packages: Record<string, readonly string[]> = {
    "every-plugin": ["."],
    "better-near-auth": [".", "./client"],
  };
  for (const [name, subpaths] of Object.entries(packages)) {
    const packageDir = workspacePackageDir(name);
    for (const subpath of subpaths) {
      const typesPath = declaredTypesPath(packageDir, subpath);
      if (!typesPath || !existsSync(typesPath)) {
        throw new Error(
          `dts prerequisite missing: ${name}${subpath === "." ? "" : subpath} has no built ` +
            `dist types (${typesPath ?? "no non-src types entry"}). Run pnpm --filter ${name} build.`,
        );
      }
    }
  }
}
assertWorkspaceDtsDependencies();

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
    const authDts = await readFile(join("dist", "ui", "auth.d.mts"), "utf-8").catch(() => "");
    if (/declare function createAuthClient\(.*\): any;/.test(authDts)) {
      throw new Error(
        "dist/ui/auth.d.mts emitted createAuthClient(): any — the better-auth plugin-chain " +
          "inference collapsed. Check that better-near-auth's dist types are built and fresh.",
      );
    }
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
