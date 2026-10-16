import { lstatSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";

/**
 * The ignore set both sides of a source handoff agree on: `bos import`
 * classifies files under it, and source archives published by the deploy
 * train (#406) exclude it — so an imported archive never smuggles in
 * build output, VCS state, or local .bos state. Keep this list in sync
 * with nothing else: it is the single source of truth.
 */
export const WORKSPACE_SUBTREE_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.bos/**",
  "**/.every-plugin/**",
];

/** Sorted, file-only list of the workspace subtree at `root`, under the shared ignore set. */
export async function listWorkspaceSubtreeFiles(
  root: string,
  workspace: string,
): Promise<string[]> {
  const matches = await glob(`${workspace}/**`, {
    cwd: root,
    nodir: true,
    dot: true,
    absolute: false,
    ignore: WORKSPACE_SUBTREE_IGNORE,
  });
  const files: string[] = [];
  for (const match of matches) {
    if (lstatSync(join(root, match)).isFile()) {
      files.push(match);
    }
  }
  return files.sort();
}
