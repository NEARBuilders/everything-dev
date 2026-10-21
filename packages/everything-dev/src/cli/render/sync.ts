import { colors } from "../../utils/theme";

/** Bootstrap stubs that retire as conflicted on sync (ADR 0023). */
const RETIRED_BOOTSTRAP_STUBS = [
  "ui/src/entry.ts",
  "ui/src/hydrate.tsx",
  "ui/src/router.server.tsx",
  "ui/src/compose.ts",
];

/** Post-sync guidance when hand-modified bootstrap stubs were retired. */
export function printStubMigrationGuide(retiredConflicted: string[] | undefined) {
  const handModified = (retiredConflicted ?? []).filter((f) => RETIRED_BOOTSTRAP_STUBS.includes(f));
  if (handModified.length === 0) return;
  console.log(`  ${colors.yellow("Port your stub customizations into the authored seams:")}`);
  console.log(
    `    ${colors.dim("- defaultErrorComponent / defaultPendingComponent / defaultNotFoundComponent")}`,
  );
  console.log(
    `    ${colors.dim("  → set them inside the createRouter factory in ui/src/router.tsx (after ...opts)")}`,
  );
  console.log(
    `    ${colors.dim("- apiConnectionError copy + SSR locale config (locales, defaultLocale, cookieName)")}`,
  );
  console.log(
    `    ${colors.dim("  → export apiConnectionError / appLocale from ui/src/app.ts (see the scaffold template)")}`,
  );
  console.log(`    ${colors.dim("  backed-up originals: .bos/sync-backup/<timestamp>/")}`);
}

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
  retired?: string[];
  retiredConflicted?: string[];
  retiredBackupDir?: string | null;
  backupDir?: string | null;
}

/**
 * The sync-outcome block shared by the `bos sync` and `bos upgrade` renderers:
 * counts, per-file listings, conflict + retirement reporting, and the
 * upstream-issue protocol line.
 */
export function printSyncOutcome(sync: SyncOutcomeShape) {
  const hasRetirement =
    (sync.retired?.length ?? 0) > 0 || (sync.retiredConflicted?.length ?? 0) > 0;
  if (
    sync.updated.length > 0 ||
    sync.added.length > 0 ||
    sync.conflicted.length > 0 ||
    hasRetirement
  ) {
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
    if (hasRetirement) {
      console.log(`  ${colors.yellow("Retired")} (replaced by generated stubs — ADR 0023):`);
      if (sync.retiredBackupDir) console.log(`    ${colors.dim(sync.retiredBackupDir)}`);
      for (const f of sync.retiredConflicted ?? []) {
        console.log(`    ${colors.dim(`${f} (backed up)`)}`);
      }
      for (const f of sync.retired ?? []) console.log(`    ${colors.dim(f)}`);
      printStubMigrationGuide(sync.retiredConflicted);
    }
  } else {
    console.log(`  ${colors.dim("Already up to date")}`);
  }
  return hasRetirement;
}
