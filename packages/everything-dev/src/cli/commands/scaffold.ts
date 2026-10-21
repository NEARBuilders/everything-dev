import { colors, icons } from "../../utils/theme";
import { exitCodeFor } from "../exit-codes";
import { printSyncOutcome, UPSTREAM_ISSUE_URL } from "../render/sync";
import type { ResultRenderer } from "./context";

export const scaffoldRenderers: Record<string, ResultRenderer> = {
  sync: async (result, ctx) => {
    const input = ctx.input;
    if ((input as any).json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }
    if (result.status === "dry-run") {
      console.log(colors.cyan(`${icons.ok} Dry run — no files written`));
    } else {
      console.log(colors.green(`${icons.ok} Synced`));
    }
    printSyncOutcome(result);
    console.log();
    return;
  },

  import: async (result, ctx) => {
    const input = ctx.input;
    if ((input as any).json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      if (result.reportPath) console.error(`  Report: ${result.reportPath}`);
      process.exit(1);
    }
    if (result.sourceRepository) {
      console.log(
        `  ${colors.dim("Upstream:")} ${result.sourceRepository} @ ${
          result.ref || "default branch"
        }${result.resolvedSha ? colors.dim(` (commit ${result.resolvedSha})`) : ""}`,
      );
    }
    for (const warning of result.warnings ?? []) {
      console.log(`  ${colors.yellow("Note:")} ${warning}`);
    }
    if (result.status === "dry-run") {
      console.log(colors.cyan(`${icons.ok} Dry run — no files written`));
    } else if (result.status === "imported") {
      console.log(colors.green(`${icons.ok} Imported ${result.workspace} from ${result.from}`));
    } else {
      console.log(colors.yellow(`${icons.err} Conflicts — nothing written`));
    }
    console.log(
      `  ${colors.dim("Results:")} ${result.updated.length} updated, ${result.added.length} added, ${result.merged.length} merged, ${result.conflicts.length} conflicted, ${result.preservedLocal.length} local-only preserved, ${result.unchanged.length} unchanged`,
    );
    if (result.conflicts.length > 0) {
      const heldSet: Set<string> = new Set(result.heldBackMigrations ?? []);
      console.log(
        `  ${colors.yellow("Conflicts")} (unresolvable — manual-port checklist${
          result.status === "conflicts"
            ? "; re-run with --yes to apply upstream"
            : result.backupDir
              ? `, upstream applied, local copies at ${result.backupDir}`
              : ""
        }):`,
      );
      for (const file of result.conflicts) {
        console.log(
          `    ${colors.dim(heldSet.has(file) ? `${file} (held — migration chain)` : file)}`,
        );
      }
    }
    if (result.heldBackMigrations?.length > 0) {
      console.log(`  ${colors.yellow("Migration chain held back")}:`);
      for (const file of result.heldBackMigrations) console.log(`    ${colors.dim(file)}`);
    }
    if (result.migrationCollisions.length > 0) {
      console.log(`  ${colors.yellow("Unresolvable migration collisions")}:`);
      for (const collision of result.migrationCollisions) {
        console.log(`    ${colors.dim(collision.message)}`);
      }
    }
    if (result.migrationReconciliation && result.migrationReconciliation.appended.length > 0) {
      console.log(
        `  ${colors.green("Migration chain reconciled")}: ${result.migrationReconciliation.kept.length} applied migration(s) kept, ${result.migrationReconciliation.appended.length} appended:`,
      );
      for (const append of result.migrationReconciliation.appended) {
        console.log(`    ${colors.dim(`${append.fromTag} → ${append.toTag} (idx ${append.idx})`)}`);
      }
      console.log(
        `  ${colors.dim("Next boot applies the appended migration(s); renamed snapshots should be reviewed against `drizzle-kit generate` before generating new migrations.")}`,
      );
    } else if (
      result.migrationReconciliation &&
      result.migrationReconciliation.contentMatched.length > 0
    ) {
      console.log(
        `  ${colors.dim("Migration chain:")} every upstream migration is already applied (kept: ${result.migrationReconciliation.kept.length}, matched by content: ${result.migrationReconciliation.contentMatched.length})`,
      );
    }
    if (
      result.routeDelta &&
      (result.routeDelta.oursOnly.length > 0 || result.routeDelta.theirsOnly.length > 0)
    ) {
      console.log(
        `  ${colors.dim("Route delta:")} ${result.routeDelta.oursOnly.length} ours-only, ${result.routeDelta.theirsOnly.length} theirs-only`,
      );
      for (const route of result.routeDelta.oursOnly)
        console.log(`    ${colors.dim(`ours:   ${route}`)}`);
      for (const route of result.routeDelta.theirsOnly)
        console.log(`    ${colors.dim(`theirs: ${route}`)}`);
    }
    if (result.reportPath) {
      console.log(`  Report: ${colors.dim(result.reportPath)}`);
    }
    if (result.status === "conflicts") {
      console.log();
      console.error(
        `[CLI] ${result.conflicts.length} unresolvable conflict(s)${
          result.migrationCollisions.length > 0
            ? ` and ${result.migrationCollisions.length} migration collision(s)`
            : ""
        } — nothing was written. Re-run with --yes to apply upstream (local copies are backed up first).`,
      );
      process.exit(1);
    }
    console.log();
    return;
  },

  upgrade: async (result, ctx) => {
    const input = ctx.input;
    if ((input as any).json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }
    if (result.status === "dry-run") {
      console.log(colors.cyan(`${icons.ok} Dry run — no changes applied`));
      // CI drift alarm (ADR 0034): --check exits 1 when updates are available
      if ((input as any).check) process.exit(result.updatesAvailable ? 1 : 0);
    } else {
      console.log(colors.green(`${icons.ok} Upgrade complete`));
    }
    if (result.platform) {
      console.log(
        `  ${colors.dim(`Platform ${result.platform.resolved}${result.platform.fromCache ? " (cached)" : ""} — ${result.platform.source}`)}`,
      );
    }
    const mainPkg = result.packages.find(
      (p: { name: string; from?: string; to: string }) => p.name === "everything-dev",
    );
    const versionDelta =
      mainPkg?.from && mainPkg.from !== mainPkg.to ? `${mainPkg.from} → ${mainPkg.to}` : null;
    if (versionDelta) {
      console.log(`  ${colors.dim(`Upgraded everything-dev ${versionDelta}`)}`);
    }
    for (const pkg of result.packages) {
      if (pkg.name === "everything-dev") continue;
      if (pkg.from && pkg.from !== pkg.to) {
        console.log(`  ${colors.dim(`${pkg.name}  ${pkg.from} → ${pkg.to}`)}`);
      } else if (!pkg.from) {
        console.log(`  ${colors.dim(`${pkg.name}  ${pkg.to} (new)`)}`);
      } else {
        console.log(`  ${colors.dim(`${pkg.name}  ${pkg.to} (up to date)`)}`);
      }
    }
    if (result.changelogUrl) {
      console.log(`  Changelog: ${result.changelogUrl}`);
    }
    if (result.selectedPlugins && result.selectedPlugins.length > 0) {
      console.log(`  Added plugins: ${result.selectedPlugins.join(", ")}`);
    }
    if (result.sync) {
      console.log(`  ${colors.dim("Sync results:")}`);
      printSyncOutcome(result.sync);
    }
    if (result.migrated && result.migrated.length > 0) {
      console.log(`  Migrated: ${result.migrated.length} file(s)`);
      for (const f of result.migrated) console.log(`    ${colors.dim(f)}`);
    }
    if (versionDelta || (result.sync && result.sync.conflicted.length > 0)) {
      console.log();
      console.log(colors.dim("  For AI agents:"));
      const somedelta =
        mainPkg?.from && mainPkg.to
          ? `v${mainPkg.from.replace(/^[\^~>=v]+/, "")}...v${mainPkg.to.replace(/^[\^~>=v]+/, "")}`
          : "";
      console.log(
        colors.dim(`  This upgrade applied template changes${somedelta ? ` (${somedelta})` : ""}.`),
      );
      if (result.sync && result.sync.conflicted.length > 0) {
        console.log(
          colors.dim(
            `  ${result.sync.conflicted.length} file(s) had local conflicts — template version applied, backups at ${result.sync.backupDir || ".bos/sync-backup/"}.`,
          ),
        );
        console.log(
          colors.dim(
            `  If local changes should be preserved upstream, file an issue: ${UPSTREAM_ISSUE_URL} (or open a PR).`,
          ),
        );
      }
      console.log(
        colors.dim(
          "  Load matching intent skills: pnpm dlx @tanstack/intent@latest load everything-dev#...",
        ),
      );
      console.log(colors.dim("  Review AGENTS.md — local updates may need merging."));
    } else if (!versionDelta) {
      console.log(
        colors.dim(
          "  Framework version unchanged — template files not touched (run `bos sync` to pull upstream drift).",
        ),
      );
    }
    console.log();
    return;
  },
};
