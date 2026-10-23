import { colors } from "../../utils/theme";

/**
 * The protocol for local edits to framework-owned files (ADR 0032): editing is
 * allowed, sync backs the divergent copy up, and an upstream issue makes the
 * change permanent.
 */
export const UPSTREAM_ISSUE_URL = "https://github.com/NEARBuilders/everything-dev/issues";

export function printUpstreamIssueProtocol(backupDir?: string | null) {
  console.log(
    colors.dim(
      `  Framework-owned files: local edits are allowed — template versions were applied; backups at ${backupDir || ".bos/sync-backup/"}.`,
    ),
  );
  console.log(
    colors.dim(
      `  To make a local change permanent, file an issue: ${UPSTREAM_ISSUE_URL} (or open a PR).`,
    ),
  );
}

interface SyncOutcomeShape {
  updated: string[];
  added: string[];
  conflicted: string[];
  backupDir?: string | null;
}

/**
 * The sync-outcome block shared by the `bos upgrade` renderer: counts,
 * per-file listings, and the upstream-issue protocol line.
 */
export function printSyncOutcome(sync: SyncOutcomeShape) {
  if (sync.updated.length > 0 || sync.added.length > 0 || sync.conflicted.length > 0) {
    console.log(
      `  ${sync.updated.length} updated, ${sync.added.length} added, ${sync.conflicted.length} conflicted`,
    );
    for (const f of sync.updated) console.log(`    ${colors.dim(f)}`);
    for (const f of sync.added) console.log(`    ${colors.dim(f)}`);
    if (sync.conflicted.length > 0) {
      console.log(`  ${colors.yellow("Conflicted")} (template applied, your changes backed up):`);
      if (sync.backupDir) console.log(`    ${colors.dim(sync.backupDir)}`);
      for (const f of sync.conflicted) console.log(`    ${colors.dim(f)}`);
      printUpstreamIssueProtocol(sync.backupDir);
    }
  } else {
    console.log(`  ${colors.dim("Already up to date")}`);
  }
}
