import process from "node:process";
import * as p from "@clack/prompts";
import type { UpgradeOptions } from "../contract";
import { syncTemplate } from "../services/scaffold/sync";
import { colors } from "../utils/theme";
import { upgradeTemplate } from "./upgrade";

/**
 * The interactive upgrade plan (`bos upgrade` on a TTY): show the version
 * delta and the exact files the upgrade will write, let the user toggle
 * per-file (default: overwrite all), offer the post-upgrade clean, and
 * confirm before anything lands. `--force` skips the plan and overwrites
 * everything; non-TTY runs (CI, scripts) keep the classic refuse-on-conflict
 * behavior.
 */

export interface UpgradeInteractionDecision {
  overwrite?: string[];
  cleanAfter?: boolean;
}

export async function planUpgradeInteraction(
  projectDir: string,
  input: UpgradeOptions,
): Promise<UpgradeInteractionDecision> {
  if (input.force || input.dryRun || input.check || input.noSync || input.migrationsOnly) {
    return {};
  }
  if (!process.stdout.isTTY) return {};

  // Phase A — the version plan (dry-run: resolution + package deltas only).
  const plan = await upgradeTemplate(projectDir, { ...input, dryRun: true });
  if (plan.status !== "dry-run" || !plan.updatesAvailable) return {};

  // Phase B — the file plan (dry-run sync against the same release).
  const preflight = await syncTemplate(projectDir, { dryRun: true });
  if (preflight.status === "error") return {};
  const conflicted = preflight.conflicted;
  const writable = [...preflight.updated, ...preflight.added, ...conflicted];
  if (writable.length === 0) return {};

  p.log.step(
    `Upgrade plan — ${plan.packages
      .filter((pkg) => pkg.from && pkg.from !== pkg.to)
      .map((pkg) => `${pkg.name} ${pkg.from} → ${pkg.to}`)
      .join(", ")}`,
  );
  p.log.message(
    `Release: ${plan.release?.resolved ?? "latest"} (${plan.release?.source ?? "extends chain"})`,
  );
  if (plan.changelogUrl) p.log.message(`Changelog: ${plan.changelogUrl}`);

  const selected = await p.multiselect({
    message: "Files this upgrade will write (space toggles, enter confirms)",
    options: writable.map((file) => ({
      value: file,
      label: file,
      hint: conflicted.includes(file)
        ? "local edits — template wins (backup kept)"
        : preflight.added.includes(file)
          ? "new file"
          : "template update",
    })),
    initialValues: writable,
    required: false,
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled — nothing was written");
    process.exit(0);
  }

  const cleanAfter = await p.confirm({
    message: "Prune logs and caches after the upgrade (bos clean — upgrade backups kept)?",
    initialValue: true,
  });
  if (p.isCancel(cleanAfter)) {
    p.cancel("Cancelled — nothing was written");
    process.exit(0);
  }

  const go = await p.confirm({ message: "Write?", initialValue: true });
  if (p.isCancel(go) || !go) {
    p.cancel("Cancelled — nothing was written");
    process.exit(0);
  }

  p.log.message(
    colors.dim(
      selected.length === writable.length
        ? `Writing all ${writable.length} file(s)`
        : `Writing ${selected.length} of ${writable.length} — the rest stay as your local copies`,
    ),
  );

  // The selection always flows through — even "all files" — because it is
  // also the conflict resolution: without it the train would abort on the
  // very conflicts the user just approved overwriting.
  return { overwrite: [...selected], cleanAfter };
}
