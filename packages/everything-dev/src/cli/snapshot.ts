import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SyncSnapshot {
  parentRef: string;
  timestamp: string;
  files: Record<string, string>;
  starter?: string;
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
  data: { parentRef: string; files: Record<string, string>; starter?: string },
): Promise<void> {
  const dir = join(projectDir, SNAPSHOT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const snapshot: SyncSnapshot = {
    parentRef: data.parentRef,
    timestamp: new Date().toISOString(),
    files: data.files,
    ...(data.starter ? { starter: data.starter } : {}),
  };

  writeFileSync(snapshotPath(projectDir), `${JSON.stringify(snapshot, null, 2)}\n`);
}
