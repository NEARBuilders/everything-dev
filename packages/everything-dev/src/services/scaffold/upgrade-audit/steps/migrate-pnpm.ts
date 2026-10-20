import { Effect } from "effect";
import { listFiles, readText, removePath, writeText } from "../fs";
import type { StepResult } from "./author-config";

const V2_CATALOG: Readonly<Record<string, string>> = {
  "everything-dev": "^2.0.0-rc.10",
  "every-plugin": "3.0.0-rc.6",
  "better-near-auth": "^2.0.0-rc.1",
  effect: "4.0.0-rc.117",
  zod: "4.6.5",
  "better-auth": "1.7.7",
  "@better-auth/api-key": "1.7.7",
  "@better-auth/passkey": "1.7.7",
  "@better-auth/core": "1.7.7",
  "@orpc/contract": "2.0.0-beta.35",
  "@orpc/server": "2.0.0-beta.35",
  "@orpc/client": "2.0.0-beta.35",
  "@orpc/zod": "2.0.0-beta.35",
  "@orpc/openapi": "2.0.0-beta.35",
  "@orpc/tanstack-query": "2.0.0-beta.35",
  "@orpc/publisher": "2.0.0-beta.35",
  "@orpc/experimental-effect": "2.0.0-beta.35",
  "@tanstack/react-query": "5.102.8",
  "@tanstack/react-query-devtools": "^5.102.8",
  "@tanstack/react-router": "1.170.32",
  "@tanstack/react-router-devtools": "1.167.1",
  "@tanstack/router-generator": "1.167.33",
  "@tanstack/router-plugin": "1.168.35",
  "@tanstack/react-devtools": "^0.10.1",
  "@tanstack/react-table": "^9.2.4",
  "near-kit": "^0.20.2",
  "@module-federation/enhanced": "^2.9.0",
  "@module-federation/node": "^2.7.50",
  "@module-federation/rsbuild-plugin": "^2.9.0",
  "@module-federation/runtime-core": "^2.9.0",
  "@module-federation/runtime": "^2.9.0",
  "@module-federation/runtime-tools": "^2.9.0",
  "@module-federation/sdk": "^2.9.0",
  "@module-federation/dts-plugin": "^2.9.0",
  "@rspack/core": "2.2.6",
  "@rspack/cli": "2.2.6",
  "@rsbuild/core": "2.2.8",
  "@rsbuild/plugin-react": "2.1.0",
  typescript: "^7.0.2",
};

const MINIMUM_RELEASE_AGE_EXCLUDE = [
  "better-near-auth@2.0.0-rc.0 || 2.0.0-rc.1",
  "every-plugin@3.0.0-rc.4 || 3.0.0-rc.5 || 3.0.0-rc.6",
  "everything-dev@2.0.0-rc.7 || 2.0.0-rc.8 || 2.0.0-rc.9 || 2.0.0-rc.10",
];

const PNPM_PACKAGE_MANAGER = "pnpm@12.10.1";

const YAML_PLAIN_VALUE_RE = /^[A-Za-z0-9^~][A-Za-z0-9.^~*+\-/]*$/;

const yamlScalar = (value: string): string =>
  YAML_PLAIN_VALUE_RE.test(value) ? value : JSON.stringify(value);

const yamlMap = (entries: ReadonlyArray<readonly [string, string]>, indent: string): string =>
  entries
    .map(([key, value]) =>
      /^[A-Za-z0-9_.-]+$/.test(key)
        ? `${indent}${key}: ${yamlScalar(value)}`
        : `${indent}${JSON.stringify(key)}: ${yamlScalar(value)}`,
    )
    .join("\n");

interface WorkspaceYamlInput {
  readonly packages: readonly string[];
  readonly catalog: Readonly<Record<string, string>>;
}

const renderWorkspaceYaml = (input: WorkspaceYamlInput): string => {
  const catalogEntries = Object.entries(input.catalog).map(([key, value]) => [key, value] as const);
  const lines = [
    "packages:",
    ...input.packages.map((pkg) => `  - ${yamlScalar(pkg)}`),
    "",
    "allowBuilds:",
    "  esbuild: true",
    "  sharp: true",
    "",
    "catalog:",
    yamlMap(catalogEntries, "  "),
    "",
    "minimumReleaseAgeExclude:",
    ...MINIMUM_RELEASE_AGE_EXCLUDE.map((entry) => `  - ${yamlScalar(entry)}`),
    "",
  ];
  return lines.join("\n");
};

const PLUGIN_TYPECHECK_LOOP =
  'for dir in plugins/*; do if [ -f "$dir/package.json" ]; then pnpm --dir "$dir" run typecheck || exit 1; fi; done';

const PLUGIN_TEST_LOOP =
  'for d in plugins/*; do if [ -f "$d/package.json" ]; then pnpm --dir "$d" --if-present run test || exit 1; fi; done';

const hardenedTypecheck = (dirs: readonly string[]): string =>
  [
    "pnpm run types:gen",
    ...dirs.map((dir) => `if [ -d ${dir} ]; then pnpm --dir ${dir} run typecheck || exit 1; fi`),
    PLUGIN_TYPECHECK_LOOP,
  ].join(" && ");

