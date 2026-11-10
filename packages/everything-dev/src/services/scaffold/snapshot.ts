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
 * The upgrade migration leg: absorb a legacy `.bos/sync-snapshot.json` into
 * `bos.lock.json`'s `template.sync` and delete the file, so it stops
 * rewriting ~70 hash lines across long-lived branches and stops being
 * committed. "absorbed" — the lock gained the baseline (the repo's committed
 * artifact changes; `bos.lock.json` rides the migration report). "removed" —
 * a stale duplicate beside an already-absorbed lock, or an unparseable file.
 * undefined — nothing to do: no legacy file, or no lock (the legacy file
 * stays: it is still the only baseline).
 */
export async function absorbLegacySnapshot(
  projectDir: string,
): Promise<"absorbed" | "removed" | undefined> {
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

  if (legacy && !lock.template) {
    writeLockfileSync(
      { ...lock, template: { syncedAt: legacy.timestamp, files: legacy.files } },
      projectDir,
    );
    rmSync(legacyPath, { force: true });
    return "absorbed";
  }

  rmSync(legacyPath, { force: true });
  return "removed";
}
