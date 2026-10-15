import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { glob } from "glob";
import type {
  ImportMigrationCollision,
  ImportOptions,
  ImportResult,
  ImportRouteDelta,
} from "../contract";
import { computeSnapshotHash } from "../utils/snapshot-hash";
import { findWorkspaceRoot } from "../workspace";
import { downloadTarball, parseGitHubUrl, runPnpmInstall, runTypesGen } from "./init";
import { readSnapshot, writeSnapshot } from "./snapshot";
import { mergePackageJson } from "./sync";

const SUBTREE_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.bos/**",
  "**/.every-plugin/**",
];

const IMPORT_SNAPSHOT_FILE = "import-snapshot.json";
const IMPORT_REPORT_FILE = "import-report.md";

export const IMPORT_REPORT_PATH = `.bos/${IMPORT_REPORT_FILE}`;

export type ImportFromSpec =
  | { kind: "github"; repo: string; ref?: string }
  | { kind: "local"; dir: string };

export type ImportFileClass =
  | { kind: "added" }
  | { kind: "unchanged" }
  | { kind: "updated" }
  | { kind: "preserved-local" }
  | { kind: "preserved-local-edit" }
  | { kind: "merged" }
  | { kind: "conflict"; reason: "no-baseline" | "both-changed" };

export interface MigrationEntry {
  idx: number;
  tag: string;
  sha: string | null;
}

export interface ImportReportAnalysis {
  workspace: string;
  from: string;
  ref: string;
  resolvedSha?: string;
  sourceKind: "github" | "local";
  added: string[];
  updated: string[];
  unchanged: string[];
  preservedLocal: string[];
  preservedLocalEdit: string[];
  merged: string[];
  conflicts: Array<{ path: string; reason: "no-baseline" | "both-changed"; held: boolean }>;
  routeDelta?: ImportRouteDelta;
  migrationCollisions: ImportMigrationCollision[];
  localOnlyMigrations: string[];
  upstreamOnlyMigrations: string[];
  heldBackMigrations: string[];
}

export interface ImportDeps {
  confirm?: (info: {
    workspace: string;
    conflictCount: number;
    migrationCollisionCount: number;
    heldCount: number;
  }) => Promise<boolean>;
}

function isExistingDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function normalizeGithubRepo(spec: string): string | null {
  if (parseGitHubUrl(spec)) {
    return spec;
  }
  const match = spec.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match?.[1] || !match[2]) return null;
  if (match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

export function parseFromSpec(spec: string): ImportFromSpec {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new Error(
      "--from is required: <owner>/<repo>[@<ref>], a GitHub URL, or a local directory",
    );
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    if (!isExistingDir(trimmed)) {
      throw new Error(`Local directory not found: ${trimmed}`);
    }
    return { kind: "local", dir: resolve(trimmed) };
  }

  const at = trimmed.indexOf("@");
  if (at > 0) {
    const head = trimmed.slice(0, at);
    const ref = trimmed.slice(at + 1);
    const repo = normalizeGithubRepo(head);
    if (repo && ref) {
      return { kind: "github", repo, ref };
    }
  }

  const repo = normalizeGithubRepo(trimmed);
  if (repo) {
    return { kind: "github", repo };
  }

  if (isExistingDir(trimmed)) {
    return { kind: "local", dir: resolve(trimmed) };
  }

  throw new Error(
    `Cannot parse --from source: ${spec}. Expected <owner>/<repo>[@<ref>], a GitHub URL, or a local directory.`,
  );
}

export function normalizeWorkspacePath(input: string): string {
  const trimmed = input.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (isAbsolute(input)) {
    throw new Error(`Workspace path must be repo-relative: ${input}`);
  }
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid workspace path: ${input}`);
  }
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Invalid workspace path: ${input}`);
  }
  return trimmed;
}

export async function listSubtreeFiles(root: string, workspace: string): Promise<string[]> {
  const matches = await glob(`${workspace}/**`, {
    cwd: root,
    nodir: true,
    dot: true,
    absolute: false,
    ignore: SUBTREE_IGNORE,
  });
  const files: string[] = [];
  for (const match of matches) {
    if (lstatSync(join(root, match)).isFile()) {
      files.push(match);
    }
  }
  return files.sort();
}

export function classifyImportFile(input: {
  localHash: string | null;
  upstreamHash: string;
  baselineHash: string | undefined;
  mergeable: boolean;
}): ImportFileClass {
  const { localHash, upstreamHash, baselineHash, mergeable } = input;
  if (localHash === null) {
    return { kind: "added" };
  }
  if (localHash === upstreamHash) {
    return { kind: "unchanged" };
  }
  if (baselineHash === undefined) {
    return mergeable ? { kind: "merged" } : { kind: "conflict", reason: "no-baseline" };
  }
  if (localHash === baselineHash) {
    return mergeable ? { kind: "merged" } : { kind: "updated" };
  }
  if (upstreamHash === baselineHash) {
    return { kind: "preserved-local-edit" };
  }
  return mergeable ? { kind: "merged" } : { kind: "conflict", reason: "both-changed" };
}

export function extractContractRoutes(source: string): string[] {
  const routes = new Set<string>();
  const marker = ".route(";
  let cursor = source.indexOf(marker);
  while (cursor !== -1) {
    const open = cursor + marker.length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const arg = source.slice(open + 1, end);
    const method = arg.match(/\bmethod:\s*["']([A-Za-z]+)["']/)?.[1];
    const path = arg.match(/\bpath:\s*["']([^"']+)["']/)?.[1];
    if (method && path) {
      routes.add(`${method} ${path}`);
    }
    cursor = source.indexOf(marker, cursor + 1);
  }
  return [...routes].sort();
}

export function computeRouteDelta(ours: string[], theirs: string[]): ImportRouteDelta {
  const oursSet = new Set(ours);
  const theirsSet = new Set(theirs);
  return {
    oursOnly: ours.filter((route) => !theirsSet.has(route)),
    theirsOnly: theirs.filter((route) => !oursSet.has(route)),
  };
}

async function collectContractRouteSources(
  root: string,
  workspace: string,
): Promise<string[] | null> {
  const sources: string[] = [];
  const mainPath = join(root, workspace, "src", "contract.ts");
  if (existsSync(mainPath)) {
    sources.push(readFileSync(mainPath, "utf-8"));
  }
  const splitDir = join(root, workspace, "src", "contract");
  if (existsSync(splitDir) && lstatSync(splitDir).isDirectory()) {
    const matches = await glob("**/*.{ts,tsx}", {
      cwd: splitDir,
      nodir: true,
      absolute: false,
    });
    for (const match of matches.sort()) {
      sources.push(readFileSync(join(splitDir, match), "utf-8"));
    }
  }
  return sources.length > 0 ? sources : null;
}

