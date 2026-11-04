import { colors, icons } from "../../utils/theme";
import type { ResultRenderer } from "./context";

export const lockRenderers: Record<string, ResultRenderer> = {
  lock: async (result, _ctx) => {
    console.log();
    if (result.status === "error") {
      console.error(colors.error(`${icons.err} ${result.error ?? "bos lock failed"}`));
      return;
    }
    if (result.status === "drift") {
      console.error(colors.error(`${icons.err} composition lockfile drift (${result.path})`));
      for (const line of result.drift ?? []) {
        console.error(`  ${line}`);
      }
      console.error(
        colors.dim("  bos lock --check refuses to pass until the lockfile is refreshed"),
      );
      return;
    }
    if (result.status === "unchanged") {
      console.log(colors.dim(`${icons.ok} bos.lock.json already matches the resolved composition`));
    } else {
      console.log(colors.green(`${icons.ok} Froze the resolved composition`));
      console.log(`  ${colors.dim("Written:")} ${result.path}`);
    }
    if (result.fingerprint) {
      console.log(`  ${colors.dim("Fingerprint:")} ${result.fingerprint}`);
    }
    console.log();
  },
};
