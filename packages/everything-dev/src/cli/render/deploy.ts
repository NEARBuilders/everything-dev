import type { TrainErrorKind } from "../../services/deploy/errors";
import type { DeployLegs } from "../../services/deploy/legs";
import { nearblocksUrl } from "../../services/deploy/output";
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

interface TrainFailureShape {
  kind?: string;
  registryUrl?: string;
  error?: string;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  deployResults?: Array<{ key: string; success: boolean; error?: string }>;
}

/** Per-kind guidance for the failure block: where the train stopped, why it
 * matters (what state the site is in), what to do next. The raw error text
 * stays under "what happened" — this map frames it instead of replacing it. */
const TRAIN_FAILURE_GUIDE: Record<
  TrainErrorKind,
  { where: string; matters: string; todo: string[] }
> = {
  preflight: {
    where: "Preflight",
    matters: "Nothing was built or published — the deploy stopped before the build train.",
    todo: ["Fix the flagged credential or config value (details above)", "Re-run `bos deploy`"],
  },
  build: {
    where: "Build",
    matters: "One or more workspace bundles failed to compile — nothing was uploaded or published.",
    todo: [
      "Scroll up for the failing workspace's build output (or re-run with --verbose)",
      "Fix the build error and re-run `bos deploy`",
    ],
  },
  reload: {
    where: "Build",
    matters:
      "The build finished, but the config could not be re-read afterwards — nothing was uploaded or published.",
    todo: ["Re-run `bos deploy` — this is usually transient"],
  },
  "config-state": {
    where: "Config",
    matters:
      "Nothing was published — a config-only publish over an unreadable registry would wipe live bundle URLs.",
    todo: ["Retry when the registry is reachable, or run a full `bos deploy`"],
  },
  upload: {
    where: "Upload",
    matters: "The live config was not changed — the site still serves the previous deploy.",
    todo: ["Re-run `bos deploy` — uploads are content-addressed and safe to repeat"],
  },
  "missing-manifest": {
    where: "Upload",
    matters: "The live config was not changed — the dist predates hashed entry names.",
    todo: ["Rebuild the workspace (a stale dist cannot deploy safely)", "Re-run `bos deploy`"],
  },
  "memory-backend": {
    where: "Upload",
    matters: "Nothing was published — the receiving storage instance would lose bytes on restart.",
    todo: [
      "Configure BOS_STORAGE_* R2 credentials on the receiving instance",
      "Re-run `bos deploy`",
    ],
  },
  "config-write": {
    where: "Upload",
    matters:
      "Bundles are uploaded, but the local bos.config.json write-back failed — local pins may be stale.",
    todo: ["Check write permissions in the project directory", "Re-run `bos deploy` to repair"],
  },
  composition: {
    where: "Composition gate",
    matters: "Nothing was published — a consumer boot would refuse this composition.",
    todo: ["Fix the listed composition violations", "Re-run `bos deploy`"],
  },
  "pin-verification": {
    where: "Pin verification",
    matters:
      "Nothing was published — a pinned remote's bytes no longer serve at its production URL.",
    todo: [
      "Redeploy the named remote, or bump its pin in the authored config",
      "Re-run `bos deploy`",
    ],
  },
  "platform-manifest": {
    where: "Release",
    matters: "The config was not published — the release manifest keys were left untouched.",
    todo: [
      "Follow the fix above (a burned version must be bumped, never reused)",
      "Re-run `bos deploy`",
    ],
  },
  "platform-truth": {
    where: "Release gate",
    matters:
      "Nothing was published — the build's shared-singleton versions disagree with the release manifest.",
    todo: ["Realign installed versions with the catalog (`pnpm install`)", "Re-run `bos deploy`"],
  },
  "compat-window": {
    where: "Compat gate",
    matters:
      "Nothing was published — pinned children would resolve shared-dependency skew under an unchanged platform manifest.",
    todo: [
      "Cut a release (bump the framework version) or realign the shared dependencies",
      "Re-run `bos deploy`",
    ],
  },
  sign: {
    where: "Publish",
    matters: "Nothing was published — the transaction was never submitted.",
    todo: ["Check the signing key and the account's balance", "Re-run `bos deploy`"],
  },
  submit: {
    where: "Publish",
    matters: "Nothing was published — the transaction submission failed.",
    todo: ["Re-run `bos deploy`"],
  },
  confirm: {
    where: "Publish",
    matters:
      "Bundles are uploaded, but the live config still points at the previous deploy — the site keeps serving the old version.",
    todo: [
      "Check the transaction on nearblocks (context below)",
      "Re-run `bos deploy` — publishing is idempotent; an on-chain gas failure needs a topped-up account",
    ],
  },
};

/** The structured deploy-failure block: what happened / why it matters /
 * what to do / context — replacing the old run-on error paragraph. */
export function renderTrainFailure(result: TrainFailureShape): void {
  console.log();
  const guide = result.kind ? TRAIN_FAILURE_GUIDE[result.kind as TrainErrorKind] : undefined;
  console.log(colors.error(`${icons.err} Deploy failed${guide ? ` at ${guide.where}` : ""}`));
  if (result.error) {
    console.log();
    console.log(colors.dim("  what happened"));
    for (const line of result.error.split("\n")) {
      console.log(`    ${line}`);
    }
  }
  if (guide) {
    console.log();
    console.log(colors.dim("  why it matters"));
    console.log(`    ${guide.matters}`);
    console.log();
    console.log(colors.dim("  what to do"));
    guide.todo.forEach((step, index) => {
      console.log(`    ${index + 1}. ${step}`);
    });
  }
  const context: Array<readonly [string, string]> = [];
  if (result.registryUrl) context.push(["registry", result.registryUrl] as const);
  if (result.txHash) context.push(["transaction", nearblocksUrl(result.txHash)] as const);
  if (result.built?.length) context.push(["built", result.built.join(", ")] as const);
  if (result.skipped?.length) context.push(["skipped", result.skipped.join(", ")] as const);
  if (context.length > 0) {
    console.log();
    console.log(colors.dim("  context"));
    for (const [label, value] of context) {
      console.log(`    ${colors.dim(`${label}:`)} ${value}`);
    }
  }
  const failures = (result.deployResults ?? []).filter((r) => !r.success);
  if (failures.length > 0) {
    console.log();
    for (const f of failures) {
      const errorLine = (f.error ?? "Failed").split("\n")[0];
      console.log(`    ${colors.error(icons.err)} ${f.key}: ${errorLine}`);
    }
  }
  console.log();
}
