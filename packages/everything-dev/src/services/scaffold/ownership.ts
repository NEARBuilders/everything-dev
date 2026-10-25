/**
 * The authoritative inventory of framework-owned files — the single home for
 * the sync-ownership concept (ADR 0032). `bos upgrade` reconciles exactly the
 * files listed here from the parent template; app-owned files are never
 * considered. Consumers: sync (destToSource), prune (protection), and the
 * structure guardrail test.
 */

export const FRAMEWORK_OWNED_SYNC_FILES = new Set([
  ".env.example",
  ".gitignore",
  "biome.json",
  "package.json",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/staging.yml",
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
  "FRAMEWORK-OWNED — reconciled from the parent template by `bos upgrade`.",
  "Local edits are allowed: on the next upgrade the template version wins and your",
  "copy is backed up under `.bos/sync-backup/`. To make a change permanent, file an",
  "issue: https://github.com/NEARBuilders/everything-dev/issues",
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

/**
 * The intra-file child-owned block (#538): a framework-owned file may embed a
 * marked span that sync never rewrites — the content between the two marker
 * comments is spliced back out of the child's local copy and re-inserted into
 * the freshly-built template content before any hash is computed, so the
 * markers live in the template (the single source of truth for what sync
 * preserves) while the span's content is child-owned forever. Files: the
 * whole-file marker covers most cases (ADR 0032); this is the two spots where
 * the template used to overwrite child content inside files it owns.
 */
export const CHILD_OWNED_BLOCK_START = "// child-owned-start";
export const CHILD_OWNED_BLOCK_END = "// child-owned-end";

/**
 * Extracts the child-authored span from a synced file's local copy: the text
 * between the two marker comments, dedented by the span's common leading
 * indent (splice re-indents with the template's marker indentation, so
 * extract→splice→extract is byte-stable). Files synced before #538 carry no
 * markers; for the api/plugin.dev.ts shape a legacy fallback lifts the entire
 * `variables: { … },` literal so children's existing dev variables (citynode's
 * domain/gatewayDomains) migrate onto the marker protocol on the next sync.
 */
export function extractChildOwnedBlock(localContent: string): string | null {
  const start = localContent.indexOf(CHILD_OWNED_BLOCK_START);
  const end = localContent.indexOf(CHILD_OWNED_BLOCK_END);
  let lines: string[];
  if (start !== -1 && end !== -1 && end > start) {
    const afterStartMarker = start + CHILD_OWNED_BLOCK_START.length;
    const afterMarkerNewline = localContent.indexOf("\n", afterStartMarker) + 1;
    const endLineStart = localContent.lastIndexOf("\n", end) + 1;
    if (endLineStart < afterMarkerNewline) return null;
    lines = localContent.slice(afterMarkerNewline, endLineStart).split("\n");
  } else {
    const match = /(?:^|\n)(\s*)variables: \{/.exec(localContent);
    if (!match) return null;
    const openStart = match.index + match[0].length - "variables: {".length;
    let depth = 0;
    let i = openStart;
    for (; i < localContent.length; i++) {
      if (localContent[i] === "{") depth++;
      else if (localContent[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return null;
    let cut = localContent.slice(openStart, i + 1);
    if (localContent[i + 1] === ",") cut += ",";
    // The anchor line starts at its authored indent while inner lines sit one
    // step deeper — strip the anchor indent so the span joins the marker
    // protocol at the templated depth (splice re-indents).
    const anchorIndent = match[1]?.length ?? 0;
    lines = cut
      .split("\n")
      .map((line, index) =>
        index === 0
          ? line
          : line.startsWith(" ".repeat(anchorIndent))
            ? line.slice(anchorIndent)
            : line.replace(/^ +/, ""),
      );
  }

  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0) return null;
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => /^ */.exec(line)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(common, line.length) || 0)).join("\n");
}

/**
 * Re-inserts a child-owned span into a template copy between the marker
 * comments, indenting every span line with the template markers' indentation
 * (the mirror of extractChildOwnedBlock's dedent). Returns the template
 * verbatim when it carries no markers — non-marked files keep their
 * whole-file ownership semantics.
 */
export function spliceChildOwnedBlock(templateContent: string, childBlock: string): string {
  const start = templateContent.indexOf(CHILD_OWNED_BLOCK_START);
  const end = templateContent.indexOf(CHILD_OWNED_BLOCK_END);
  if (start === -1 || end === -1 || end < start) return templateContent;
  const markerLineStart = templateContent.lastIndexOf("\n", start) + 1;
  const indent = /^ */.exec(templateContent.slice(markerLineStart))?.[0] ?? "";
  const endLineStart = templateContent.lastIndexOf("\n", end) + 1;
  const indented = childBlock
    .split("\n")
    .map((line) => (line === "" ? line : indent + line))
    .join("\n");
  return `${templateContent.slice(0, start + CHILD_OWNED_BLOCK_START.length)}\n${indented}\n${templateContent.slice(endLineStart)}`;
}
