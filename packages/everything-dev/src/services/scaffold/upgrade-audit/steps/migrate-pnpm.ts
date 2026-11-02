import { Effect } from "effect";
import {
  CATALOG_PINNED_OVERRIDE_KEYS,
  frameworkReleaseAgeExcludes,
  PNPM_PACKAGE_MANAGER,
} from "../../../workspace/catalog-overrides";
import { listFiles, readText, removePath, writeText } from "../fs";
import type { StepResult } from "./author-config";

/**
 * Catalog baseline for the v1→v2 migration — v1 leftovers must lose to
 * these rows. This is a verbatim copy of the parent `pnpm-workspace.yaml`
 * catalog: drift here regresses a migrated child's catalog (#650), which is
 * why tests/unit/catalog-lockstep.test.ts asserts row-for-row equality in
 * both directions.
 */
export const V2_CATALOG: Readonly<Record<string, string>> = {
  "@better-auth/api-key": "1.7.14",
  "@better-auth/core": "1.7.14",
  "@better-auth/passkey": "1.7.14",
  "@better-fetch/fetch": "1.3.3",
  "@electric-sql/pglite": "^0.4.5",
  "@effect/platform-node": "4.0.0-rc.118",
  "@effect/platform-node-shared": "4.0.0-rc.118",
  "@hot-labs/near-connect": "elliotBraem/near-connect#v0.12.0-fork.3",
  "@libsql/client": "0.17.0",
  "@lingui/core": "5.9.0",
  "@lingui/message-utils": "5.9.0",
  "@lingui/react": "5.9.0",
  "@modelcontextprotocol/server": "2.0.0-beta.5",
  "@module-federation/dts-plugin": "^2.9.2",
  "@module-federation/enhanced": "^2.9.2",
  "@module-federation/node": "^2.7.52",
  "@module-federation/rsbuild-plugin": "^2.9.2",
  "@module-federation/runtime": "^2.9.2",
  "@module-federation/runtime-core": "^2.9.2",
  "@module-federation/runtime-tools": "^2.9.2",
  "@module-federation/sdk": "^2.9.2",
  "@opentelemetry/api": "^1.9.0",
  "@orpc/client": "2.0.0-beta.45",
  "@orpc/contract": "2.0.0-beta.45",
  "@orpc/experimental-effect": "2.0.0-beta.45",
  "@orpc/openapi": "2.0.0-beta.45",
  "@orpc/publisher": "2.0.0-beta.45",
  "@orpc/server": "2.0.0-beta.45",
  "@orpc/tanstack-query": "2.0.0-beta.45",
  "@orpc/zod": "2.0.0-beta.45",
  "@outlayer/sdk": "0.1.0-alpha.4",
  "@near-intents-agent-api/sdk": "^0.4.1",
  "@rsbuild/core": "2.2.8",
  "@rsbuild/plugin-react": "2.1.0",
  "@rspack/cli": "2.2.6",
  "@rspack/core": "2.2.8",
  "@scure/base": "^2.2.0",
  "@simplewebauthn/browser": "^13.3.0",
  "@tanstack/ai": "0.61.0",
  "@tanstack/ai-openai": "0.24.1",
  "@tanstack/ai-react": "0.29.1",
  "@tanstack/intent": "^0.5.6",
  "@tanstack/react-devtools": "^0.10.13",
  "@tanstack/react-form": "^1.33.5",
  "@tanstack/react-query": "5.104.5",
  "@tanstack/react-query-devtools": "^5.104.5",
  "@tanstack/react-router": "1.170.46",
  "@tanstack/react-router-devtools": "1.167.2",
  "@tanstack/react-table": "^9.3.1",
  "@tanstack/router-core": "1.171.39",
  "@tanstack/router-generator": "1.167.46",
  "@tanstack/router-plugin": "1.168.48",
  "@types/node": "^25.0.3",
  "@types/pg": "^8.11.6",
  "@types/react": "^19.3.0",
  "@types/react-dom": "^19.3.0",
  aws4fetch: "^1.0.20",
  "better-auth": "1.7.14",
  "better-near-auth": "^2.0.0-rc.5",
  "drizzle-kit": "^0.31.11",
  "drizzle-orm": "^0.45.4",
  effect: "4.0.0-rc.118",
  "every-plugin": "^3.0.0-rc.14",
  "everything-dev": "^2.0.0-rc.27",
  "near-kit": "^0.20.2",
  pg: "^8.12.0",
  react: "19.3.1",
  "react-dom": "19.3.1",
  sirv: "3.0.2",
  sonner: "2.0.8",
  typescript: "7.0.2",
  vitest: "^4.1.8",
  yaml: "2.9.1",
  zod: "4.6.7",
};

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
  const catalog = Object.fromEntries(catalogEntries);
  const overrideEntries = CATALOG_PINNED_OVERRIDE_KEYS.filter((key) => catalog[key]).map(
    (key) => [key, catalog[key]] as const,
  );
  const releaseAgeExcludes = frameworkReleaseAgeExcludes(catalog);
  const lines = [
    "packages:",
    ...input.packages.map((pkg) => `  - ${yamlScalar(pkg)}`),
    "",
    "allowBuilds:",
    "  esbuild: true",
    "  sharp: true",
    "  protobufjs: true",
    "  '@openapitools/openapi-generator-cli': true",
    "",
    ...(overrideEntries.length > 0
      ? [
          "overrides:",
          ...overrideEntries.map(([key, value]) => `  ${yamlMap([[key, value]], "").trimStart()}`),
          "",
        ]
      : []),
    "catalog:",
    yamlMap(catalogEntries, "  "),
    "",
    ...(releaseAgeExcludes.length > 0
      ? [
          "minimumReleaseAgeExcludePrune: true",
          "minimumReleaseAgeExclude:",
          ...releaseAgeExcludes.map((entry) => `  - ${yamlScalar(entry)}`),
          "",
        ]
      : []),
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
    // node cannot execute the .bin shell shims pnpm installs — under pnpm
    // run, the bin is already on PATH.
    .replace(/node node_modules\/\.bin\/bos /, "bos ")
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

    const catalog = { ...pkg.workspaces?.catalog, ...V2_CATALOG };
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
