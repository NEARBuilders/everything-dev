import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLockfileIfExists, writeLockfileSync } from "../lockfile/schema";

export interface SyncSnapshot {
  timestamp: string;
  files: Record<string, string>;
}

const SNAPSHOT_DIR = ".bos";
const SNAPSHOT_FILE = "sync-snapshot.json";

function snapshotPath(projectDir: string): string {
  return join(projectDir, SNAPSHOT_DIR, SNAPSHOT_FILE);
}

function legacySnapshot(projectDir: string): SyncSnapshot | null {
  const path = snapshotPath(projectDir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as SyncSnapshot;
  } catch {
    return null;
  }
}

/**
 * The sync baseline (ADR 0047): the committed form is `bos.lock.json`'s
 * `template.sync`; the legacy `.bos/sync-snapshot.json` file is the fallback
 * while a repo still runs lock-less. Lock-first keeps the two in agreement
 * once the migration absorbs the file, and keeps lock-less children working
 * unchanged.
 */
export async function readSnapshot(projectDir: string): Promise<SyncSnapshot | null> {
  const lock = await readLockfileIfExists(projectDir);
  if (lock?.template) {
    return { timestamp: lock.template.syncedAt, files: lock.template.files };
  }
  return legacySnapshot(projectDir);
}

/**
 * Record the baseline through the lock when one exists — splicing only the
 * `template` key, never recomputing the frozen composition (a sync has no
 * business touching remotes). The legacy file is deleted on the absorb path
 * so it stops regenerating beside the lock. Lock-less repos keep the legacy
 * file: it is still the only baseline, now local-only.
 */
export async function writeSnapshot(
  projectDir: string,
  data: { files: Record<string, string> },
): Promise<void> {
  const syncedAt = new Date().toISOString();
  const lock = await readLockfileIfExists(projectDir);

  if (lock) {
    writeLockfileSync({ ...lock, template: { syncedAt, files: data.files } }, projectDir);
    const legacyPath = snapshotPath(projectDir);
    if (existsSync(legacyPath)) {
      rmSync(legacyPath, { force: true });
    }
    return;
  }

  const dir = join(projectDir, SNAPSHOT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    snapshotPath(projectDir),
    `${JSON.stringify({ timestamp: syncedAt, files: data.files }, null, 2)}\n`,
  );
}

/**
 * The read-only cleanup plan for the legacy snapshot file: the deletion only
 * happens once the lock is verified to carry the baseline — either it
 * already does (`template.sync` present), or the legacy file parses and the
 * absorb writes it in first. An unparseable legacy file beside a lock
 * without a baseline is left in place: deleting it would leave the repo
 * with no baseline at all.
 */
export async function planLegacySnapshot(
  projectDir: string,
): Promise<"absorb-and-delete" | "delete" | undefined> {
  const legacyPath = snapshotPath(projectDir);
  if (!existsSync(legacyPath)) return undefined;

  let legacy: SyncSnapshot | null = null;
  try {
    legacy = JSON.parse(readFileSync(legacyPath, "utf-8")) as SyncSnapshot;
  } catch {
    legacy = null;
  }

  const lock = await readLockfileIfExists(projectDir);
  if (!lock) return undefined;

  if (lock.template) return "delete";
  return legacy ? "absorb-and-delete" : undefined;
}

/**
 * The upgrade migration leg: absorb a legacy `.bos/sync-snapshot.json` into
 * `bos.lock.json`'s `template.sync` and delete the file, so it stops
 * rewriting ~70 hash lines across long-lived branches and stops being
 * committed. Deletion is lock-verified (ADR 0047): "absorbed" — the lock
 * gained the baseline (the repo's committed artifact changes;
 * `bos.lock.json` rides the migration report). "removed" — a stale duplicate
 * beside a lock that already carries the baseline. undefined — nothing to
 * do: no legacy file, no lock (the legacy file stays: it is still the only
 * baseline), or an unparseable legacy file beside a lock without a baseline.
 */
export async function absorbLegacySnapshot(
  projectDir: string,
  log?: (message: string) => void,
): Promise<"absorbed" | "removed" | undefined> {
  const plan = await planLegacySnapshot(projectDir);
  if (!plan) return undefined;

  const legacyPath = snapshotPath(projectDir);
  if (plan === "absorb-and-delete") {
    const legacy = JSON.parse(readFileSync(legacyPath, "utf-8")) as SyncSnapshot;
    const lock = await readLockfileIfExists(projectDir);
    if (!lock) return undefined;
    writeLockfileSync(
      { ...lock, template: { syncedAt: legacy.timestamp, files: legacy.files } },
      projectDir,
    );
    rmSync(legacyPath, { force: true });
    log?.("absorbed .bos/sync-snapshot.json into bos.lock.json template.sync and deleted the file");
    return "absorbed";
  }

  rmSync(legacyPath, { force: true });
  log?.("removed stale .bos/sync-snapshot.json — bos.lock.json already carries the baseline");
  return "removed";
}
