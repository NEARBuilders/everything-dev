import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `bos clean` — the local-only rule's exit valve (ADR 0047): one command that
 * removes regenerable `.bos` state and refuses the artifacts that are truth
 * or identity. The partition is the contract; the handler just runs it.
 */

export interface CleanTarget {
  /** dotted category id — the report key */
  id: string;
  /** absolute path under the config dir */
  path: string;
  /** `dir` removes the tree, `files` removes matching files in place (logs —
   * the dir itself stays; a live session's fresh log survives), `file`
   * removes a single file */
  kind: "dir" | "files" | "file";
  /** present ⇒ never deleted: the never-touch invariant, with the reason */
  guarded?: string;
}

/** The absolute never-touch list — truth (PGlite data), identity (session
 * credentials), machine prefs (port pins), and the publish accelerator whose
 * cleaning would silently cost full re-uploads. `bos clean` reports these as
 * kept, always. */
export const CLEAN_NEVER_TOUCH: ReadonlyArray<{ name: string; reason: string }> = [
  { name: "db", reason: "PGlite data — the app's actual state" },
  { name: "session.json", reason: "login credentials — bos logout, not bos clean" },
  { name: "infra-state.json", reason: "machine port prefs" },
  {
    name: "deploy-state.json",
    reason: "skip-unchanged accelerator — cleaning costs full re-uploads",
  },
];

/** Files touched within this window are never cleaned — a live dev session
 * is appending to its log and `bos logs` reads it. */
const LIVE_LOG_WINDOW_MS = 60 * 60 * 1000;

function bosPath(configDir: string, name: string): string {
  return join(configDir, ".bos", name);
}

export function planClean(configDir: string): CleanTarget[] {
  const removable: CleanTarget[] = [
    { id: "logs", path: bosPath(configDir, "logs"), kind: "files" },
    { id: "bundles", path: bosPath(configDir, "bundles"), kind: "dir" },
    { id: "regression", path: bosPath(configDir, "regression"), kind: "dir" },
    { id: "generated", path: bosPath(configDir, "generated"), kind: "dir" },
    { id: "bundle-cache", path: bosPath(configDir, "bundle-cache"), kind: "dir" },
    { id: "snapshot", path: bosPath(configDir, "snapshot"), kind: "dir" },
    { id: "sync-backup", path: bosPath(configDir, "sync-backup"), kind: "dir" },
    { id: "import-backup", path: bosPath(configDir, "import-backup"), kind: "dir" },
    { id: "compose-retired", path: bosPath(configDir, "compose-retired"), kind: "dir" },
    { id: "manifest-cache", path: bosPath(configDir, "manifest.json"), kind: "file" },
    { id: "resolved-config", path: bosPath(configDir, "bos.resolved-config.json"), kind: "file" },
    { id: "build-cache", path: bosPath(configDir, "build-cache.json"), kind: "file" },
  ];
  const guarded: CleanTarget[] = CLEAN_NEVER_TOUCH.map(({ name, reason }) => ({
    id: name,
    path: bosPath(configDir, name),
    kind: existsSync(bosPath(configDir, name)) ? "dir" : "file",
    guarded: reason,
  }));
  return [...removable, ...guarded];
}

export function dirSize(path: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        total += dirSize(full);
      } else {
        total += stat.size;
      }
    }
  } catch {
    return total;
  }
  return total;
}

export interface CleanEntryResult {
  id: string;
  path: string;
  bytes: number;
  action: "removed" | "would-remove" | "kept" | "absent";
  /** `kept` — the never-touch reason; `removed` on logs — fresh files skipped */
  reason?: string;
}

export interface CleanReport {
  status: "ok";
  dryRun: boolean;
  entries: CleanEntryResult[];
  freedBytes: number;
}

function removeTree(target: CleanTarget): number {
  const bytes = dirSize(target.path);
  rmSync(target.path, { recursive: true, force: true });
  return bytes;
}

function removeFile(target: CleanTarget): number {
  const bytes = statSync(target.path).size;
  rmSync(target.path, { force: true });
  return bytes;
}

function cleanLogs(target: CleanTarget, dryRun: boolean): CleanEntryResult {
  const now = Date.now();
  let bytes = 0;
  let fresh = 0;
  let names: string[] = [];
  try {
    names = readdirSync(target.path);
  } catch {
    return { id: target.id, path: target.path, bytes: 0, action: "absent" };
  }
  for (const name of names) {
    const full = join(target.path, name);
    let size = 0;
    let mtimeMs = 0;
    try {
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs < LIVE_LOG_WINDOW_MS) {
      fresh++;
      continue;
    }
    bytes += size;
    if (!dryRun) rmSync(full, { force: true });
  }
  return {
    id: target.id,
    path: target.path,
    bytes,
    action: bytes > 0 || fresh > 0 ? (dryRun ? "would-remove" : "removed") : "absent",
    ...(fresh > 0 ? { reason: `${fresh} fresh file(s) kept (live sessions)` } : {}),
  };
}

export function executeClean(
  configDir: string,
  opts: { dryRun?: boolean; skip?: string[] } = {},
): CleanReport {
  const dryRun = opts.dryRun ?? false;
  const skip = new Set(opts.skip ?? []);
  const entries: CleanEntryResult[] = [];
  let freedBytes = 0;

  for (const target of planClean(configDir)) {
    if (skip.has(target.id)) continue;
    if (target.guarded) {
      entries.push({
        id: target.id,
        path: target.path,
        bytes: 0,
        action: "kept",
        reason: target.guarded,
      });
      continue;
    }
    if (!existsSync(target.path)) {
      entries.push({ id: target.id, path: target.path, bytes: 0, action: "absent" });
      continue;
    }
    if (target.kind === "files") {
      const entry = cleanLogs(target, dryRun);
      entries.push(entry);
      freedBytes += entry.bytes;
      continue;
    }
    const bytes = target.kind === "dir" ? dirSize(target.path) : statSync(target.path).size;
    if (!dryRun) {
      if (target.kind === "dir") removeTree(target);
      else removeFile(target);
    }
    entries.push({
      id: target.id,
      path: target.path,
      bytes,
      action: dryRun ? "would-remove" : "removed",
    });
    freedBytes += bytes;
  }

  return { status: "ok", dryRun, entries, freedBytes };
}
