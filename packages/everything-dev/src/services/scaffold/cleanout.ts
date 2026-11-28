import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readAuthoredConfigInput } from "../../config";
import { getExtendsRef } from "../../utils/bos-ref";
import { readJsonFile } from "../../utils/json-file";
import { absorbLegacySnapshot, planLegacySnapshot } from "./snapshot";
import { RETIRED_CHILD_SCRIPTS, workspaceDirOf } from "./upgrade-packages";

/**
 * The cleanout leg (issue #921): the upgrade migration deletes the legacy
 * state that "delete at will" never deleted — the absorbed sync snapshot,
 * children's unowned `.changeset/` directories, and the retired child
 * scripts. Every deletion is logged; `planCleanout` is the read-only half
 * the `--dry-run` preview reports.
 */

export interface CleanoutItem {
  /** repo-relative target the migration acts on */
  target: string;
  action: "absorb-and-delete" | "delete" | "scrub";
  /** why the state is ghost state */
  detail: string;
}

export function describeCleanoutItem(item: CleanoutItem, tense: "plan" | "done"): string {
  const prefix = tense === "plan" ? "would " : "";
  if (item.action === "absorb-and-delete") {
    return `${prefix}absorb ${item.target} into bos.lock.json template.sync and delete it — ${item.detail}`;
  }
  const verb = item.action === "delete" ? "remove" : "scrub";
  return `${prefix}${verb} ${item.target} — ${item.detail}`;
}

/**
 * A tree whose authored config extends a published runtime is a child — the
 * only scope the cleanout's changeset deletions apply to. The root runtime
 * (no `extends`) keeps its own `.changeset/` and scripts: the release lever
 * lives there.
 */
export async function isChildTree(projectDir: string): Promise<boolean> {
  try {
    const config = (await readAuthoredConfigInput(projectDir)) as Record<string, unknown> | null;
    if (!config) return false;
    const extendsRef = getExtendsRef(config);
    return typeof extendsRef === "string" && extendsRef.startsWith("bos://");
  } catch {
    return false;
  }
}

const SNAPSHOT_DETAIL = "the sync baseline is bos.lock.json's committed form (ADR 0047)";
const CHANGESET_DETAIL = "children have no changesets — the release lever is root-only (#572)";
const SCRIPT_DETAIL = "retired on children — the changeset lever is root-only (#572)";

async function childChangesetItems(projectDir: string): Promise<CleanoutItem[]> {
  if (!(await isChildTree(projectDir))) return [];
  const workspaceDir = workspaceDirOf(projectDir);
  const items: CleanoutItem[] = [];
  if (existsSync(join(workspaceDir, ".changeset"))) {
    items.push({ target: ".changeset/", action: "delete", detail: CHANGESET_DETAIL });
  }
  const pkgPath = join(workspaceDir, "package.json");
  if (!existsSync(pkgPath)) return items;
  const pkg = readJsonFile<Record<string, unknown>>(pkgPath);
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === "object") {
    for (const name of RETIRED_CHILD_SCRIPTS) {
      if (name in (scripts as Record<string, unknown>)) {
        items.push({
          target: `package.json scripts.${name}`,
          action: "scrub",
          detail: SCRIPT_DETAIL,
        });
      }
    }
  }
  return items;
}

export async function planCleanout(projectDir: string): Promise<CleanoutItem[]> {
  const items: CleanoutItem[] = [];
  const snapshotPlan = await planLegacySnapshot(projectDir);
  if (snapshotPlan === "absorb-and-delete") {
    items.push({
      target: ".bos/sync-snapshot.json",
      action: "absorb-and-delete",
      detail: SNAPSHOT_DETAIL,
    });
  } else if (snapshotPlan === "delete") {
    items.push({ target: ".bos/sync-snapshot.json", action: "delete", detail: SNAPSHOT_DETAIL });
  }
  return [...items, ...(await childChangesetItems(projectDir))];
}

export async function runCleanout(
  projectDir: string,
  log: (message: string) => void,
): Promise<{ items: CleanoutItem[]; lockAbsorbed: boolean }> {
  const items: CleanoutItem[] = [];
  let lockAbsorbed = false;

  const snapshotOutcome = await absorbLegacySnapshot(projectDir, log);
  if (snapshotOutcome === "absorbed") {
    lockAbsorbed = true;
    items.push({
      target: ".bos/sync-snapshot.json",
      action: "absorb-and-delete",
      detail: SNAPSHOT_DETAIL,
    });
  } else if (snapshotOutcome === "removed") {
    items.push({ target: ".bos/sync-snapshot.json", action: "delete", detail: SNAPSHOT_DETAIL });
  }

  if (await isChildTree(projectDir)) {
    const changesetDir = join(workspaceDirOf(projectDir), ".changeset");
    if (existsSync(changesetDir)) {
      rmSync(changesetDir, { recursive: true, force: true });
      log(`removed .changeset/ — ${CHANGESET_DETAIL}`);
      items.push({ target: ".changeset/", action: "delete", detail: CHANGESET_DETAIL });
    }
  }

  return { items, lockAbsorbed };
}