const hardenedTest = (dirs: readonly string[]): string =>
  [
    ...dirs.map((dir) => `pnpm --dir ${dir} --if-present run test || exit 1`),
    `[ -d plugins ] && ${PLUGIN_TEST_LOOP} || true`,
  ].join(" && ");

/** Mechanical bun→pnpm rewrites, safe for any workspace's scripts. */
const mechanicalScriptRewrite = (value: string): string =>
  value
    .replaceAll("bun run --if-present --cwd ", "pnpm --dir ")
    .replaceAll("bun run --cwd ", "pnpm --dir ")
    .replace(/bun run --cwd (\S+) (.+)/, "pnpm --dir $1 exec $2")
    .replaceAll("bun run ", "pnpm run ")
    .replace(
      'for d in plugins/*; do [ -f "$d/package.json" ] && bun run --if-present --cwd "$d" test; done',
      'for d in plugins/*; do if [ -f "$d/package.json" ]; then pnpm --dir "$d" --if-present run test || exit 1; fi; done',
    )
    .replace(
      'for dir in plugins/*; do if [ -f "$dir/package.json" ]; then bun run --cwd "$dir" typecheck; fi; done',
      'for dir in plugins/*; do if [ -f "$dir/package.json" ]; then pnpm --dir "$dir" run typecheck || exit 1; fi; done',
    );

const rewriteScripts = (scripts: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (key === "typecheck") {
      next[key] = hardenedTypecheck(["ui", "api"]);
      continue;
    }
    if (key === "test") {
      next[key] = hardenedTest(["api", "ui"]);
      continue;
    }
    next[key] = mechanicalScriptRewrite(value);
  }
  return next;
};

const WORKSPACE_PKG_GLOB = "{ui/package.json,api/package.json,plugins/*/package.json}";

/**
 * Workspace package.json scripts still speak bun (`bun run build:client`,
 * `bun run --cwd api typecheck`). Rewrite every bun invocation to the pnpm
 * form so the pnpm-only tree (packageManager pin, no bun in CI) works.
 * Unlike the root pass, workspace typecheck/test scripts keep their own
 * bodies — only the bun invocations are mechanically rewritten.
 */
const rewriteWorkspaceScripts = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const pkgPaths = yield* listFiles(projectDir, WORKSPACE_PKG_GLOB);
    const changed: string[] = [];
    for (const pkgPath of pkgPaths) {
      const source = yield* readText(projectDir, pkgPath);
      if (!source.includes("bun ")) continue;
      const pkg = JSON.parse(source) as { scripts?: Record<string, string> };
      if (!pkg.scripts) continue;
      const scripts = Object.fromEntries(
        Object.entries(pkg.scripts).map(([key, value]) => [key, mechanicalScriptRewrite(value)]),
      );
      if (JSON.stringify(scripts) === JSON.stringify(pkg.scripts)) continue;
      if (!dryRun) {
        yield* writeText(projectDir, pkgPath, `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`);
      }
      changed.push(pkgPath);
    }
    return changed;
  });

const BUN_ARTIFACTS = ["bun.lock", "bunfig.toml"] as const;

const RETIRED_FILES = ["railway.toml", "Dockerfile"] as const;

export const migratePnpm = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const pkg = JSON.parse(yield* readText(projectDir, "package.json")) as {
      packageManager?: string;
      scripts?: Record<string, string>;
      workspaces?: { packages?: string[]; catalog?: Record<string, string> };
    };

    const catalog = { ...(pkg.workspaces?.catalog ?? {}), ...V2_CATALOG };
    const packages = pkg.workspaces?.packages ?? ["api", "ui", "plugins/*"];
    const workspaceYaml = renderWorkspaceYaml({ packages, catalog });

    const nextPkg = {
      ...pkg,
      packageManager: PNPM_PACKAGE_MANAGER,
      scripts: rewriteScripts(pkg.scripts ?? {}),
      workspaces: undefined,
    };

    const writes = ["pnpm-workspace.yaml", "package.json"];
    const deletes = [...BUN_ARTIFACTS, ...RETIRED_FILES];
    const notes = [
      "catalog now lives in pnpm-workspace.yaml; bos upgrade syncs framework versions from the parent",
      "Dockerfile + railway.toml retired — deploys use ci.image (the upstream runtime image)",
    ];

    const workspaceScripts = yield* rewriteWorkspaceScripts(projectDir, dryRun);

    if (dryRun) {
      return {
        writes: [...writes, ...workspaceScripts],
        deletes,
        notes,
      };
    }

    yield* writeText(projectDir, "pnpm-workspace.yaml", workspaceYaml);
    yield* writeText(projectDir, "package.json", `${JSON.stringify(nextPkg, null, 2)}\n`);
    for (const path of [...BUN_ARTIFACTS, ...RETIRED_FILES]) {
      yield* removePath(projectDir, path);
    }
    return { writes: [...writes, ...workspaceScripts], deletes, notes };
  });
