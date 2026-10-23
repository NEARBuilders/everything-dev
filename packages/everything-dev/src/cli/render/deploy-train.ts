import type {
  DeployTrainRender,
  PublishSectionRender,
  UploadOutcomeRender,
} from "../../services/deploy/render";

/** The Build section's attributed warnings block: one sub-block per workspace
 * that has them, name-padded like every other row (#431). */
export function renderBuildWarnings(
  deployResults: ReadonlyArray<{ key: string; warnings?: string[] }>,
): void {
  const withWarnings = deployResults.filter((r) => (r.warnings ?? []).length > 0);
  if (withWarnings.length === 0) return;
  console.log();
  console.log(`  ${colors.yellow("⚠")} Build warnings:`);
  for (const result of withWarnings) {
    for (const warning of result.warnings ?? []) {
      const lines = warning.split("\n");
      console.log(`    ${padRight(result.key, NAME_COLUMN)} ${colors.dim(lines[0] ?? "")}`);
      for (const continuation of lines.slice(1)) {
        console.log(`    ${padRight("", NAME_COLUMN)} ${colors.dim(continuation)}`);
      }
    }
  }
}

import { padRight } from "../../utils/string";
import { colors, icons } from "../../utils/theme";
import { formatDuration } from "../../utils/timing";

const NAME_COLUMN = 28;

/**
 * The deploy train's sectioned renderer (#431): Build / Upload / Publish /
 * Image+Railway, one consistent name-padded column, deterministic order (the
 * train reports outcomes in target order — parallel units never interleave).
 * Default view: one line per workspace upload; detail lines only under
 * --verbose.
 */
export const cliDeployTrainRender: DeployTrainRender = {
  cdnBanner: (storageOrigin) => {
    console.log();
    console.log(`  CDN deploy — uploading workspace dists to ${storageOrigin}...`);
  },

  uploadOutcome: (outcome: UploadOutcomeRender) => {
    const name = padRight(outcome.key, NAME_COLUMN);
    if (!outcome.ok) {
      console.log(`  ${colors.error(icons.err)} ${name} upload failed`);
      return;
    }
    console.log(
      `  ${colors.green(icons.ok)} ${name} → ${outcome.base} (${outcome.uploaded} uploaded, ${outcome.skipped} skipped, ${formatDuration(outcome.durationMs ?? 0)})`,
    );
    if (outcome.detailNotes) {
      for (const note of outcome.detailNotes) {
        console.log(`    ${colors.dim(`${padRight("", NAME_COLUMN)} ${note}`)}`);
      }
    }
  },

  publish: (info: PublishSectionRender) => {
    console.log();
    console.log("  Publishing to:");
    console.log(`    ${colors.cyan(info.registryUrl)}`);
    console.log(`    ${colors.dim("Fingerprint:")} ${info.fingerprint}`);
    for (const [slot, pin] of info.slotPins) {
      console.log(`    ${colors.dim(`${slot}:`)}`);
      console.log(`      ${pin}`);
    }
    console.log(
      `    ${colors.dim(`+ per-deploy manifest ${info.auditManifestFile} (audit trail)`)}`,
    );
  },
};
