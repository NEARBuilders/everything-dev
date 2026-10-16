import type { DeployLegOutcome } from "./contract";
import {
  type DeployImagePlan,
  type ResolvedImageRef,
  resolveDeployImagePlan,
} from "./image-deploy";

export type { DeployLegOutcome };
export type DeployLegStatus = DeployLegOutcome["status"];

export interface DeployLegs {
  image?: DeployLegOutcome;
  smoke?: DeployLegOutcome;
  railway?: DeployLegOutcome;
}

/**
 * Runtime tier (ADR 0020/0021): a "root" train owns its runtime image —
 * `ci.image` is configured, `BOS_IMAGE` names one, or a Dockerfile exists at
 * the config root, so the train can produce a digest and pin Railway to
 * exactly the bytes it validated. A "child" runtime inherits the platform's
 * universal image (identity-driven boot); it has no image bytes to build,
 * pin, or boot.
 */
export type RuntimeTier = "root" | "child";

export function resolveRuntimeTier(input: {
  ciImage?: string;
  imageEnv?: string;
  hasDockerfile: boolean;
}): RuntimeTier {
  return input.ciImage || input.imageEnv || input.hasDockerfile ? "root" : "child";
}

/**
 * The image leg's plan, tier-aware. `resolveDeployImagePlan` stays the single
 * producer of every variant; a child runtime can never build (no Dockerfile —
 * that is what makes it a child), so its skips are replaced with the
 * inheritance reason instead of pointing at `ci.image` configuration the
 * child deliberately does not have.
 */
export function resolveImageLegPlan(input: {
  tier: RuntimeTier;
  imageRef: ResolvedImageRef | undefined;
  imageDigest?: string;
  hasDocker: boolean;
  hasDockerfile: boolean;
}): DeployImagePlan {
  const plan = resolveDeployImagePlan(input);
  if (plan.kind === "skip" && input.tier === "child") {
    return {
      kind: "skip",
      reason:
        "child runtime inherits the root's universal image (ADR 0020) — no image leg in this train",
    };
  }
  return plan;
}

export type RailwayLegDecision =
  | { action: "skip"; outcome: DeployLegOutcome }
  | { action: "redeploy"; outcome?: undefined };

/**
 * The Railway leg's decision, tier-aware. A child runtime never needs a
 * digest: its Railway service source is the root's universal image (connected
 * once in the dashboard), so `redeploy --from-source` is just a reload
 * trigger for the freshly published config — the token is project-scoped and
 * cannot touch another project's service. A root runtime must have pinned
 * bytes: without a digest the "pulled bytes are what this train validated"
 * guarantee (ADR 0021) is unmeetable, and that is a failure, not a skip.
 */
export function resolveRailwayLeg(input: {
  tier: RuntimeTier;
  railwayToken?: string;
  service?: string;
  digest?: string;
}): RailwayLegDecision {
  if (!input.railwayToken) {
    return {
      action: "skip",
      outcome: { status: "skipped", detail: "RAILWAY_TOKEN not set" },
    };
  }
  if (!input.service) {
    return input.tier === "root"
      ? {
          action: "skip",
          outcome: {
            status: "failed",
            detail: "ci.railway.service is not configured in bos.config.json",
          },
        }
      : {
          action: "skip",
          outcome: {
            status: "skipped",
            detail: "set ci.railway.service in bos.config.json to trigger a Railway redeploy",
          },
        };
  }
  if (!input.digest && input.tier === "root") {
    return {
      action: "skip",
      outcome: {
        status: "failed",
        detail:
          "Railway deploy requires a runtime image (set ci.image, or pass BOS_IMAGE_DIGEST for a pre-pushed image)",
      },
    };
  }
  return { action: "redeploy" };
}
