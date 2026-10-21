/**
 * The authoritative inventory of framework-owned files — the single home for
 * the sync-ownership concept (ADR 0032). `bos sync` reconciles exactly the
 * files listed here from the parent template; app-owned files are never
 * considered. Consumers: sync (destToSource), prune (protection), and the
 * structure guardrail test.
 */

export const FRAMEWORK_OWNED_SYNC_FILES = new Set([
  ".env.example",
  ".gitignore",
  "biome.json",
  "bos.config.json",
  "package.json",
  ".changeset/config.json",
  ".changeset/README.md",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/staging.yml",
  ".github/workflows/release.yml",
  "ui/package.json",
  "ui/postcss.config.mjs",
  "ui/tsconfig.json",
  "api/package.json",
  "api/plugin.dev.ts",
  "api/rspack.config.js",
  "api/tsconfig.json",
  "api/drizzle.config.ts",
  "api/src/global.d.ts",
  "api/tests/types.d.ts",
]);

/**
 * Files the scaffold previously sync-owned but has retired (ADR 0023) — the
 * generated `.gen` bootstrap stubs replaced them. During sync: a local copy
 * whose hash still matches the sync snapshot is deleted silently; a
 * hand-modified (or never-snapshotted) copy is backed up, then deleted. The
 * app's authored ui files (router.tsx, app.ts, lib, routes, components) are
 * NOT retired — they leave the sync list as app-owned files, untouched.
 */
export const RETIRED_SYNC_FILES = new Set([
  "ui/src/entry.ts",
  "ui/src/globals.d.ts",
  "ui/src/hydrate.tsx",
  "ui/src/router.server.tsx",
  "ui/src/compose.ts",
]);

export const AGENT_SYNC_GLOBS = [".agents/skills/**", "docs/agents/**", "skills-lock.json"];

export function isFrameworkOwnedSyncFile(filePath: string): boolean {
  // Scaffold-template copies (.github/templates/** → their destination path at
  // init) are framework-owned exactly when their destination is.
  if (filePath.startsWith(".github/templates/")) {
    return isFrameworkOwnedSyncFile(filePath.slice(".github/templates/".length));
  }
  if (FRAMEWORK_OWNED_SYNC_FILES.has(filePath)) return true;
  if (
    filePath.startsWith(".agents/skills/") ||
    filePath.startsWith("docs/agents/") ||
    filePath === "skills-lock.json"
  )
    return true;
  // lib/auth.ts is NOT sync-owned since #207: the middleware factory lives in
  // everything-dev/api (framework home); projects import it, they don't own a copy.
  // db/* and lib/context.ts left ownership in ADR 0033 — the db seam (layer.ts,
  // schema.ts, migrations/) and the request-context schema are app surface,
  // scaffolded once by `bos init` and free to swap.
  if (/^plugins\/[^/]+\/rspack\.config\.js$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/drizzle\.config\.ts$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/src\/global\.d\.ts$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/tests\/types\.d\.ts$/.test(filePath)) return true;
  if (/^plugins\/[^/]+\/tsconfig\.json$/.test(filePath)) return true;
  return false;
}

/**
 * The canonical framework-owned marker (ADR 0032) — the text every commentable
 * sync-owned file carries. Says the three things agents need: what owns the
 * file, that local edits are allowed (with the backup semantics), and the
 * upstream-issue protocol that makes a change permanent.
 *
 * Commentable means parsed leniently: ts/tsx/mjs/js, YAML, env/gitignore
 * hashes, markdown. Strict-JSON files (tsconfigs are JSON.parsed by
 * personalizeConfig; package.json; bos.config.json) stay unmarked — this
 * inventory is their source of truth.
 */
export const FRAMEWORK_OWNED_HEADER = [
  "FRAMEWORK-OWNED — reconciled from the parent template by `bos sync` / `bos upgrade`.",
  "Local edits are allowed: on the next sync the template version wins and your copy",
  "is backed up under `.bos/sync-backup/`. To make a change permanent, file an issue:",
  "https://github.com/NEARBuilders/everything-dev/issues",
].join("\n");

export function frameworkOwnedHeaderComment(syntax: "block" | "hash"): string {
  if (syntax === "hash") {
    return `${FRAMEWORK_OWNED_HEADER.split("\n")
      .map((line) => `# ${line}`)
      .join("\n")}\n`;
  }
  return `/**\n${FRAMEWORK_OWNED_HEADER.split("\n")
    .map((line) => ` * ${line}`)
    .join("\n")}\n */\n`;
}
