import type { PsResult } from "../../contract";
import { colors, frames, gradients, icons } from "../../utils/theme";

export function renderPs(result: PsResult): void {
  console.log();
  if (result.status === "error") {
    console.error(`[CLI] ${result.error || "Unknown error"}`);
    process.exit(1);
  }
  const entries = result.entries ?? [];
  if (entries.length === 0) {
    console.log(colors.dim("  No tracked development processes running."));
    console.log();
    console.log(colors.dim(`  Start one with ${colors.cyan("bos dev")} and it will appear here.`));
    console.log();
    return;
  }
  console.log(colors.cyan(frames.top(60)));
  console.log(`  ${icons.app} ${gradients.cyber("PROCESSES")}`);
  console.log(colors.cyan(frames.bottom(60)));
  console.log();
  for (const entry of entries) {
    const ageMs = Date.now() - entry.startedAt;
    const ageStr =
      ageMs < 60_000
        ? `${Math.floor(ageMs / 1000)}s`
        : ageMs < 3_600_000
          ? `${Math.floor(ageMs / 60_000)}m`
          : `${Math.floor(ageMs / 3_600_000)}h`;
    const roleTag =
      entry.role === "workspace-parent"
        ? colors.magenta("parent")
        : entry.role === "workspace-child"
          ? colors.blue("child")
          : colors.dim("dev");
    console.log(`  ${colors.green(`pid ${entry.pid}`)}  ${roleTag}  ${colors.dim(ageStr)}`);
    console.log(`    ${colors.dim("dir:")}    ${entry.configDir}`);
    if (entry.parentPid !== undefined) {
      console.log(`    ${colors.dim("parent:")} ${entry.parentPid}`);
    }
    const portPairs = Object.entries(entry.ports ?? {})
      .filter(([, p]) => typeof p === "number")
      .map(([k, v]) => `${k}=${v}`);
    if (portPairs.length > 0) {
      console.log(`    ${colors.dim("ports:")}  ${portPairs.join("  ")}`);
    }
    if (entry.budget) {
      console.log(`    ${colors.dim("budget:")} [${entry.budget.min}, ${entry.budget.max}]`);
    }
    console.log(`    ${colors.dim("desc:")}   ${entry.description}`);
    console.log();
  }
}