function extractWorkspaceRoutes(sources: string[] | null): string[] | null {
  if (sources === null) {
    return null;
  }
  const routes = new Set<string>();
  for (const source of sources) {
    for (const route of extractContractRoutes(source)) {
      routes.add(route);
    }
  }
  return [...routes].sort();
}

export function loadMigrationEntries(root: string, workspace: string): MigrationEntry[] | null {
  const journalPath = join(root, workspace, "src", "db", "migrations", "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    return null;
  }
  let journal: unknown;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf-8"));
  } catch {
    return null;
  }
  const entries = (journal as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return null;
  }
  const migrationsDir = join(root, workspace, "src", "db", "migrations");
  const result: MigrationEntry[] = [];
  for (const raw of entries) {
    const entry = raw as { idx?: unknown; tag?: unknown };
    if (typeof entry.idx !== "number" || typeof entry.tag !== "string") {
      continue;
    }
    const sqlPath = join(migrationsDir, `${entry.tag}.sql`);
    let sha: string | null = null;
    if (existsSync(sqlPath)) {
      try {
        sha = computeSnapshotHash(readFileSync(sqlPath));
      } catch {
        sha = null;
      }
    }
    result.push({ idx: entry.idx, tag: entry.tag, sha });
  }
  return result.sort((a, b) => a.idx - b.idx);
}

