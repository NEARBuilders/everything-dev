import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

export type ProcessRole = "standalone" | "workspace-parent" | "workspace-child";

export interface PidEntry {
  pid: number;
  configDir: string;
  parentPid?: number;
  role: ProcessRole;
  ports: Record<string, number>;
  childPids?: number[];
  budget?: { min: number; max: number };
  // Lease seam (ADR 0012 §6): entries are leases on shared resources, keyed
  // by what they hold; refcount-ready for the shared-plugin broker.
  leaseKey?: string;
  refcount?: number;
  startedAt: number;
  // Identity of the claimed pid captured at registration time (ADR 0012
  // amendment): PIDs are reused across container restarts, so a bare pid
  // cannot prove a claim live. `processStartTime` is stable per process
  // generation — a mismatch proves the recorded session is dead.
  processStart?: string;
  description: string;
}

function getRegistryDir(): string {
  return join(homedir(), ".cache", "everything-dev");
}

function ensureRegistryDir(): void {
  const path = getRegistryPath();
  const dir = join(path, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readRegistry(): PidEntry[] {
  const path = getRegistryPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (entry): entry is PidEntry =>
        entry &&
        typeof entry === "object" &&
        typeof entry.pid === "number" &&
        typeof entry.configDir === "string" &&
        typeof entry.role === "string",
    );
  } catch {
    return [];
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Identity of a process generation, stable across PID reuse: Linux reads the
 * kernel's starttime tick from /proc, macOS falls back to `ps -o lstart=`.
 * Null when the generation cannot be determined (the caller then treats the
 * claim as unverifiable and keeps legacy behavior).
 */
export function processStartTime(pid: number): string | null {
  if (pid <= 1) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).split(" ");
    const starttime = fields[19];
    return starttime ? `proc:${starttime}` : null;
  } catch {
    try {
      const out = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 5000 });
      const text = out.stdout?.toString().trim();
      return text ? `ps:${text}` : null;
    } catch {
      return null;
    }
  }
}

export function isEntryLive(entry: PidEntry): boolean {
  if (entry.pid <= 1) return false;
  if (!existsSync(entry.configDir)) return false;
  if (!isPidAlive(entry.pid)) return false;
  if (entry.processStart !== undefined) {
    return processStartTime(entry.pid) === entry.processStart;
  }
  return true;
}

export function pruneDead(entries: PidEntry[]): PidEntry[] {
  return entries.filter(isEntryLive);
}

export function pruneDeadEffect(entries: PidEntry[]): Effect.Effect<PidEntry[]> {
  return Effect.forEach(
    entries,
    (entry) => {
      if (entry.pid <= 1) return Effect.succeed(null);
      return Effect.gen(function* () {
        const dirExists = yield* Effect.promise(() =>
          access(entry.configDir)
            .then(() => true)
            .catch(() => false),
        );
        if (!dirExists) return null;
        if (!isPidAlive(entry.pid)) return null;
        if (entry.processStart !== undefined) {
          const current = yield* Effect.promise(() => Promise.resolve(processStartTime(entry.pid)));
          if (current !== entry.processStart) return null;
        }
        return entry;
      });
    },
    { concurrency: "unbounded" },
  ).pipe(Effect.map((results) => results.filter((e): e is PidEntry => e !== null)));
}

export function writeRegistry(entries: PidEntry[]): void {
  ensureRegistryDir();
  const path = getRegistryPath();
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(tmpPath, path);
}

export function registerStandalone(entry: Omit<PidEntry, "role">): PidEntry {
  const live = pruneDead(readRegistry());
  const full: PidEntry = {
    ...entry,
    role: "standalone",
    processStart: processStartTime(entry.pid) ?? entry.processStart,
  };
  const withoutSelf = live.filter((existing) => existing.pid !== entry.pid);
  withoutSelf.push(full);
  writeRegistry(withoutSelf);
  return full;
}

export function registerEntry(entry: PidEntry): void {
  const live = pruneDead(readRegistry());
  const withoutSelf = live.filter((existing) => existing.pid !== entry.pid);
  withoutSelf.push({
    ...entry,
    processStart: processStartTime(entry.pid) ?? entry.processStart,
  });
  writeRegistry(withoutSelf);
}

export function updateChildPids(pid: number, childPids: number[]): void {
  const live = pruneDead(readRegistry());
  const entry = live.find((existing) => existing.pid === pid);
  if (!entry) return;
  entry.childPids = childPids;
  writeRegistry(live);
}

export function unregisterPid(pid: number): void {
  const entries = readRegistry();
  const next = pruneDead(entries).filter((entry) => entry.pid !== pid);
  if (next.length === entries.length) return;
  writeRegistry(next);
}

export function removeRegistryFile(): void {
  const path = getRegistryPath();
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

export function getRegistryPath(): string {
  return process.env.BO_PID_REGISTRY_PATH ?? join(getRegistryDir(), "pids.json");
}

export function claimedPorts(): Set<number> {
  const out = new Set<number>(claimedPortOwners().keys());
  return out;
}

/** Port → the live registry entry claiming it, for occupancy diagnostics. */
export function claimedPortOwners(): Map<number, PidEntry> {
  const live = pruneDead(readRegistry());
  const out = new Map<number, PidEntry>();
  for (const entry of live) {
    for (const port of Object.values(entry.ports)) {
      if (typeof port === "number") out.set(port, entry);
    }
  }
  return out;
}
