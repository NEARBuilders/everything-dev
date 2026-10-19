import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { DeployLegOutcome } from "../../contract";
import { colors, icons } from "../../utils/theme";
import {
  buildAndPushImage,
  type DeployImagePlan,
  deployImageToRailway,
  hasDocker,
  imageRefWithDigest,
  type ResolvedImageRef,
  resolveDeployImagePlan,
  resolveImageRef,
} from "./image";
import { rollbackToPreviousSnapshot } from "./rollback-flow";
import { runSmoke } from "./smoke";

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

/**
 * The post-publish legs (ticket #422): image → smoke boot gate → Railway,
 * behind the runtime-tier policy from the leg-semantics ticket (#420). The
 * deploy handler hands over the published-config context; leg outcomes derive
 * from leg results — a red boot gate rolls the config back here, and the
 * handler maps the returned outcome onto the wire result mechanically.
 */

export interface PostPublishLegsInput {
  sessionRoot: string;
  env: "production" | "staging";
  smoke: boolean;
  imageDigestInput?: string;
  railwayService?: string;
  registry?: string;
  network?: "mainnet" | "testnet";
  privateKey?: string;
  wallet?: boolean;
  verbose?: boolean;
  /** post-publish session identity (the possibly-refreshed runtime) */
  account?: string;
  domain?: string;
  runtimeConfig: Parameters<typeof rollbackToPreviousSnapshot>[0]["runtimeConfig"];
  ciImage?: string;
  repository?: string;
}

export interface PostPublishLegsOutcome {
  image?: string;
  imageDigest?: string;
  service?: string;
  legs: DeployLegs;
  /** terminal failure after a published config — the config stays published */
  failure?: string;
}

/** The seams the legs need — injectable for tests, real modules by default. */
export interface PostPublishLegsDeps {
  buildAndPushImage: typeof buildAndPushImage;
  hasDocker: typeof hasDocker;
  runSmoke: typeof runSmoke;
  deployImageToRailway: typeof deployImageToRailway;
  rollbackToPreviousSnapshot: typeof rollbackToPreviousSnapshot;
}

export const realPostPublishLegsDeps: PostPublishLegsDeps = {
  buildAndPushImage,
  hasDocker,
  runSmoke,
  deployImageToRailway,
  rollbackToPreviousSnapshot,
};

