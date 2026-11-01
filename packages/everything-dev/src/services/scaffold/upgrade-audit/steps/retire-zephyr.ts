import { Effect } from "effect";
import { fileExists, listFiles, readText, writeText } from "../fs";
import type { StepResult } from "./author-config";

/**
 * Strips ZephyrCloud deploy wiring from a v1 child tree. v2 deploys run
 * through the `bos deploy` train (build → bundle upload to the R2-backed
 * store → FastKV publish → image → Railway); the per-build Zephyr hooks
 * and their `reportDeployResult` writes into `bos.config.json` are v1-only
 * machinery. The production URLs currently in the authored descriptor come
 * from the last v1 Zephyr deploys and are replaced by the first v2 deploy.
 *
 * Handles three shapes:
 * - ui/rsbuild.config.ts: statement blocks
 *     `if (shouldDeploy) { plugins.push(withZephyr({ ... })); }`
 *   plus the now-unused integrity import and bos-config path const.
 * - api/plugins rspack configs: conditional default export
 *     `export default shouldDeploy ? withZephyr({ ... }) : baseConfig`
 *   unwrapped to `export default baseConfig`.
 * - package.json deps: `zephyr-rsbuild-plugin` / `zephyr-rspack-plugin`
 *   removed from every workspace package.json and the root catalog.
 *
 * `shouldDeploy` itself is kept where it still gates non-Zephyr behavior
 * (e.g. `devtool: shouldDeploy ? false : "source-map"`).
 */

const ZEPHYR_DEPS = ["zephyr-rsbuild-plugin", "zephyr-rspack-plugin"] as const;

/** Extracts a balanced-brace block starting at `openIdx` (on "{"). */
const extractBlock = (source: string, openIdx: number): string | null => {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return null;
};

/** Removes whole `if (shouldDeploy) { ... withZephyr ... }` statement blocks. */
const removeZephyrIfBlocks = (source: string): { next: string; removed: number } => {
  let next = source;
  let removed = 0;
  for (;;) {
    const ifStart = next.indexOf("if (shouldDeploy)");
    if (ifStart === -1) break;
    const blockOpen = next.indexOf("{", ifStart);
    if (blockOpen === -1) break;
    const block = extractBlock(next, blockOpen);
    if (block === null || !block.includes("withZephyr")) break;
    let end = blockOpen + block.length;
    if (next[end] === "\n") end += 1;
    next = (next.slice(0, ifStart) + next.slice(end)).replace(/\n{3,}/g, "\n\n");
    removed += 1;
  }
  return { next, removed };
};

/**
 * Unwraps `export default shouldDeploy ? withZephyr({ ... }) : BASE;` to
 * `export default BASE;`. Locates the ternary colon after the withZephyr
 * call closes (never inside the args object, where `key:` pairs live).
 */
const unwrapZephyrTernary = (source: string): { next: string; unwrapped: boolean } => {
  const marker = source.indexOf("export default shouldDeploy");
  if (marker === -1) return { next: source, unwrapped: false };
  const withIdx = source.indexOf("withZephyr(", marker);
  if (withIdx === -1) return { next: source, unwrapped: false };
  const callOpen = source.indexOf("{", withIdx);
  if (callOpen === -1) return { next: source, unwrapped: false };
  const args = extractBlock(source, callOpen);
  if (args === null) return { next: source, unwrapped: false };
  const closeParen = source.indexOf(")", callOpen + args.length);
  if (closeParen === -1) return { next: source, unwrapped: false };
  const colonIdx = source.indexOf(":", closeParen);
  if (colonIdx === -1) return { next: source, unwrapped: false };
  const semiIdx = source.indexOf(";", colonIdx);
  if (semiIdx === -1) return { next: source, unwrapped: false };
  const base = source.slice(colonIdx + 1, semiIdx).trim();
  if (!base || base.includes("withZephyr")) return { next: source, unwrapped: false };
  return {
    next: `${source.slice(0, marker)}export default ${base};${source.slice(semiIdx + 1)}`,
    unwrapped: true,
  };
};

