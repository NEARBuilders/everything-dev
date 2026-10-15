import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { glob } from "glob";
import { extract as tarExtract } from "tar";
import { localConfigEntryPath } from "../config";
import type {
  ImportMigrationCollision,
  ImportOptions,
  ImportResult,
  ImportRouteDelta,
} from "../contract";
import { parseBosUrl } from "../fastkv";
import { fetchResponse } from "../http-client";
import { computeSriHash } from "../integrity";
import { resolveExtendsRef } from "../merge";
import type { ResolutionIo } from "../resolution/session";
import { type WalkLink, walkExtendsChain } from "../resolution/session";
import type { ExtendsConfig } from "../types";
import { computeSnapshotHash } from "../utils/snapshot-hash";
import { listWorkspaceSubtreeFiles } from "../utils/workspace-subtree";
import { findWorkspaceRoot } from "../workspace";
import { downloadTarball, parseGitHubUrl, runPnpmInstall, runTypesGen } from "./init";
import { readSnapshot, writeSnapshot } from "./snapshot";
import { mergePackageJson } from "./sync";

const IMPORT_SNAPSHOT_FILE = "import-snapshot.json";
const IMPORT_REPORT_FILE = "import-report.md";

export const IMPORT_REPORT_PATH = `.bos/${IMPORT_REPORT_FILE}`;

export type ImportFromSpec =
  | { kind: "github"; repo: string; ref?: string }
  | { kind: "archive"; url: string; integrity: string }
  | { kind: "bos"; bosUrl: string; account: string; gateway: string }
  | { kind: "local"; dir: string };

export interface ImportChainProvenance {
  /** the ref the chain was walked from: the bos:// source or the child's resolved extends */
  extendsRef: string;
  /** the runtime whose own config declares the workspace */
  ancestorRef: string;
  /** git ref pinned from the ancestor's published version manifest, when present */
  pinnedSha?: string;
  /** GitHub coordinate resolved rootward, when the chain publishes one */
  repository?: string;
  /** source archive coordinate from the ancestor's version manifest, when published */
  sourceArchive?: { file: string; url: string; integrity: string };
  warnings: string[];
}

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
  sourceKind: "github" | "local" | "archive";
  chain?: ImportChainProvenance;
  added: string[];
  updated: string[];
  unchanged: string[];
  preservedLocal: string[];
  preservedLocalEdit: string[];
  merged: string[];
  conflicts: Array<{ path: string; reason: "no-baseline" | "both-changed"; held: boolean }>;
  routeDelta?: ImportRouteDelta;
  migrationCollisions: ImportMigrationCollision[];
  migrationReconciliation: MigrationReconciliation | null;
  heldBackMigrations: string[];
}

export interface ImportDeps {
  confirm?: (info: {
    workspace: string;
    conflictCount: number;
    migrationCollisionCount: number;
    heldCount: number;
    appendedCount: number;
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
      "--from is required: bos://<account>/<gateway>, <owner>/<repo>[@<ref>], a GitHub URL, or a local directory",
    );
  }