export function detectMigrationCollisions(
  local: MigrationEntry[],
  upstream: MigrationEntry[],
): ImportMigrationCollision[] {
  const collisions: ImportMigrationCollision[] = [];
  const maxLocalIdx = local.reduce((max, entry) => Math.max(max, entry.idx), -1);
  for (const entry of upstream) {
    const atIdx = local.find((candidate) => candidate.idx === entry.idx);
    if (atIdx) {
      if (atIdx.tag !== entry.tag) {
        collisions.push({
          kind: "idx-reuse",
          idx: entry.idx,
          localTag: atIdx.tag,
          upstreamTag: entry.tag,
          message: `idx ${entry.idx} is ${atIdx.tag} locally but ${entry.tag} upstream`,
        });
      } else if (atIdx.sha && entry.sha && atIdx.sha !== entry.sha) {
        collisions.push({
          kind: "tag-mismatch",
          idx: entry.idx,
          localTag: atIdx.tag,
          upstreamTag: entry.tag,
          message: `${entry.tag} has different content locally than upstream — already-applied hashes would drift`,
        });
      }
      continue;
    }
    if (entry.idx <= maxLocalIdx) {
      collisions.push({
        kind: "out-of-order",
        idx: entry.idx,
        upstreamTag: entry.tag,
        message: `upstream ${entry.tag} lands at idx ${entry.idx}, below the local chain tail (idx ${maxLocalIdx})`,
      });
    }
  }
  return collisions;
}

function hashFile(root: string, path: string): string | null {
  const fullPath = join(root, path);
  if (!existsSync(fullPath)) {
    return null;
  }
  try {
    return computeSnapshotHash(readFileSync(fullPath));
  } catch {
    return null;
  }
}

function safeProjectPath(projectDir: string, path: string): string {
  const dest = join(projectDir, path);
  const rel = relative(projectDir, dest);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to write outside the project: ${path}`);
  }
  return dest;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

interface ImportSnapshot {
  workspaces: Record<
    string,
    { from: string; ref: string; timestamp: string; files: Record<string, string> }
  >;
}

function readImportSnapshot(projectDir: string): ImportSnapshot {
  const path = join(projectDir, ".bos", IMPORT_SNAPSHOT_FILE);
  if (!existsSync(path)) {
    return { workspaces: {} };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    const workspaces = (parsed as { workspaces?: unknown }).workspaces;
    if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
      return { workspaces: workspaces as ImportSnapshot["workspaces"] };
    }
    return { workspaces: {} };
  } catch {
    return { workspaces: {} };
  }
}

function writeImportSnapshot(projectDir: string, snapshot: ImportSnapshot): void {
  const dir = join(projectDir, ".bos");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, IMPORT_SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`);
}

function writeImportReport(projectDir: string, content: string): string {
  const dir = join(projectDir, ".bos");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, IMPORT_REPORT_FILE), content);
  return IMPORT_REPORT_PATH;
}

