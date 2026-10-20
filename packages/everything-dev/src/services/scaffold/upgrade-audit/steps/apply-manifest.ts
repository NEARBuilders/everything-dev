import { Effect } from "effect";
import type { ImportRewrite } from "../domain";
import { fileExists, listFiles, readText, removePath, writeText } from "../fs";
import { OBSOLETE_FILES } from "../obsolete-files";
import type { StepResult } from "./author-config";

const applyRewrites = (
  projectDir: string,
  rewrites: readonly ImportRewrite[],
  dryRun: boolean,
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const touched: string[] = [];
    for (const rewrite of rewrites) {
      for (const file of rewrite.files) {
        const source = yield* readText(projectDir, file);
        const next = source.replaceAll(rewrite.from, rewrite.to);
        if (next !== source) {
          touched.push(file);
          if (!dryRun) yield* writeText(projectDir, file, next);
        }
      }
    }
    return touched;
  });

const applyDeletions = (projectDir: string, dryRun: boolean): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const removed: string[] = [];
    for (const path of OBSOLETE_FILES) {
      if (yield* fileExists(projectDir, path)) {
        removed.push(path);
        if (!dryRun) yield* removePath(projectDir, path);
      }
    }
    return removed;
  });

interface PluginDepsResult {
  readonly added: readonly string[];
  readonly unresolved: readonly string[];
}

const bareSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const importRe =
    /(?:import|export)[^"'`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(importRe)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec && !spec.startsWith(".") && !spec.startsWith("/")) specifiers.push(spec);
  }
  return specifiers;
};

const packageNameOf = (specifier: string): string => {
  if (specifier.startsWith("@")) {
    const [, scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0];
};

const isProtocolSpecifier = (specifier: string): boolean => /^[^/]+:/.test(specifier);

const memberPackageNames = (projectDir: string): Effect.Effect<Set<string>, Error> =>
  Effect.gen(function* () {
    const pkgPaths = yield* listFiles(
      projectDir,
      "{package.json,ui/package.json,api/package.json,plugins/*/package.json}",
    );
    const names = new Set<string>();
    for (const pkgPath of pkgPaths) {
      if (pkgPath === "package.json") continue;
      const pkg = JSON.parse(yield* readText(projectDir, pkgPath)) as { name?: string };
      if (typeof pkg.name === "string") names.add(pkg.name);
    }
    return names;
  });

const declarePluginDeps = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<PluginDepsResult, Error> =>
  Effect.gen(function* () {
    const rootCatalog = JSON.parse(yield* readText(projectDir, "package.json")) as {
      workspaces?: { catalog?: Record<string, string> };
    };
    const catalog = rootCatalog.workspaces?.catalog ?? {};
    const members = yield* memberPackageNames(projectDir);

    const pluginPkgs = yield* listFiles(projectDir, "plugins/*/package.json");
    const added: string[] = [];
    const unresolved: string[] = [];

    for (const pkgPath of pluginPkgs) {
      const pluginDir = pkgPath.slice(0, pkgPath.lastIndexOf("/"));
      const declared = new Set<string>();
      const pkg = JSON.parse(yield* readText(projectDir, pkgPath)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const name of [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]) {
        declared.add(name);
      }

      const sources = yield* listFiles(projectDir, `${pluginDir}/src/**/*.{ts,tsx}`);
      const needed = new Set<string>();
      for (const source of sources) {
        const text = yield* readText(projectDir, source);
        for (const specifier of bareSpecifiers(text)) {
          if (isProtocolSpecifier(specifier)) continue;
          needed.add(packageNameOf(specifier));
        }
      }

      const nextDeps = { ...(pkg.dependencies ?? {}) };
      let modified = false;
      for (const name of needed) {
        if (declared.has(name) || name === pluginDir.split("/")[1]) continue;
        // In-repo packages get workspace:* — the catalog holds external deps.
        if (members.has(name)) {
          added.push(`${pluginDir}: ${name} (workspace:*)`);
          nextDeps[name] = "workspace:*";
          modified = true;
          continue;
        }
        if (!(name in catalog)) {
          unresolved.push(`${pluginDir}: ${name} (not in catalog — declare manually)`);
          continue;
        }
        added.push(`${pluginDir}: ${name}`);
        nextDeps[name] = "catalog:";
        modified = true;
      }

      if (modified && !dryRun) {
        yield* writeText(
          projectDir,
          pkgPath,
          `${JSON.stringify({ ...pkg, dependencies: nextDeps }, null, 2)}\n`,
        );
      }
    }
    return { added, unresolved };
  });

export const consumerizeRefs = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const pkgPaths = yield* listFiles(
      projectDir,
      "{package.json,ui/package.json,api/package.json,plugins/*/package.json}",
    );
    // Refs to in-repo packages stay `workspace:*` — pnpm resolves member
    // packages locally, and the catalog only holds external deps. Only
    // external `workspace:`/`file:` refs (bun-workspace leftovers pointing
    // outside the tree) are consumerized to `catalog:`.
    const memberNames = new Set<string>();
    for (const pkgPath of pkgPaths) {
      if (pkgPath === "package.json") continue;
      const pkg = JSON.parse(yield* readText(projectDir, pkgPath)) as { name?: string };
      if (typeof pkg.name === "string") memberNames.add(pkg.name);
    }
    const fixed: string[] = [];
    for (const pkgPath of pkgPaths) {
      const pkg = JSON.parse(yield* readText(projectDir, pkgPath)) as Record<string, unknown>;
      let modified = false;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const deps = pkg[field];
        if (deps === null || typeof deps !== "object") continue;
        const record = deps as Record<string, string>;
        for (const [name, ref] of Object.entries(record)) {
          if (
            typeof ref === "string" &&
            (ref.startsWith("workspace:") || ref.startsWith("file:")) &&
            !memberNames.has(name)
          ) {
            record[name] = "catalog:";
            modified = true;
          }
        }
      }
      if (modified) {
        fixed.push(pkgPath);
        if (!dryRun) {
          yield* writeText(projectDir, pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
        }
      }
    }
    return fixed;
  });

export const applyManifest = (
  projectDir: string,
  rewrites: readonly ImportRewrite[],
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const rewritten = yield* applyRewrites(projectDir, rewrites, dryRun);
    const deleted = yield* applyDeletions(projectDir, dryRun);
    const deps = yield* declarePluginDeps(projectDir, dryRun);
    const refs = yield* consumerizeRefs(projectDir, dryRun);
    return {
      writes: rewritten,
      deletes: deleted,
      notes: [
        ...(refs.length > 0 ? [`workspace:/file: refs → catalog: in ${refs.join(", ")}`] : []),
        ...(deps.added.length > 0 ? [`plugin deps added: ${deps.added.join(", ")}`] : []),
        ...deps.unresolved,
      ],
    };
  });
