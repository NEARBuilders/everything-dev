import type { StartSummary } from "../../dev-program";
import { colors } from "../../utils/theme";
import { formatDuration, sumPhaseDurations } from "../timing";

/** The `bos start` boot summary. */
export function printStartSummary(summary: StartSummary) {
  console.log();
  console.log(`  ${colors.dim("Config Source:")}  ${summary.configSource}`);
  if (summary.configSourceHttp) {
    console.log(`                  ${colors.dim(summary.configSourceHttp)}`);
  }
  console.log(`  ${colors.dim("Account:")}        ${summary.account}`);
  console.log(`  ${colors.dim("Domain:")}         ${summary.domain ?? "not configured"}`);
  console.log();
  console.log(`  ${colors.dim("Modules:")}`);
  console.log(`    ${colors.dim("HOST")}  → ${summary.modules.host ?? "local"}`);
  console.log(`    ${colors.dim("UI")}   → ${summary.modules.ui ?? "local"}`);
  console.log(`    ${colors.dim("API")}  → ${summary.modules.api ?? "local"}`);
  if (summary.modules.auth) {
    console.log(`    ${colors.dim("AUTH")}  → ${summary.modules.auth}`);
  }
  if (summary.warnings.length > 0) {
    console.log();
    for (const w of summary.warnings) {
      console.log(`  ${colors.yellow(w)}`);
    }
  }
  console.log();
}

/** Phase timings below a long-running summary. */
export function printTimingSummary(
  timings: Array<{ name: string; durationMs: number }> | undefined,
) {
  if (!timings || timings.length === 0) return;

  console.log(`  ${colors.dim("Timings:")}`);
  for (const timing of timings) {
    console.log(`    ${colors.dim(timing.name.padEnd(22))} ${formatDuration(timing.durationMs)}`);
  }
  console.log(
    `    ${colors.dim("total".padEnd(22))} ${formatDuration(sumPhaseDurations(timings))}`,
  );
}

/** Erase the clack spinner line so streamed output starts clean. */
export function clearSpinnerStopLine() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[1A\x1b[2K\r");
}
