import type { DeployLegs } from "../../services/deploy/legs";
import { colors, icons } from "../../utils/theme";

const DEPLOY_LEG_NAMES = ["image", "smoke", "railway"] as const;

/** The per-leg ✓/-/✗ table under a deploy result. */
export function renderDeployLegs(legs: DeployLegs | undefined): void {
  if (!legs) return;
  const rows: Array<readonly [string, DeployLegs["image"]]> = DEPLOY_LEG_NAMES.map((name) => [
    name,
    legs[name],
  ]);
  console.log();
  for (const [name, leg] of rows) {
    if (!leg) continue;
    const mark =
      leg.status === "ok"
        ? colors.green(icons.ok)
        : leg.status === "skipped"
          ? colors.dim("-")
          : colors.error(icons.err);
    console.log(`  ${mark} ${name}${leg.detail ? colors.dim(` ${leg.detail}`) : ""}`);
  }
}

/** Names of the failed deploy legs — the exit-code signal. */
export function failedDeployLegs(legs: DeployLegs | undefined): string[] {
  if (!legs) return [];
  return DEPLOY_LEG_NAMES.filter((name) => legs[name]?.status === "failed");
}