  if (trimmed.startsWith("bos://")) {
    const hashIndex = trimmed.indexOf("#");
    const bosPart = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
    const target = hashIndex === -1 ? undefined : trimmed.slice(hashIndex + 1).trim();
    if (target) {
      throw new Error(
        `Targeted extends refs are not supported for import sources: ${spec}. Omit the #target and pass the workspace as the positional argument.`,
      );
    }
    const parsed = parseBosUrl(bosPart);
    if (parsed.pathSegments.length > 0) {
      throw new Error(`Unsupported bos:// path — expected bos://<account>/<gateway>: ${spec}`);
    }
    return {
      kind: "bos",
      bosUrl: `bos://${parsed.accountId}/${parsed.gatewayId}`,
      account: parsed.accountId,
      gateway: parsed.gatewayId,
    };
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
    `Cannot parse --from source: ${spec}. Expected bos://<account>/<gateway>, <owner>/<repo>[@<ref>], a GitHub URL, or a local directory.`,
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
  return listWorkspaceSubtreeFiles(root, workspace);
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
  const journalPath = journalPathFor(root, workspace);
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

interface RawMigrationJournal {
  journal: Record<string, unknown>;
  entries: Record<string, unknown>[];
}

function journalPathFor(root: string, workspace: string): string {
  return join(root, workspace, "src", "db", "migrations", "meta", "_journal.json");
}

function loadRawJournal(root: string, workspace: string): RawMigrationJournal | null {
  const journalPath = journalPathFor(root, workspace);
  if (!existsSync(journalPath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalPath, "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return null;
  }
  return {
    journal: parsed as Record<string, unknown>,
    entries: entries as Record<string, unknown>[],
  };
}

function buildMergedJournal(
  localRoot: string,
  upstreamRoot: string,
  workspace: string,
  appended: MigrationAppend[],
): string | null {
  const localRaw = loadRawJournal(localRoot, workspace);
  const upstreamRaw = loadRawJournal(upstreamRoot, workspace);
  if (!localRaw || !upstreamRaw) {
    return null;
  }
  const upstreamEntryByTag = new Map<string, Record<string, unknown>>();
  for (const entry of upstreamRaw.entries) {
    if (typeof entry.tag === "string") {
      upstreamEntryByTag.set(entry.tag, entry);
    }
  }
  const maxLocalWhen = localRaw.entries.reduce(
    (max, entry) => Math.max(max, typeof entry.when === "number" ? entry.when : 0),
    0,
  );
  let appendedWhen = maxLocalWhen;
  const appendedEntries = appended.map((append) => {
    const raw = upstreamEntryByTag.get(append.fromTag);
    const when =
      typeof raw?.when === "number" && raw.when > appendedWhen ? raw.when : ++appendedWhen;
    return { ...(raw ?? {}), idx: append.idx, tag: append.toTag, when };
  });
  const merged = { ...localRaw.journal, entries: [...localRaw.entries, ...appendedEntries] };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

export interface MigrationAppend {
  idx: number;
  fromTag: string;
  toTag: string;
}

export interface MigrationReconciliation {
  kept: string[];
  appended: MigrationAppend[];
  contentMatched: string[];
  unresolvable: ImportMigrationCollision[];
}

const MIGRATION_TAG_PATTERN = /^(\d+)_(.+)$/;

function migrationTagFor(idx: number, fromTag: string): string {
  const suffix = fromTag.match(MIGRATION_TAG_PATTERN)?.[2];
  return suffix ? `${String(idx).padStart(4, "0")}_${suffix}` : fromTag;
}

function snapshotPrefixOf(tag: string): string | null {
  const match = tag.match(MIGRATION_TAG_PATTERN);
  return match?.[1] ? match[1].padStart(4, "0") : null;
}

export function reconcileMigrationChains(
  local: MigrationEntry[],
  upstream: MigrationEntry[],
): MigrationReconciliation {
  const localTags = new Set(local.map((entry) => entry.tag));
  const unresolvable: ImportMigrationCollision[] = [];
  const appended: MigrationAppend[] = [];
  const contentMatched: string[] = [];
  let nextIdx = local.reduce((max, entry) => Math.max(max, entry.idx), -1) + 1;
  for (const upstreamEntry of upstream) {
    if (localTags.has(upstreamEntry.tag)) {
      const localEntry = local.find((candidate) => candidate.tag === upstreamEntry.tag);
      if (localEntry?.sha && upstreamEntry.sha && localEntry.sha !== upstreamEntry.sha) {
        unresolvable.push({
          kind: "tag-mismatch",
          idx: upstreamEntry.idx,
          localTag: localEntry.tag,
          upstreamTag: upstreamEntry.tag,
          message: `${upstreamEntry.tag} has different content locally than upstream — already-applied hashes would drift`,
        });
      }
      continue;
    }
    if (upstreamEntry.sha && local.some((candidate) => candidate.sha === upstreamEntry.sha)) {
      contentMatched.push(upstreamEntry.tag);
      continue;
    }
    appended.push({
      idx: nextIdx,
      fromTag: upstreamEntry.tag,
      toTag: migrationTagFor(nextIdx, upstreamEntry.tag),
    });
    nextIdx++;
  }
  return { kept: local.map((entry) => entry.tag), appended, contentMatched, unresolvable };
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
  if (analysis.chain) {
    lines.push(`- **Source:** \`${analysis.chain.extendsRef}\` (extends chain)`);
    if (analysis.chain.sourceArchive) {
      lines.push(`- **Source archive:** \`${analysis.chain.sourceArchive.url}\``);
    }
    if (analysis.chain.repository) {
      lines.push(
        `- **Upstream:** \`${analysis.chain.repository}\` @ \`${analysis.ref}\`${analysis.chain.pinnedSha ? ` (pinned git sha \`${analysis.chain.pinnedSha}\`)` : ""}`,
      );
    }
    for (const warning of analysis.chain.warnings) {
      lines.push(`- **Note:** ${warning}`);
    }
  } else {
    const source =
      analysis.sourceKind === "local"
        ? `\`${analysis.from}\` (local directory)`
        : `\`${analysis.from}\`${analysis.ref ? ` @ \`${analysis.ref}\`` : ""}`;
    lines.push(`- **Source:** ${source}`);
  }
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
  lines.push(`| migration collisions (unresolvable) | ${analysis.migrationCollisions.length} |`);
  lines.push(
    `| migrations appended (renumbered from upstream) | ${analysis.migrationReconciliation?.appended.length ?? 0} |`,
  );
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

  if (analysis.migrationReconciliation) {
    const reconciliation = analysis.migrationReconciliation;
    lines.push("## Migration chain reconciliation");
    lines.push("");
    lines.push("Applied locally — kept verbatim, never renumbered or rehashed:");
    lines.push("");
    if (reconciliation.kept.length === 0) {
      lines.push("(no local journal entries)");
      lines.push("");
    } else {
      for (const tag of reconciliation.kept) lines.push(`- \`${tag}\``);
      lines.push("");
    }
    if (reconciliation.appended.length > 0) {
      lines.push("Appended — colliding upstream migrations renumbered after the local tail:");
      lines.push("");
      lines.push("| upstream tag | new tag | new idx |");
      lines.push("| --- | --- | --- |");
      for (const append of reconciliation.appended) {
        lines.push(`| \`${append.fromTag}\` | \`${append.toTag}\` | ${append.idx} |`);
      }
      lines.push("");
      lines.push(
        `Next boot will apply the ${reconciliation.appended.length} appended migration(s) above; the kept set is already applied to the database.`,
      );
      lines.push("");
    } else {
      lines.push(
        "Nothing to append: every upstream migration is already applied (by tag or by content).",
      );
      lines.push("");
    }
    if (reconciliation.contentMatched.length > 0) {
      lines.push("Already imported under another tag (matched by SQL content hash):");
      lines.push("");
      for (const tag of reconciliation.contentMatched) lines.push(`- \`${tag}\``);
      lines.push("");
    }
    if (reconciliation.appended.length > 0) {
      lines.push(
        "Snapshot-chain note: renamed snapshot files record upstream intermediate schema states; review `drizzle-kit generate` output against the merged chain before generating new migrations.",
      );
      lines.push("");
    }
  }

  if (analysis.migrationCollisions.length > 0) {
    lines.push("## Migration chain collisions — unresolvable");
    lines.push("");
    lines.push("| kind | idx | local | upstream | detail |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const collision of analysis.migrationCollisions) {
      lines.push(
        `| ${collision.kind} | ${collision.idx} | \`${collision.localTag ?? "—"}\` | \`${collision.upstreamTag ?? "—"}\` | ${collision.message} |`,
      );
    }
    lines.push("");
  }

  if (analysis.heldBackMigrations.length > 0) {
    lines.push("## Migration chain held back");
    lines.push("");
    for (const path of analysis.heldBackMigrations) lines.push(`- \`${path}\``);
    lines.push("");
    lines.push(
      "`src/db/migrations/**` was not modified: reconciliation could not produce a safe merged chain (content drift on an already-applied migration, or an unreadable journal). Resolve the collisions above, then re-import. The rest of the workspace imported normally.",
    );
    lines.push("");
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

const LOCAL_PREFIX = "local:";

export interface LocalWorkspaceSlot {
  /** config address of the declaring entry, e.g. `app.auth` or `plugins.ai` */
  slot: string;
}

export function localWorkspaceSlotOf(
  config: unknown,
  workspace: string,
): LocalWorkspaceSlot | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const node = config as Record<string, unknown>;
  const matches = (ref: unknown): boolean =>
    typeof ref === "string" &&
    ref.startsWith(LOCAL_PREFIX) &&
    ref.slice(LOCAL_PREFIX.length) === workspace;

  const app = node.app as Record<string, unknown> | undefined;
  if (app && typeof app === "object") {
    for (const key of ["host", "ui", "api", "auth"]) {
      const entry = app[key] as Record<string, unknown> | undefined;
      if (entry && typeof entry === "object" && matches(entry.development)) {
        return { slot: `app.${key}` };
      }
    }
  }
  const plugins = node.plugins as Record<string, unknown> | undefined;
  if (plugins && typeof plugins === "object") {
    for (const key of Object.keys(plugins)) {
      const entry = plugins[key] as Record<string, unknown> | undefined;
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        matches(entry.development)
      ) {
        return { slot: `plugins.${key}` };
      }
    }
  }
  return null;
}

export function configEntryAt(config: unknown, slot: string): Record<string, unknown> | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  const dot = slot.indexOf(".");
  if (dot === -1) {
    return null;
  }
  const container = (config as Record<string, unknown>)[slot.slice(0, dot)];
  const key = slot.slice(dot + 1);
  const entry =
    typeof container === "object" && container !== null && !Array.isArray(container)
      ? (container as Record<string, unknown>)[key]
      : undefined;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  return entry as Record<string, unknown>;
}

const HEAD_FALLBACK_NOTE = "importing the default branch (HEAD)";

export type VersionManifestFetcher = (url: string) => Promise<{
  bytes: Uint8Array;
  manifest: Record<string, unknown>;
}>;

async function defaultVersionManifestFetch(
  url: string,
): Promise<{ bytes: Uint8Array; manifest: Record<string, unknown> }> {
  const response = await fetchResponse(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return { bytes, manifest };
}

function manifestSourceOf(manifest: Record<string, unknown>): {
  file: string;
  integrity: string;
} | null {
  const source = manifest.source as { file?: unknown; integrity?: unknown } | undefined;
  if (
    source &&
    typeof source.file === "string" &&
    source.file.length > 0 &&
    typeof source.integrity === "string" &&
    source.integrity.length > 0
  ) {
    return { file: source.file, integrity: source.integrity };
  }
  return null;
}

export async function resolvePinnedSource(
  entry: Record<string, unknown> | null,
  fetchManifest: VersionManifestFetcher = defaultVersionManifestFetch,
): Promise<{ sha?: string; source?: { file: string; integrity: string }; warning?: string }> {
  if (!entry) {
    return { warning: `no config entry found for the pinned slot — ${HEAD_FALLBACK_NOTE}` };
  }
  const pin = entry.pin as { manifest?: unknown; integrity?: unknown } | undefined;
  const manifest = typeof pin?.manifest === "string" ? pin.manifest : undefined;
  const production = typeof entry.production === "string" ? entry.production : undefined;
  if (!manifest || !production) {
    return {
      warning: `no pinned version manifest on the published config — ${HEAD_FALLBACK_NOTE}`,
    };
  }
  const url = `${production.replace(/\/+$/, "")}/${manifest}`;
  let body: { bytes: Uint8Array; manifest: Record<string, unknown> };
  try {
    body = await fetchManifest(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { warning: `could not read the version manifest (${message}) — ${HEAD_FALLBACK_NOTE}` };
  }
  const pinIntegrity = typeof pin?.integrity === "string" ? pin.integrity : undefined;
  if (pinIntegrity) {
    const computed = computeSriHash(Buffer.from(body.bytes));
    if (computed !== pinIntegrity) {
      throw new Error(
        `Version manifest integrity mismatch for ${url} — expected ${pinIntegrity}, computed ${computed}. Refusing to fall back to GitHub.`,
      );
    }
  }
  const source = manifestSourceOf(body.manifest);
  if (typeof body.manifest.gitSha !== "string" || body.manifest.gitSha.length === 0) {
    return {
      warning: `the version manifest records no git sha (it pins content hashes only) — ${HEAD_FALLBACK_NOTE}; future deploys pin the exact commit`,
      ...(source ? { source } : {}),
    };
  }
  return { sha: body.manifest.gitSha, ...(source ? { source } : {}) };
}

const FROM_REMEDIES =
  "Pass the upstream explicitly: --from bos://<account>/<gateway> or --from <owner>/<repo>";

export async function resolveImportChain(input: {
  workspace: string;
  projectDir: string;
  entrySpec?: { bosUrl: string; account: string; gateway: string };
  io?: ResolutionIo;
  fetchVersionManifest?: VersionManifestFetcher;
}): Promise<{
  spec:
    | { kind: "github"; repo: string; ref?: string }
    | { kind: "archive"; url: string; integrity: string };
  provenance: ImportChainProvenance;
}> {
  const fromBosSpec = input.entrySpec !== undefined;
  const entry = fromBosSpec
    ? `bos://${input.entrySpec!.account}/${input.entrySpec!.gateway}`
    : (localConfigEntryPath(input.projectDir) ?? null);
  if (!entry) {
    throw new Error(`No authored config (bos.app.ts) found — ${FROM_REMEDIES}`);
  }

  const links: WalkLink[] = [];
  await walkExtendsChain(entry, {
    env: "production",
    io: input.io,
    visit: async (link) => {
      links.push(link);
    },
  });
  links.reverse();

  if (links.length === 0) {
    throw new Error(`Empty extends chain from ${entry}`);
  }

  const declaredIndex = links.findIndex(
    (link) => localWorkspaceSlotOf(link.config, input.workspace) !== null,
  );
  if (declaredIndex === -1) {
    const chainRefs = links.map((link) => link.ref).join(" -> ");
    throw new Error(
      `No runtime in the extends chain declares workspace "${input.workspace}" (${chainRefs}). ${FROM_REMEDIES}.`,
    );
  }
  if (!fromBosSpec && declaredIndex === 0) {
    throw new Error(
      `Workspace "${input.workspace}" is declared locally in your authored config — bos import targets an upstream ancestor`,
    );
  }

  const ancestor = links[declaredIndex];
  const ancestorRef = ancestor.ref.startsWith("bos://")
    ? ancestor.ref
    : `authored config at ${ancestor.ref}`;

  let repository: string | undefined;
  for (let i = declaredIndex; i < links.length && repository === undefined; i++) {
    const value = (links[i].config as Record<string, unknown> | undefined)?.repository;
    if (typeof value === "string" && value.trim().length > 0) {
      repository = value;
    }
  }

  const warnings: string[] = [];
  const slot = localWorkspaceSlotOf(ancestor.config, input.workspace)!.slot;
  const ancestorEntry = configEntryAt(ancestor.config, slot);
  const pin = await resolvePinnedSource(ancestorEntry, input.fetchVersionManifest);
  if (pin.warning) warnings.push(pin.warning);

  const production =
    typeof ancestorEntry?.production === "string" ? ancestorEntry.production : undefined;
  const sourceArchive =
    pin.source && production
      ? {
          file: pin.source.file,
          url: `${production.replace(/\/+$/, "")}/${pin.source.file}`,
          integrity: pin.source.integrity,
        }
      : undefined;
  if (!sourceArchive && !repository) {
    throw new Error(
      `No repository found along the extends chain above ${ancestorRef} — the declaring runtime must publish its source (repository field in bos.app.ts)`,
    );
  }

  const extendsRef = fromBosSpec
    ? entry
    : (() => {
        const selfConfig = links[0].config;
        const extendsValue = (selfConfig as Record<string, unknown> | undefined)?.extends;
        if (extendsValue === undefined) return "authored config";
        try {
          return (
            resolveExtendsRef(extendsValue as string | ExtendsConfig, "production") ??
            "authored config"
          );
        } catch {
          return "authored config";
        }
      })();

  if (sourceArchive) {
    return {
      spec: { kind: "archive", url: sourceArchive.url, integrity: sourceArchive.integrity },
      provenance: {
        extendsRef,
        ancestorRef,
        ...(repository ? { repository } : {}),
        ...(pin.sha ? { pinnedSha: pin.sha } : {}),
        sourceArchive,
        warnings,
      },
    };
  }

  return {
    spec: { kind: "github", repo: repository!, ...(pin.sha ? { ref: pin.sha } : {}) },
    provenance: {
      extendsRef,
      ancestorRef,
      ...(pin.sha ? { pinnedSha: pin.sha } : {}),
      repository: repository!,
      warnings,
    },
  };
}

interface ImportPlan {
  fromLabel: string;
  spec: ImportFromSpec & { kind: "github" | "local" | "archive" };
  chain?: ImportChainProvenance;
}

async function resolveImportPlan(input: {
  workspace: string;
  from?: string;
  projectDir: string;
}): Promise<ImportPlan> {
  const from = input.from;
  if (!from) {
    const resolved = await resolveImportChain({
      workspace: input.workspace,
      projectDir: input.projectDir,
    });
    return {
      fromLabel: resolved.provenance.extendsRef,
      spec: resolved.spec,
      chain: resolved.provenance,
    };
  }
  const spec = parseFromSpec(from);
  if (spec.kind === "bos") {
    const resolved = await resolveImportChain({
      workspace: input.workspace,
      projectDir: input.projectDir,
      entrySpec: spec,
    });
    return { fromLabel: spec.bosUrl, spec: resolved.spec, chain: resolved.provenance };
  }
  return { fromLabel: from, spec };
}

type TarballDownloader = (
  repo: string,
  ref?: string,
) => Promise<{
  dir: string;
  cleanup: () => Promise<void>;
  resolvedRef?: string;
  resolvedSha?: string;
}>;

type ArchiveFetcher = (url: string) => Promise<Uint8Array>;

async function defaultArchiveFetch(url: string): Promise<Uint8Array> {
  const response = await fetchResponse(url, { redirect: "follow", timeout: "60 seconds" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function extractArchive(bytes: Uint8Array): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = mkdtempSync(join(tmpdir(), "bos-import-archive-"));
  const archivePath = join(tmpDir, "source.tar.gz");
  const extractDir = mkdtempSync(join(tmpdir(), "bos-import-archive-src-"));
  try {
    writeFileSync(archivePath, bytes);
    await tarExtract({ cwd: extractDir, file: archivePath, strip: 0 });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  return {
    root: extractDir,
    cleanup: async () => {
      rmSync(extractDir, { recursive: true, force: true });
    },
  };
}

async function fetchGithubSource(input: {
  repo: string;
  ref?: string;
  pinnedSha?: string;
  download: TarballDownloader;
}): Promise<{
  source: { root: string; cleanup: () => Promise<void>; ref: string; resolvedSha?: string };
  fallbackWarning?: string;
}> {
  const pinned = input.pinnedSha !== undefined && input.ref === input.pinnedSha;
  try {
    const tarball = await input.download(input.repo, input.ref);
    return {
      source: {
        root: tarball.dir,
        cleanup: tarball.cleanup,
        ref: input.ref ?? tarball.resolvedRef ?? "main",
        resolvedSha: tarball.resolvedSha,
      },
    };
  } catch (error) {
    if (!pinned) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const tarball = await input.download(input.repo, undefined);
    return {
      source: {
        root: tarball.dir,
        cleanup: tarball.cleanup,
        ref: tarball.resolvedRef ?? "main",
        resolvedSha: tarball.resolvedSha,
      },
      fallbackWarning: `could not fetch the pinned commit ${input.pinnedSha} (${message}) — importing the default branch`,
    };
  }
}

export async function fetchSourceWithPinFallback(input: {
  spec: ImportFromSpec & { kind: "github" | "local" | "archive" };
  pinnedSha?: string;
  download?: TarballDownloader;
  fetchArchive?: ArchiveFetcher;
  fallback?: { repo: string; ref?: string };
}): Promise<{
  source: { root: string; cleanup: () => Promise<void>; ref: string; resolvedSha?: string };
  fallbackWarning?: string;
}> {
  if (input.spec.kind === "local") {
    return { source: { root: input.spec.dir, cleanup: async () => {}, ref: "local" } };
  }
  const download = input.download ?? downloadTarball;
  if (input.spec.kind === "archive") {
    const fetchArchive = input.fetchArchive ?? defaultArchiveFetch;
    try {
      const bytes = await fetchArchive(input.spec.url);
      const computed = computeSriHash(Buffer.from(bytes));
      if (computed !== input.spec.integrity) {
        throw new Error(
          `integrity mismatch for ${input.spec.url} — expected ${input.spec.integrity}, computed ${computed}`,
        );
      }
      const extracted = await extractArchive(bytes);
      return { source: { ...extracted, ref: "source archive" } };
    } catch (error) {
      if (!input.fallback) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const gh = await fetchGithubSource({
        repo: input.fallback.repo,
        ref: input.fallback.ref,
        pinnedSha: input.pinnedSha,
        download,
      });
      return {
        ...gh,
        fallbackWarning: `could not fetch the source archive (${message}) — importing from ${input.fallback.repo} instead`,
      };
    }
  }
  return fetchGithubSource({
    repo: input.spec.repo,
    ref: input.spec.ref,
    pinnedSha: input.pinnedSha,
    download,
  });
}

async function resolveImportSource(
  spec: ImportPlan["spec"],
  chain?: ImportChainProvenance,
): Promise<{
  root: string;
  cleanup: () => Promise<void>;
  ref: string;
  resolvedSha?: string;
  fallbackWarning?: string;
}> {
  const { source, fallbackWarning } = await fetchSourceWithPinFallback({
    spec,
    pinnedSha: chain?.pinnedSha,
    fallback: chain?.repository
      ? {
          repo: chain.repository,
          ...(chain.pinnedSha ? { ref: chain.pinnedSha } : {}),
        }
      : undefined,
  });
  return { ...source, fallbackWarning };
}

export async function importWorkspace(
  projectDir: string,
  options: ImportOptions,
  deps?: ImportDeps,
): Promise<ImportResult> {
  const errorResult = (workspace: string, ref: string, message: string): ImportResult => ({
    status: "error",
    workspace,
    from: options.from ?? "",
    ref,
    added: [],
    updated: [],
    unchanged: [],
    preservedLocal: [],
    merged: [],
    conflicts: [],
    heldBackMigrations: [],
    migrationCollisions: [],
    warnings: [],
    error: message,
  });

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  let workspace = options.workspace;
  let fromLabel = options.from ?? "";
  let ref = "";
  let chain: ImportChainProvenance | undefined;
  try {
    workspace = normalizeWorkspacePath(options.workspace);
    const plan = await resolveImportPlan({
      workspace,
      from: options.from,
      projectDir,
    });
    fromLabel = plan.fromLabel;
    chain = plan.chain;
    const spec = plan.spec;
    const source = await resolveImportSource(spec, chain);
    if (source.fallbackWarning && chain) {
      chain = {
        ...chain,
        pinnedSha: undefined,
        warnings: [...chain.warnings, source.fallbackWarning],
      };
    }
    ref = source.ref;

    try {
      const upstreamWorkspaceDir = join(source.root, workspace);
      if (!existsSync(upstreamWorkspaceDir) || !lstatSync(upstreamWorkspaceDir).isDirectory()) {
        throw new Error(
          `Workspace "${workspace}" not found in ${fromLabel}${
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

      const chainPrefix = `${workspace}/src/db/migrations/`;
      const chainJournalPath = `${chainPrefix}meta/_journal.json`;
      const localMigrations = loadMigrationEntries(projectDir, workspace);
      const upstreamMigrations = loadMigrationEntries(source.root, workspace);
      const localJournalExists = existsSync(join(projectDir, chainJournalPath));
      const reconciliation =
        localMigrations && upstreamMigrations
          ? reconcileMigrationChains(localMigrations, upstreamMigrations)
          : null;

      let chainUnsafe: boolean;
      if (reconciliation) {
        chainUnsafe = reconciliation.unresolvable.length > 0;
      } else if (localMigrations === null && localJournalExists) {
        chainUnsafe = true;
      } else if (localMigrations !== null && upstreamMigrations === null) {
        chainUnsafe = true;
      } else {
        chainUnsafe = false;
      }

      const migrationRemap = new Map<string, string>();
      const migrationSkipped = new Set<string>();
      if (reconciliation && !chainUnsafe) {
        const appendedByFromTag = new Map(
          reconciliation.appended.map((append) => [append.fromTag, append]),
        );
        const contentMatchedTags = new Set(reconciliation.contentMatched);
        const upstreamTagBySnapshotPrefix = new Map<string, string>();
        for (const entry of upstreamMigrations ?? []) {
          const prefix = snapshotPrefixOf(entry.tag);
          if (prefix) upstreamTagBySnapshotPrefix.set(prefix, entry.tag);
        }
        for (const path of upstreamFiles) {
          if (!path.startsWith(chainPrefix) || path === chainJournalPath) continue;
          const relInMigrations = path.slice(chainPrefix.length);
          if (relInMigrations.endsWith(".sql")) {
            const tag = relInMigrations.slice(0, -".sql".length);
            const append = appendedByFromTag.get(tag);
            if (append) {
              migrationRemap.set(path, `${chainPrefix}${append.toTag}.sql`);
            } else if (contentMatchedTags.has(tag)) {
              migrationSkipped.add(path);
            }
          } else if (
            relInMigrations.startsWith("meta/") &&
            relInMigrations.endsWith("_snapshot.json")
          ) {
            const prefix = relInMigrations.slice(
              "meta/".length,
              relInMigrations.length - "_snapshot.json".length,
            );
            const tag = upstreamTagBySnapshotPrefix.get(prefix);
            const append = tag ? appendedByFromTag.get(tag) : undefined;
            if (append) {
              migrationRemap.set(
                path,
                `${chainPrefix}meta/${String(append.idx).padStart(4, "0")}_snapshot.json`,
              );
            } else if (tag && contentMatchedTags.has(tag)) {
              migrationSkipped.add(path);
            }
          }
        }
      }

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
        if (reconciliation && path === chainJournalPath) continue;
        if (migrationRemap.has(path) || migrationSkipped.has(path)) continue;
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

      const migrationCollisions = reconciliation?.unresolvable ?? [];

      const writeCandidates = new Set([
        ...added,
        ...updated,
        ...merged,
        ...conflicts.map((conflict) => conflict.path),
      ]);
      const heldSet = new Set(
        chainUnsafe ? [...writeCandidates].filter((path) => path.startsWith(chainPrefix)) : [],
      );
      if (chainUnsafe && reconciliation) {
        heldSet.add(chainJournalPath);
      }
      const heldBackMigrations = [...heldSet].sort();
      for (const conflict of conflicts) {
        conflict.held = heldSet.has(conflict.path);
      }

      const analysis: ImportReportAnalysis = {
        workspace,
        from: fromLabel,
        ref: source.ref,
        resolvedSha: source.resolvedSha,
        sourceKind: spec.kind,
        chain,
        added,
        updated,
        unchanged,
        preservedLocal,
        preservedLocalEdit,
        merged,
        conflicts,
        routeDelta,
        migrationCollisions,
        migrationReconciliation: reconciliation,
        heldBackMigrations,
      };

      const resultBase = {
        workspace,
        from: fromLabel,
        ref: source.ref,
        resolvedSha: source.resolvedSha,
        sourceRepository: chain?.repository,
        warnings: chain ? chain.warnings : [],
        added,
        updated,
        unchanged,
        preservedLocal,
        merged,
        conflicts: conflicts.map((conflict) => conflict.path),
        heldBackMigrations,
        routeDelta,
        migrationCollisions,
        migrationReconciliation: reconciliation ?? undefined,
      };

      if (options.dryRun) {
        const reportPath = writeImportReport(
          projectDir,
          buildImportReport(analysis, { mode: "dry-run" }),
        );
        return { status: "dry-run", ...resultBase, reportPath };
      }

      const appendedCount = reconciliation?.appended.length ?? 0;
      const gated = conflicts.length > 0 || heldBackMigrations.length > 0 || appendedCount > 0;
      if (gated && !options.yes) {
        let approved = false;
        if (deps?.confirm) {
          approved = await deps.confirm({
            workspace,
            conflictCount: conflicts.length,
            migrationCollisionCount: migrationCollisions.length,
            heldCount: heldBackMigrations.length,
            appendedCount,
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

      const reconciliationActive = reconciliation !== null && !chainUnsafe;
      const journalRebuildContent =
        reconciliationActive && reconciliation.appended.length > 0
          ? buildMergedJournal(projectDir, source.root, workspace, reconciliation.appended)
          : null;
      const journalChanged =
        journalRebuildContent !== null &&
        journalRebuildContent !== readFileSync(join(projectDir, chainJournalPath), "utf-8");

      const reconciliationOverwrites: Array<{ upstreamPath: string; localPath: string }> = [];
      if (reconciliationActive) {
        for (const [upstreamPath, localPath] of migrationRemap) {
          const upstreamContent = readFileSync(join(source.root, upstreamPath), "utf-8");
          if (
            !existsSync(join(projectDir, localPath)) ||
            readFileSync(join(projectDir, localPath), "utf-8") !== upstreamContent
          ) {
            reconciliationOverwrites.push({ upstreamPath, localPath });
          }
        }
      }

      const overwritePaths = [
        ...updated.filter((path) => !isHeld(path)),
        ...conflicts.map((conflict) => conflict.path).filter((path) => !isHeld(path)),
        ...merged.filter(
          (path) => mergeContents.get(path) !== readFileSync(join(projectDir, path), "utf-8"),
        ),
        ...(journalChanged ? [chainJournalPath] : []),
        ...reconciliationOverwrites.map((write) => write.localPath),
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
      for (const { upstreamPath, localPath } of reconciliationOverwrites) {
        const dest = safeProjectPath(projectDir, localPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(source.root, upstreamPath), dest);
      }
      if (journalChanged && journalRebuildContent) {
        const dest = safeProjectPath(projectDir, chainJournalPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, journalRebuildContent);
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
      if (journalChanged && journalRebuildContent) {
        recorded[chainJournalPath] = computeSnapshotHash(journalRebuildContent);
      }
      for (const { localPath } of reconciliationOverwrites) {
        const hash = hashFile(projectDir, localPath);
        if (hash) {
          recorded[localPath] = hash;
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
            from: fromLabel,
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