function backupImportFiles(projectDir: string, paths: string[]): string | undefined {
  const existing = paths.filter((path) => existsSync(join(projectDir, path)));
  if (existing.length === 0) {
    return undefined;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(projectDir, ".bos", "import-backup", stamp);
  for (const path of existing) {
    const dest = safeProjectPath(backupDir, path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(projectDir, path), dest);
  }
  return backupDir;
}

function listSection(title: string, items: string[], held?: ReadonlySet<string>): string[] {
  if (items.length === 0) {
    return [`## ${title}`, "", "(none)", ""];
  }
  return [
    `## ${title}`,
    "",
    ...items.map((item) => (held?.has(item) ? `- \`${item}\` (held)` : `- \`${item}\``)),
    "",
  ];
}

export function buildImportReport(
  analysis: ImportReportAnalysis,
  outcome: { mode: "dry-run" | "applied" | "refused"; backupDir?: string },
): string {
  const lines: string[] = [];
  lines.push(`# bos import report — \`${analysis.workspace}\``);
  lines.push("");
  const source =
    analysis.sourceKind === "local"
      ? `\`${analysis.from}\` (local directory)`
      : `\`${analysis.from}\`${analysis.ref ? ` @ \`${analysis.ref}\`` : ""}`;
  lines.push(`- **Source:** ${source}`);
  if (analysis.resolvedSha) {
    lines.push(`- **Resolved commit:** \`${analysis.resolvedSha}\``);
  }
  const modeLabel =
    outcome.mode === "dry-run"
      ? "Dry run — no files written"
      : outcome.mode === "applied"
        ? "Applied — upstream written over shared files"
        : "Refused — unresolvable conflicts exist, nothing was written";
  lines.push(`- **Mode:** ${modeLabel}`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| bucket | count |");
  lines.push("| --- | --- |");
  lines.push(`| added (upstream-only) | ${analysis.added.length} |`);
  lines.push(`| updated (local unchanged, upstream changed) | ${analysis.updated.length} |`);
  lines.push(`| merged (structured package.json merge) | ${analysis.merged.length} |`);
  lines.push(`| conflicts (unresolvable) | ${analysis.conflicts.length} |`);
  lines.push(`| migration collisions | ${analysis.migrationCollisions.length} |`);
  lines.push(`| migration chain held back | ${analysis.heldBackMigrations.length} |`);
  lines.push(`| local-only (preserved) | ${analysis.preservedLocal.length} |`);
  lines.push(
    `| local edits preserved (upstream unchanged) | ${analysis.preservedLocalEdit.length} |`,
  );
  lines.push(`| unchanged | ${analysis.unchanged.length} |`);
  lines.push("");

  if (analysis.conflicts.length > 0) {
    lines.push("## Conflicts — manual-port checklist");
    lines.push("");
    lines.push("| file | reason |");
    lines.push("| --- | --- |");
    for (const conflict of analysis.conflicts) {
      const reason =
        conflict.reason === "no-baseline"
          ? "no import baseline (first import or snapshot gap)"
          : "local and upstream both changed since the baseline";
      lines.push(
        `| \`${conflict.path}\` | ${reason}${conflict.held ? " — held (migration chain)" : ""} |`,
      );
    }
    lines.push("");
    const appliedConflicts = analysis.conflicts.filter((conflict) => !conflict.held);
    if (outcome.mode === "refused") {
      lines.push(
        "Nothing was written. Re-run with `--yes` to apply upstream over these files (local copies are backed up first), then port local-only content back onto the new upstream versions.",
      );
    } else if (outcome.mode === "applied") {
      if (appliedConflicts.length > 0) {
        lines.push(
          `Upstream was applied over ${appliedConflicts.length} of these file(s)${
            outcome.backupDir ? ` — local copies backed up at \`${outcome.backupDir}\`` : ""
          }. Port local-only content back onto the new upstream versions.`,
        );
      }
      if (analysis.heldBackMigrations.length > 0) {
        lines.push(
          "Migration-chain conflicts were held back and NOT written — see the held-back section below.",
        );
      }
    } else {
      lines.push(
        "A real run with `--yes` would overwrite these with upstream (backing up local copies first); migration-chain files would be held back.",
      );
    }
    lines.push("");
  }

  if (analysis.migrationCollisions.length > 0) {
    lines.push("## Migration chain collisions");
    lines.push("");
    lines.push("| kind | idx | local | upstream | detail |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const collision of analysis.migrationCollisions) {
      lines.push(
        `| ${collision.kind} | ${collision.idx} | \`${collision.localTag ?? "—"}\` | \`${collision.upstreamTag ?? "—"}\` | ${collision.message} |`,
      );
    }
    lines.push("");
    lines.push(
      "Migration renumbering is not performed by `bos import` yet — reconciliation lands in NEARBuilders/everything-dev#393.",
    );
    lines.push("");
  }

  if (analysis.heldBackMigrations.length > 0) {
    lines.push("## Migration chain held back");
    lines.push("");
    for (const path of analysis.heldBackMigrations) lines.push(`- \`${path}\``);
    lines.push("");
    lines.push(
      "`src/db/migrations/**` was not modified: a verbatim overwrite would drop local journal entries that upstream lacks (or collide on shared indices), leaving applied hashes orphaned. The rest of the workspace imported normally; chain reconciliation lands in NEARBuilders/everything-dev#393.",
    );
    lines.push("");
  }

  if (analysis.localOnlyMigrations.length > 0 || analysis.upstreamOnlyMigrations.length > 0) {
    lines.push("## Migration chain delta");
    lines.push("");
    if (analysis.localOnlyMigrations.length > 0) {
      lines.push("Local-only (preserved, never renumbered):");
      lines.push("");
      for (const tag of analysis.localOnlyMigrations) lines.push(`- \`${tag}\``);
      lines.push("");
    }
    if (analysis.upstreamOnlyMigrations.length > 0) {
      lines.push("Upstream-only:");
      lines.push("");
      for (const tag of analysis.upstreamOnlyMigrations) lines.push(`- \`${tag}\``);
      lines.push("");
    }
  }

  if (analysis.routeDelta) {
    lines.push("## Contract route-set delta");
    lines.push("");
    if (analysis.routeDelta.oursOnly.length === 0 && analysis.routeDelta.theirsOnly.length === 0) {
      lines.push("Route sets are identical.");
      lines.push("");
    } else {
      lines.push(
        `Ours-only: ${analysis.routeDelta.oursOnly.length}, theirs-only: ${analysis.routeDelta.theirsOnly.length}.`,
      );
      lines.push("");
      for (const route of analysis.routeDelta.oursOnly) lines.push(`- ours only: \`${route}\``);
      for (const route of analysis.routeDelta.theirsOnly) lines.push(`- theirs only: \`${route}\``);
      lines.push("");
    }
  }

  const heldSet = new Set(analysis.heldBackMigrations);
  lines.push(...listSection("Added (upstream-only)", analysis.added, heldSet));
  lines.push(
    ...listSection("Updated (would be overwritten with upstream)", analysis.updated, heldSet),
  );
  lines.push(
    ...listSection("Merged (package.json — local-only keys preserved)", analysis.merged, heldSet),
  );
  lines.push(...listSection("Local-only (preserved, never deleted)", analysis.preservedLocal));
  lines.push(
    ...listSection("Local edits preserved (upstream unchanged)", analysis.preservedLocalEdit),
  );
  lines.push(
    `## Unchanged`,
    "",
    `${analysis.unchanged.length} file(s) identical on both sides.`,
    "",
  );

  lines.push("## Next steps");
  lines.push("");
  lines.push(
    "- `bos types gen` (and a build) regenerates `*.gen.ts` and `types/contract.d.ts` against the imported contract.",
  );
  lines.push(
    "- If preserved local changes should live upstream, open a PR against the source repo rather than keeping them only locally.",
  );
  lines.push("");
  return lines.join("\n");
}

