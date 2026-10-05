import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { retireSyncedFiles } from "../../src/cli/sync";
import { computeSnapshotHash } from "../../src/utils/snapshot-hash";

const root = join(tmpdir(), "bos-sync-retirement");

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeProject(relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  fs.mkdirSync(join(fullPath, ".."), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

const STUB_CONTENT = "export {};\n";
// The snapshot records the file's hash — the same hash the sync code computes.
const snapshotOf = (content: string) => computeSnapshotHash(Buffer.from(content));

describe("retireSyncedFiles", () => {
  it("deletes unmodified stub files silently", () => {
    writeProject("ui/src/entry.ts", STUB_CONTENT);
    const result = retireSyncedFiles(
      root,
      { "ui/src/entry.ts": snapshotOf(STUB_CONTENT) },
      {
        dryRun: false,
      },
    );
    expect(result.retired).toEqual(["ui/src/entry.ts"]);
    expect(result.retiredConflicted).toEqual([]);
    expect(fs.existsSync(join(root, "ui/src/entry.ts"))).toBe(false);
  });

  it("backs up hand-modified stub files before deleting them", () => {
    writeProject("ui/src/hydrate.tsx", "// my custom bootstrap\n");
    const result = retireSyncedFiles(
      root,
      { "ui/src/hydrate.tsx": snapshotOf(STUB_CONTENT) },
      { dryRun: false },
    );
    expect(result.retired).toEqual([]);
    expect(result.retiredConflicted).toEqual(["ui/src/hydrate.tsx"]);
    expect(fs.existsSync(join(root, "ui/src/hydrate.tsx"))).toBe(false);
    // the hand-modified copy survived under the backup dir
    expect(result.backupDir).toBeDefined();
    const backupFiles = fs.readdirSync(join(root, ".bos/sync-backup"), { recursive: true });
    expect(backupFiles.some((f) => String(f).includes("hydrate.tsx"))).toBe(true);
  });

  it("treats never-snapshotted stub files as hand-modified (back up, then delete)", () => {
    writeProject("ui/src/compose.ts", STUB_CONTENT);
    const result = retireSyncedFiles(root, {}, { dryRun: false });
    expect(result.retired).toEqual([]);
    expect(result.retiredConflicted).toEqual(["ui/src/compose.ts"]);
    expect(fs.existsSync(join(root, "ui/src/compose.ts"))).toBe(false);
  });

  it("is a no-op for files that do not exist locally", () => {
    const result = retireSyncedFiles(
      root,
      { "ui/src/router.server.tsx": "x" },
      {
        dryRun: false,
      },
    );
    expect(result.retired).toEqual([]);
    expect(result.retiredConflicted).toEqual([]);
  });

  it("reports without deleting in dry-run", () => {
    writeProject("ui/src/globals.d.ts", STUB_CONTENT);
    const result = retireSyncedFiles(
      root,
      { "ui/src/globals.d.ts": snapshotOf(STUB_CONTENT) },
      {
        dryRun: true,
      },
    );
    expect(result.retired).toEqual(["ui/src/globals.d.ts"]);
    expect(fs.existsSync(join(root, "ui/src/globals.d.ts"))).toBe(true);
  });

  it("leaves non-retired files alone", () => {
    writeProject("ui/src/router.tsx", "export const router = 'mine';\n");
    writeProject("ui/src/app.ts", "export const mine = true;\n");
    const result = retireSyncedFiles(root, {}, { dryRun: false });
    expect(result.retired).toEqual([]);
    expect(result.retiredConflicted).toEqual([]);
    expect(fs.existsSync(join(root, "ui/src/router.tsx"))).toBe(true);
    expect(fs.existsSync(join(root, "ui/src/app.ts"))).toBe(true);
  });
});
