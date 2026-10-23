/**
 * Thin facade: the status/version resolution lives in services/status.ts.
 */
export * from "../services/status";

import { compareSemver } from "../services/status";
import { colors } from "../utils/theme";

/** Outdated-framework warning, printed after the command's status probe. */
export async function warnIfOutdated(client: any, command: string): Promise<void> {
  if (!["dev", "build", "start"].includes(command)) return;

  try {
    const status = await client.status();
    if (status.status === "error" || !status.packages) return;

    const frameworkPackages = ["everything-dev", "every-plugin"];

    const linked = status.packages.filter((p: { isLinked?: boolean }) => p.isLinked);
    const outdated = status.packages.filter(
      (p: { name: string; installed?: string; latest?: string; isLinked?: boolean }) =>
        !p.isLinked &&
        p.installed &&
        p.latest &&
        compareSemver(p.installed, p.latest) < 0 &&
        frameworkPackages.includes(p.name),
    );

    if (linked.length > 0) {
      for (const pkg of linked) {
        console.log(colors.dim(`    ${pkg.name} is linked locally (v${pkg.installed})`));
      }
    }

    if (outdated.length === 0) return;

    const warn = (line: string) => {
      if (command === "dev" || command === "start") process.stderr.write(`${line}\n`);
      else console.log(line);
    };
    warn("");
    warn(colors.yellow(`  ! Outdated packages detected:`));
    for (const pkg of outdated) {
      warn(colors.dim(`    ${pkg.name}  ${pkg.installed} → ${pkg.latest}`));
    }
    warn(
      colors.dim(
        `    Run ${colors.cyan("bos upgrade")} to update packages and sync template files.`,
      ),
    );
    warn("");
  } catch {
    // silently ignore if status check fails
  }
}