async function resolveImportSource(spec: ImportFromSpec): Promise<{
  root: string;
  cleanup: () => Promise<void>;
  ref: string;
  resolvedSha?: string;
}> {
  if (spec.kind === "local") {
    return { root: spec.dir, cleanup: async () => {}, ref: "local" };
  }
  const tarball = await downloadTarball(spec.repo, spec.ref);
  return {
    root: tarball.dir,
    cleanup: tarball.cleanup,
    ref: spec.ref ?? tarball.resolvedRef ?? "main",
    resolvedSha: tarball.resolvedSha,
  };
}

export async function importWorkspace(
  projectDir: string,
  options: ImportOptions,
  deps?: ImportDeps,
): Promise<ImportResult> {
  const errorResult = (workspace: string, ref: string, message: string): ImportResult => ({
    status: "error",
    workspace,
    from: options.from,
    ref,
    added: [],
    updated: [],
    unchanged: [],
    preservedLocal: [],
    merged: [],
    conflicts: [],
    heldBackMigrations: [],
    migrationCollisions: [],
    error: message,
  });

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  let workspace = options.workspace;
  let ref = "";
  try {
    workspace = normalizeWorkspacePath(options.workspace);
    const spec = parseFromSpec(options.from);
    const source = await resolveImportSource(spec);
    ref = source.ref;

    try {
      const upstreamWorkspaceDir = join(source.root, workspace);
      if (!existsSync(upstreamWorkspaceDir) || !lstatSync(upstreamWorkspaceDir).isDirectory()) {
        throw new Error(
          `Workspace "${workspace}" not found in ${options.from}${
            source.ref !== "local" ? ` at ref ${source.ref}` : ""
          }`,
        );
      }

      const upstreamFiles = await listSubtreeFiles(source.root, workspace);
      const localWorkspaceDir = join(projectDir, workspace);
      const localFiles = existsSync(localWorkspaceDir)
        ? await listSubtreeFiles(projectDir, workspace)
        : [];

      const upstreamSet = new Set(upstreamFiles);
      const localSet = new Set(localFiles);

      const importSnapshot = readImportSnapshot(projectDir);
      const workspaceSnapshot = importSnapshot.workspaces[workspace];
      const syncSnapshot = await readSnapshot(projectDir);
      const baselineFor = (path: string): string | undefined =>
        workspaceSnapshot?.files[path] ?? syncSnapshot?.files[path];

      const packageJsonPath = `${workspace}/package.json`;
      const mergeablePackageJson = (() => {
        if (!localSet.has(packageJsonPath) || !upstreamSet.has(packageJsonPath)) return false;
        return (
          readJson(join(projectDir, packageJsonPath)) !== null &&
          readJson(join(source.root, packageJsonPath)) !== null
        );
      })();

      const added: string[] = [];
      const updated: string[] = [];
      const unchanged: string[] = [];
      const preservedLocal: string[] = [];
      const preservedLocalEdit: string[] = [];
      const merged: string[] = [];
      const conflicts: Array<{
        path: string;
        reason: "no-baseline" | "both-changed";
        held: boolean;
      }> = [];
      const upstreamHashByPath = new Map<string, string>();

      const allPaths = [...new Set([...localFiles, ...upstreamFiles])].sort();
      for (const path of allPaths) {
        if (!upstreamSet.has(path)) {
          preservedLocal.push(path);
          continue;
        }
        const localHash = localSet.has(path) ? hashFile(projectDir, path) : null;
        const upstreamHash = hashFile(source.root, path);
        if (upstreamHash === null) {
          throw new Error(`Failed to read upstream file: ${path}`);
        }
        upstreamHashByPath.set(path, upstreamHash);
        const classification = classifyImportFile({
          localHash,
          upstreamHash,
          baselineHash: baselineFor(path),
          mergeable: path === packageJsonPath && mergeablePackageJson,
        });
        switch (classification.kind) {
          case "added":
            added.push(path);
            break;
          case "unchanged":
            unchanged.push(path);
            break;
          case "updated":
            updated.push(path);
            break;
          case "preserved-local":
            preservedLocal.push(path);
            break;
          case "preserved-local-edit":
            preservedLocalEdit.push(path);
            break;
          case "merged":
            merged.push(path);
            break;
          case "conflict":
            conflicts.push({ path, reason: classification.reason, held: false });
            break;
        }
      }

      let routeDelta: ImportRouteDelta | undefined;
      const localRoutes = extractWorkspaceRoutes(
        await collectContractRouteSources(projectDir, workspace),
      );
      const upstreamRoutes = extractWorkspaceRoutes(
        await collectContractRouteSources(source.root, workspace),
      );
      if (localRoutes !== null || upstreamRoutes !== null) {
        routeDelta = computeRouteDelta(localRoutes ?? [], upstreamRoutes ?? []);
      }

      const localMigrations = loadMigrationEntries(projectDir, workspace);
      const upstreamMigrations = loadMigrationEntries(source.root, workspace);
      const migrationCollisions =
        localMigrations && upstreamMigrations
          ? detectMigrationCollisions(localMigrations, upstreamMigrations)
          : [];
      const localTags = new Set(localMigrations?.map((entry) => entry.tag) ?? []);
      const upstreamTags = new Set(upstreamMigrations?.map((entry) => entry.tag) ?? []);
      const localOnlyMigrations = [...localTags].filter((tag) => !upstreamTags.has(tag)).sort();
      const upstreamOnlyMigrations = [...upstreamTags].filter((tag) => !localTags.has(tag)).sort();

      const chainPrefix = `${workspace}/src/db/migrations/`;
      const chainUnsafe =
        localMigrations !== null &&
        upstreamMigrations !== null &&
        (migrationCollisions.length > 0 || localOnlyMigrations.length > 0);
      const writeCandidates = new Set([
        ...added,
        ...updated,
        ...merged,
        ...conflicts.map((conflict) => conflict.path),
      ]);
      const heldSet = new Set(
        chainUnsafe ? [...writeCandidates].filter((path) => path.startsWith(chainPrefix)) : [],
      );
      const heldBackMigrations = [...heldSet].sort();
      for (const conflict of conflicts) {
        conflict.held = heldSet.has(conflict.path);
      }

      const analysis: ImportReportAnalysis = {
        workspace,
        from: options.from,
        ref: source.ref,
        resolvedSha: source.resolvedSha,
        sourceKind: spec.kind,
        added,
        updated,
        unchanged,
        preservedLocal,
        preservedLocalEdit,
        merged,
        conflicts,
        routeDelta,
        migrationCollisions,
        localOnlyMigrations,
        upstreamOnlyMigrations,
        heldBackMigrations,
      };

      const resultBase = {
        workspace,
        from: options.from,
        ref: source.ref,
        resolvedSha: source.resolvedSha,
        added,
        updated,
        unchanged,
        preservedLocal,
        merged,
        conflicts: conflicts.map((conflict) => conflict.path),
        heldBackMigrations,
        routeDelta,
        migrationCollisions,
      };

      if (options.dryRun) {
        const reportPath = writeImportReport(
          projectDir,
          buildImportReport(analysis, { mode: "dry-run" }),
        );
        return { status: "dry-run", ...resultBase, reportPath };
      }

      const gated = conflicts.length > 0 || heldBackMigrations.length > 0;
      if (gated && !options.yes) {
        let approved = false;
        if (deps?.confirm) {
          approved = await deps.confirm({
            workspace,
            conflictCount: conflicts.length,
            migrationCollisionCount: migrationCollisions.length,
            heldCount: heldBackMigrations.length,
          });
        }
        if (!approved) {
          const reportPath = writeImportReport(
            projectDir,
            buildImportReport(analysis, { mode: "refused" }),
          );
          return { status: "conflicts", ...resultBase, reportPath };
        }
      }

      const isHeld = (path: string): boolean => heldSet.has(path);

      const mergeContents = new Map<string, string>();
      for (const path of merged) {
        const local = readJson(join(projectDir, path));
        const upstream = readJson(join(source.root, path));
        if (!local || !upstream) {
          throw new Error(`Failed to merge ${path}: unreadable package.json`);
        }
        mergeContents.set(
          path,
          `${JSON.stringify(mergePackageJson(path, local, upstream), null, 2)}\n`,
        );
      }

      const overwritePaths = [
        ...updated.filter((path) => !isHeld(path)),
        ...conflicts.map((conflict) => conflict.path).filter((path) => !isHeld(path)),
        ...merged.filter(
          (path) => mergeContents.get(path) !== readFileSync(join(projectDir, path), "utf-8"),
        ),
      ];
      const backupDir = backupImportFiles(projectDir, overwritePaths);

      const writeUpstream = (path: string) => {
        const dest = safeProjectPath(projectDir, path);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(source.root, path), dest);
      };

      for (const path of added) {
        if (!isHeld(path)) writeUpstream(path);
      }
      for (const path of updated) {
        if (!isHeld(path)) writeUpstream(path);
      }
      for (const conflict of conflicts) {
        if (!isHeld(conflict.path)) writeUpstream(conflict.path);
      }
      for (const path of merged) {
        const content = mergeContents.get(path);
        if (content === undefined || isHeld(path)) continue;
        if (content === readFileSync(join(projectDir, path), "utf-8")) continue;
        const dest = safeProjectPath(projectDir, path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, content);
      }

      const writtenPaths = [
        ...added,
        ...updated,
        ...merged,
        ...conflicts.map((conflict) => conflict.path),
      ].filter((path) => !isHeld(path));
      const recorded: Record<string, string> = {};
      for (const path of writtenPaths) {
        const hash = hashFile(projectDir, path);
        if (hash) {
          recorded[path] = hash;
        }
      }
      for (const path of [...unchanged, ...preservedLocalEdit]) {
        const hash = upstreamHashByPath.get(path);
        if (hash) {
          recorded[path] = hash;
        }
      }

      writeImportSnapshot(projectDir, {
        workspaces: {
          ...importSnapshot.workspaces,
          [workspace]: {
            from: options.from,
            ref: source.ref,
            timestamp: new Date().toISOString(),
            files: recorded,
          },
        },
      });

      if (syncSnapshot) {
        await writeSnapshot(projectDir, {
          parentRef: syncSnapshot.parentRef,
          files: { ...syncSnapshot.files, ...recorded },
          starter: syncSnapshot.starter,
        });
      }

      const reportPath = writeImportReport(
        projectDir,
        buildImportReport(analysis, { mode: "applied", backupDir }),
      );

      if (!options.noInstall) {
        try {
          await runPnpmInstall(findWorkspaceRoot(projectDir)?.dir ?? projectDir);
          await runTypesGen(projectDir);
        } catch (error) {
          return {
            status: "error",
            ...resultBase,
            backupDir,
            reportPath,
            error: `Import applied, but the post-install step failed: ${errorMessage(error)}`,
          };
        }
      }

      return { status: "imported", ...resultBase, backupDir, reportPath };
    } finally {
      await source.cleanup();
    }
  } catch (error) {
    return errorResult(workspace, ref, errorMessage(error));
  }
}
