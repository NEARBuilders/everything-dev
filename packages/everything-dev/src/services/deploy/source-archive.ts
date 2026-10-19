import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { listWorkspaceSubtreeFiles } from "../../utils/workspace-subtree";
import { computeSriHash } from "./integrity";

/** Temp directory for a source archive leg (caller passes it as `outDir`). */
export function makeSourceArchiveTempDir(prefix = "bos-source-archive-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A per-workspace source archive built for the deploy train (#406): the
 * workspace subtree tar'd under repo-root-relative paths, content-addressed
 * by the sha256 of its own bytes, and paired with the local SRI used for
 * client-side dedupe (the manifest field itself carries the server SRI).
 */
export interface SourceArchive {
  /** Object path within the workspace's bundle namespace: `source/<name>.tar.gz`. */
  file: string;
  /** Absolute path of the built archive on disk. */
  path: string;
  /** Local SRI of the archive bytes — dedupe key against the previous pin. */
  integrity: string;
  /** Removes the archive's temp directory. */
  cleanup: () => void;
}

/**
 * Build the workspace's source archive in `outDir`: the shared subtree ignore
 * set (`listWorkspaceSubtreeFiles`) selects the files; `tar.create` receives
 * that explicit list, so its own ignore logic never re-derives the selection.
 * The archive name is content-addressed — identical source bytes produce the
 * identical `source.<16hex>.tar.gz` (gzip is deterministic for the same input
 * bytes; file mtimes differ only when source files change, which changes the
 * name anyway).
 */
export async function buildSourceArchive(input: {
  repoRoot: string;
  workspace: string;
  outDir: string;
}): Promise<SourceArchive> {
  const files = await listWorkspaceSubtreeFiles(input.repoRoot, input.workspace);
  if (files.length === 0) {
    throw new Error(`[source-archive] workspace subtree is empty: ${input.workspace}`);
  }

  const pendingPath = join(input.outDir, ".pending.tar.gz");
  await tarCreate(
    { file: pendingPath, cwd: input.repoRoot, portable: true, gzip: { level: 9 } },
    files,
  );

  const bytes = readFileSync(pendingPath);
  const name = `source.${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.tar.gz`;
  const path = join(input.outDir, name);
  renameSync(pendingPath, path);

  return {
    file: `source/${name}`,
    path,
    integrity: computeSriHash(bytes),
    cleanup: () => rmSync(input.outDir, { recursive: true, force: true }),
  };
}
