import type { WorkspaceBuildRender } from "../../services/workspace/build-train";
import { padRight } from "../../utils/string";
import { colors, icons } from "../../utils/theme";
import { formatDuration } from "../timing";

/** The deploy build train's ✓/✗ table — exact presentation moved out of the
 * service by #424. */
export const cliWorkspaceBuildRender: WorkspaceBuildRender = {
  banner: (total) => {
    console.log();
    console.log(`  Building ${total} workspace${total > 1 ? "s" : ""}...`);
    console.log();
  },
  prerequisites: (names) => {
    console.log(`  ${colors.dim(`prerequisites: rebuilt ${names.join(", ")}`)}`);
  },
  outcome: (outcome) => {
    const name = padRight(outcome.key, 28);
    if (outcome.success) {
      console.log(
        `  ${colors.green(icons.ok)} ${name} ${colors.dim(formatDuration(outcome.durationMs))}`,
      );
    } else {
      const errorLine = (outcome.error ?? "Failed").split("\n")[0];
      console.log(`  ${colors.error(icons.err)} ${name} ${errorLine}`);
    }
  },
  end: () => {
    console.log();
  },
};
