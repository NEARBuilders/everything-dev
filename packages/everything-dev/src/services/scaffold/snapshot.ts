import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SyncSnapshot {
  timestamp: string;
  files: Record<string, string>;
}

const SNAPSHOT_DIR = ".bos";
const SNAPSHOT_FILE = "sync-snapshot.json";

function snapshotPath(projectDir: string): string {
  return join(projectDir, SNAPSHOT_DIR, SNAPSHOT_FILE);
}

export async function readSnapshot(projectDir: string): Promise<SyncSnapshot | null> {
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

export async function writeSnapshot(
  projectDir: string,
  data: { files: Record<string, string> },
): Promise<void> {
  const dir = join(projectDir, SNAPSHOT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const snapshot: SyncSnapshot = {
    timestamp: new Date().toISOString(),
    files: data.files,
  };

  writeFileSync(snapshotPath(projectDir), `${JSON.stringify(snapshot, null, 2)}\n`);
}
