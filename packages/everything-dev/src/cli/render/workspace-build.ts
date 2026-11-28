import type { WorkspaceBuildRender } from "../../services/workspace/build-train";
import { padRight } from "../../utils/string";
import { colors, icons } from "../../utils/theme";
import { formatDuration } from "../../utils/timing";

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
  verdicts: (rows) => {
    console.log();
    console.log(
      `  ${rows.length} prerequisite${rows.length === 1 ? "" : "s"} in the closure — dry run, no builds`,
    );
    console.log();
    for (const row of rows) {
      const name = padRight(row.member, 28);
      const detail = row.verdict === "stale" ? (row.reason ?? "stale") : row.verdict;
      const mark =
        row.verdict === "fresh"
          ? colors.green(icons.ok)
          : row.verdict === "forced"
            ? colors.yellow(icons.arrow)
            : colors.error(icons.err);
      console.log(`  ${mark} ${name} ${colors.dim(detail)}`);
    }
    console.log();
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
