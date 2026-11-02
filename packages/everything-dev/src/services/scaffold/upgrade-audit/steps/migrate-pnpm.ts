import { Effect } from "effect";
import {
  CATALOG_PINNED_OVERRIDE_KEYS,
  frameworkReleaseAgeExcludes,
  PNPM_PACKAGE_MANAGER,
} from "../../../workspace/catalog-overrides";
import { listFiles, readText, removePath, writeText } from "../fs";
import type { StepResult } from "./author-config";
import { V2_CATALOG } from "./v2-catalog";

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