export async function runPostPublishLegs(
  input: PostPublishLegsInput,
  deps: PostPublishLegsDeps = realPostPublishLegsDeps,
): Promise<PostPublishLegsOutcome> {
  const legs: DeployLegs = {};
  let image: string | undefined;
  let imageDigest: string | undefined;
  let service: string | undefined;

  const hasDockerfile = existsSync(join(input.sessionRoot, "Dockerfile"));
  const tier = resolveRuntimeTier({
    ciImage: input.ciImage,
    imageEnv: process.env.BOS_IMAGE,
    hasDockerfile,
  });

  const imagePlan = resolveImageLegPlan({
    tier,
    // A prebuilt digest pairs with the pushed ref (BOS_IMAGE from the CI
    // image job, or repository derivation) — ci.image is a build-time
    // choice, not a pin-time one; letting it win here could pin a digest
    // from a different image.
    imageRef: resolveImageRef({
      ciImage: input.imageDigestInput ? undefined : input.ciImage,
      repository: input.repository,
      env: process.env,
    }),
    imageDigest: input.imageDigestInput,
    hasDocker: tier === "root" ? await deps.hasDocker() : false,
    hasDockerfile,
  });

  if (imagePlan.kind === "skip") {
    legs.image = { status: "skipped", detail: imagePlan.reason };
    console.log();
    console.log(colors.yellow(`  Image skipped: ${imagePlan.reason}`));
  } else if (imagePlan.kind === "prebuilt") {
    image = imagePlan.image;
    imageDigest = imagePlan.digest;
    legs.image = {
      status: "ok",
      detail: `pre-pushed ${imagePlan.image}@${imagePlan.digest.slice(0, 19)}…`,
    };
    console.log();
    console.log(
      colors.green(
        `  ${icons.ok} Using pre-pushed image ${imagePlan.image}@${imagePlan.digest.slice(0, 19)}…`,
      ),
    );
  } else {
    console.log();
    try {
      const imageResult = await deps.buildAndPushImage({
        image: imagePlan.image,
        configDir: input.sessionRoot,
        verbose: input.verbose,
      });
      image = imageResult.image;
      imageDigest = imageResult.digest;
      legs.image = {
        status: "ok",
        detail: `built and pushed ${imageResult.image}:${imageResult.tag}`,
      };
      console.log(
        colors.green(
          `  ${icons.ok} Image pushed ${imageResult.image}:${imageResult.tag}${imageResult.digest ? ` (${imageResult.digest.slice(0, 19)}…)` : ""}`,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const imageError =
        message.includes("not found") || message.includes("ENOENT")
          ? "Docker not found — install Docker to build the runtime image"
          : `Image build/push failed: ${message}`;
      legs.image = { status: "failed", detail: imageError };
      console.log(colors.yellow(`  ${imageError}`));
      return {
        legs,
        failure: `Config published but ${imageError}`,
      };
    }
  }

  // Post-publish boot gate (publish → smoke → Railway, ADR 0021): the
  // just-published config is only promoted to Railway if the runtime
  // image — the one this train pinned — boots against it. A red smoke
  // rolls the config back to the previous snapshot, so the new-config/
  // old-image window never survives the deploy run.
  if (input.smoke) {
    if (!image || !imageDigest) {
      const smokeSkip =
        tier === "child"
          ? "child runtime inherits the root's universal image — no image digest to boot in this train"
          : "no runtime image digest — set ci.image (or pass BOS_IMAGE_DIGEST)";
      legs.smoke = { status: "skipped", detail: smokeSkip };
      console.log();
      console.log(colors.yellow(`  Post-publish smoke skipped: ${smokeSkip}`));
    } else {
      console.log();
      console.log(colors.cyan("  ▶ Post-publish smoke (boot gate)"));
      const smokeResult = await deps.runSmoke({
        image: imageRefWithDigest(image, imageDigest),
        account: input.account,
        gateway: input.domain,
      });
      if (!smokeResult.ok) {
        const cause = smokeResult.error ?? "unknown failure";
        console.log();
        console.log(colors.error(`  ${icons.err} Post-publish smoke failed: ${cause}`));
        if (smokeResult.diagnosis) {
          console.log(colors.yellow(`  ${smokeResult.diagnosis}`));
        }
        legs.smoke = { status: "failed", detail: cause };
        if (!input.account || !input.domain) {
          console.log(colors.yellow("  Rollback skipped: no registry identity in the session"));
          return {
            legs,
            failure: `Post-publish smoke failed (${cause}) — config NOT rolled back: no registry identity`,
          };
        }
        console.log(colors.yellow("  Rolling the published config back…"));
        const rollback = await deps.rollbackToPreviousSnapshot({
          account: input.account,
          domain: input.domain,
          env: input.env,
          runtimeConfig: input.runtimeConfig,
          configDir: input.sessionRoot,
          registry: input.registry,
          network: input.network,
          privateKey: input.privateKey,
          verbose: input.verbose,
        });
        const rollbackNote = rollback.ok
          ? `config rolled back to block ${rollback.blockHeight}`
          : `config NOT rolled back: ${rollback.error ?? "unknown"}`;
        console.log(colors.yellow(`  ${rollbackNote}`));
        return {
          legs,
          failure: `Post-publish smoke failed (${cause}) — ${rollbackNote}`,
        };
      }
      legs.smoke = { status: "ok", detail: smokeResult.summary };
      console.log(
        colors.green(`  ${icons.ok} Post-publish smoke passed: ${smokeResult.summary ?? ""}`),
      );
    }
  }

  const railwayDecision = resolveRailwayLeg({
    tier,
    railwayToken: process.env.RAILWAY_TOKEN,
    service: input.railwayService,
    digest: imageDigest,
  });

  if (railwayDecision.action === "skip") {
    legs.railway = railwayDecision.outcome;
    console.log();
    console.log(
      railwayDecision.outcome.status === "failed"
        ? colors.yellow(`  Railway deploy failed: ${railwayDecision.outcome.detail}`)
        : colors.yellow(`  Railway deploy skipped: ${railwayDecision.outcome.detail}`),
    );
    if (railwayDecision.outcome.status === "failed") {
      return {
        legs,
        failure: `Config published but ${railwayDecision.outcome.detail}`,
      };
    }
  } else {
    service = input.railwayService;
    try {
      await deps.deployImageToRailway({
        service: input.railwayService!,
        configDir: input.sessionRoot,
      });
      legs.railway = { status: "ok", detail: `redeployed ${service}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const railError =
        message.includes("not found") || message.includes("ENOENT")
          ? "Railway CLI not found. Install it: npm i -g @railway/cli"
          : `Railway deploy failed: ${message}`;
      legs.railway = { status: "failed", detail: railError };
      console.log(colors.yellow(`  ${railError}`));
      return {
        legs,
        image,
        imageDigest,
        service,
        failure: `Config published but ${railError}`,
      };
    }
  }

  return { image, imageDigest, service, legs };
}