const stripUnusedImports = (source: string, path: string, notes: string[]): string => {
  let next = source;

  const zephyrImport = next.match(
    /import\s*\{\s*withZephyr\s*\}\s*from\s*"zephyr-(?:rsbuild|rspack)-plugin";\n/,
  );
  if (zephyrImport && !next.replace(zephyrImport[0], "").includes("withZephyr")) {
    next = next.replace(zephyrImport[0], "");
    notes.push(`${path}: removed the withZephyr import`);
  }

  const integrityImport = next.match(
    /import\s*\{([^}]*)\}\s*from\s*"everything-dev\/integrity";\n/,
  );
  if (integrityImport) {
    const names = integrityImport[1]
      .split(",")
      .map((n) => n.trim().replace(/\s+as\s+\S+/, ""))
      .filter(Boolean);
    const withoutImport = next.replace(integrityImport[0], "");
    const allUnused = names.every((name) => !withoutImport.includes(name));
    if (allUnused) {
      next = next.replace(integrityImport[0], "");
      notes.push(`${path}: removed the unused everything-dev/integrity import`);
    }
  }

  // Drop the shouldDeploy declaration when nothing references it anymore.
  const declMatch = next.match(/const shouldDeploy = process\.env\.DEPLOY === "true";\n/);
  if (declMatch && !next.replace(declMatch[0], "").includes("shouldDeploy")) {
    next = next.replace(declMatch[0], "");
    notes.push(`${path}: removed the unused shouldDeploy declaration`);
  }

  // Drop the bos.config.json path helper — reportDeployResult wrote there,
  // and bos.config.json itself is retired by the v2 authored descriptor.
  const bosPathMatch = next.match(/const uiBosConfigPath = [^\n]*;\n/);
  if (bosPathMatch && !next.replace(bosPathMatch[0], "").includes("uiBosConfigPath")) {
    next = next.replace(bosPathMatch[0], "");
    notes.push(`${path}: removed the unused uiBosConfigPath declaration`);
  }

  return next.replace(/\n{3,}/g, "\n\n");
};

const rewriteBuildConfig = (
  projectDir: string,
  path: string,
  dryRun: boolean,
  notes: string[],
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, path);
    if (!exists) {
      notes.push(`${path} absent — skipped`);
      return false;
    }
    const source = yield* readText(projectDir, path);
    if (!source.includes("withZephyr")) {
      notes.push(`${path}: no Zephyr wiring — left untouched`);
      return false;
    }

    let next = source;

    const ifBlocks = removeZephyrIfBlocks(next);
    next = ifBlocks.next;
    if (ifBlocks.removed > 0) {
      notes.push(`${path}: removed ${ifBlocks.removed} withZephyr deploy block(s)`);
    }

    const ternary = unwrapZephyrTernary(next);
    next = ternary.next;
    if (ternary.unwrapped) {
      notes.push(`${path}: unwrapped the shouldDeploy ? withZephyr(...) : base default export`);
    }

    next = stripUnusedImports(next, path, notes);

    if (next !== source && !dryRun) yield* writeText(projectDir, path, next);
    return next !== source;
  });

const stripZephyrDeps = (
  projectDir: string,
  dryRun: boolean,
  notes: string[],
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const changed: string[] = [];
    const pkgPaths = yield* listFiles(
      projectDir,
      "{package.json,ui/package.json,api/package.json,plugins/*/package.json}",
    );
    for (const pkgPath of pkgPaths) {
      const source = yield* readText(projectDir, pkgPath);
      const pkg = JSON.parse(source) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        workspaces?: { catalog?: Record<string, string> };
      };
      let modified = false;
      for (const dep of ZEPHYR_DEPS) {
        for (const field of ["dependencies", "devDependencies"] as const) {
          if (pkg[field] && dep in pkg[field]) {
            delete pkg[field][dep];
            modified = true;
            notes.push(`${pkgPath}: removed ${dep} from ${field}`);
          }
        }
      }
      if (pkg.workspaces?.catalog) {
        for (const dep of ZEPHYR_DEPS) {
          if (dep in pkg.workspaces.catalog) {
            delete pkg.workspaces.catalog[dep];
            modified = true;
            notes.push(`${pkgPath}: removed ${dep} from the catalog`);
          }
        }
      }
      if (modified) {
        if (!dryRun) {
          yield* writeText(projectDir, pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
        }
        changed.push(pkgPath);
      }
    }
    return changed;
  });

export const retireZephyr = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const notes: string[] = [
      "v2 deploys run through the bos deploy train (bundle upload + FastKV publish + image + Railway) — Zephyr wiring is retired",
      "production URLs in the authored descriptor are from the last v1 Zephyr deploy; the first v2 deploy replaces them",
    ];

    const configs = ["ui/rsbuild.config.ts", "api/rspack.config.js"];
    const pluginConfigs = yield* listFiles(projectDir, "plugins/*/rspack.config.js");
    for (const path of [...configs, ...pluginConfigs]) {
      const changed = yield* rewriteBuildConfig(projectDir, path, dryRun, notes);
      if (changed) writes.push(path);
    }

    const depChanges = yield* stripZephyrDeps(projectDir, dryRun, notes);
    writes.push(...depChanges);

    if (writes.length === 0) {
      notes.push("no Zephyr wiring found — nothing to retire");
    }

    return { writes, deletes: [], notes };
  });
