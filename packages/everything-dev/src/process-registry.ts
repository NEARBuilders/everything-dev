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
  ports: {
    host?: number;
    api?: number;
    ui?: number;
    auth?: number;
  };
  budget?: { min: number; max: number };
  startedAt: number;
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

export function pruneDead(entries: PidEntry[]): PidEntry[] {
  return entries.filter(
    (entry) => entry.pid > 1 && existsSync(entry.configDir) && isPidAlive(entry.pid),
  );
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
  const full: PidEntry = { ...entry, role: "standalone" };
  const withoutSelf = live.filter((existing) => existing.pid !== entry.pid);
  withoutSelf.push(full);
  writeRegistry(withoutSelf);
  return full;
}

export function registerEntry(entry: PidEntry): void {
  const live = pruneDead(readRegistry());
  const withoutSelf = live.filter((existing) => existing.pid !== entry.pid);
  withoutSelf.push(entry);
  writeRegistry(withoutSelf);
}

export function unregisterPid(pid: number): void {
  const live = pruneDead(readRegistry());
  const next = live.filter((entry) => entry.pid !== pid);
  if (next.length === live.length) return;
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
  const live = pruneDead(readRegistry());
  const out = new Set<number>();
  for (const entry of live) {
    for (const port of [entry.ports.host, entry.ports.api, entry.ports.ui, entry.ports.auth]) {
      if (typeof port === "number") out.add(port);
    }
  }
  return out;
}
