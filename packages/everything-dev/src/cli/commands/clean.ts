import { colors, icons } from "../../utils/theme";
import type { ResultRenderer } from "./context";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const cleanRenderers: Record<string, ResultRenderer> = {
  clean: async (result, _ctx) => {
    console.log();
    if (result.status === "error") {
      console.error(colors.error(`${icons.err} ${result.error ?? "bos clean failed"}`));
      return;
    }
    for (const entry of result.entries) {
      if (entry.action === "kept") {
        console.log(`  ${colors.dim(`${icons.ok} kept`)} ${entry.id} — ${entry.reason ?? ""}`);
        continue;
      }
      if (entry.action === "absent") continue;
      const verb = entry.action === "would-remove" ? "would remove" : "removed";
      console.log(
        `  ${colors.green(icons.ok)} ${verb.padEnd(12)} ${entry.id.padEnd(16)} ${formatBytes(entry.bytes)}` +
          (entry.reason ? ` ${colors.dim(`(${entry.reason})`)}` : ""),
      );
    }
    const label = result.dryRun ? "Would free" : "Freed";
    console.log(`\n  ${colors.green(`${label}:`)} ${formatBytes(result.freedBytes)}`);
    if (result.dryRun) {
      console.log(colors.dim("  bos clean performs the removals"));
    }
    console.log();
  },
};
