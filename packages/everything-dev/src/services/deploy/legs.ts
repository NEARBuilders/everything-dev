import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { DeployLegOutcome } from "../../contract";
import { colors, icons } from "../../utils/theme";
import {
  buildAndPushImage,
  deployImageToRailway,
  hasDocker,
  imageRefWithDigest,
  type ResolvedImageRef,
  repointServiceSource,
  resolveImageRef,
  resolveRegistryDigest,
} from "./image";
import { deriveImageRefFromPlatformManifest } from "./platform-manifest";
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
 * `BOS_IMAGE` names one (with a pre-pushed digest) or a Dockerfile exists at
 * the config root, so the train can produce a digest and pin Railway to
 * exactly the bytes it validated. A "child" runtime inherits the platform's
 * universal image (identity-driven boot); it has no image bytes to build,
 * pin, or boot — its image ref derives from the platform release manifest
 * (ADR 0034).
 */
export type RuntimeTier = "root" | "child";

export function resolveRuntimeTier(input: {
  imageEnv?: string;
  hasDockerfile: boolean;
}): RuntimeTier {
  return input.imageEnv || input.hasDockerfile ? "root" : "child";
}

/** The child image pin (ADR 0034): `ref:v<version>` from the resolved
 * platform release manifest, with the tag's digest resolved from the
 * registry. The Railway service source repoints to the ref and the smoke
 * gate boots the digest. */
export interface ChildImagePin {
  image: string;
  tag: string;
  digest: string;
}

/**
 * The child image pin: the platform release manifest resolves through the
 * extends chain (authored `platform` pin, else nearest-wins) to `ref:tag`,
 * and the registry resolves the tag's digest. Undefined when no manifest
 * resolves — the additive fallback (ADR 0034) is today's float redeploy.
 */
export async function resolveChildImagePin(input: {
  configDir: string;
  localConfig: Record<string, unknown>;
  fetchManifest?: Parameters<typeof deriveImageRefFromPlatformManifest>[0]["fetchManifest"];
  fetchDigest?: typeof resolveRegistryDigest;
}): Promise<ChildImagePin | undefined> {
  const derived = await deriveImageRefFromPlatformManifest({
    configDir: input.configDir,
    localConfig: input.localConfig,
    fetchManifest: input.fetchManifest,
  });
  if (!derived) return undefined;
  const digest = await (input.fetchDigest ?? resolveRegistryDigest)({
    ref: `${derived.image}:${derived.tag}`,
  });
  return { image: derived.image, tag: derived.tag, digest };
}

/**
 * The post-publish decision table (ADR 0020/0021/0034) — pure data, one
 * place. Precedence for the image leg: an explicit digest handover
 * (`BOS_IMAGE_DIGEST`, any tier) wins; a child pins the platform manifest's
 * ref or skips with the inheritance reason; a root runs the
 * build/prebuilt/skip chain. Smoke boots only pinned/known-digest refs.
 * Every step is executable without further decisions; the railway step is
 * decided separately (`resolveRailwayStep`) because it legitimately depends
 * on the image leg's execution outcome (the captured digest).
 */

export type ImageStep =
  | { action: "pinned"; image: string; tag: string; digest: string }
  | { action: "prebuilt"; image: string; digest: string }
  | { action: "build"; image: string }
  | { action: "skip"; reason: string };

export type SmokeStep =
  /** `ref` is precomputed when the digest is known at plan time; a build
   * boots `image` and the interpreter appends the captured digest. */
  { action: "boot"; image: string; ref?: string } | { action: "skip"; reason: string };

export interface DeployPlan {
  tier: RuntimeTier;
  image: ImageStep;
  /** Absent when `--smoke` was not requested. */
  smoke?: SmokeStep;
}

export function resolveDeployPlan(input: {
  tier: RuntimeTier;
  childPin?: ChildImagePin;
  imageRef?: ResolvedImageRef;
  digestHandover?: string;
  hasDocker: boolean;
  hasDockerfile: boolean;
  smokeRequested: boolean;
}): DeployPlan {
  let image: ImageStep;
  if (input.digestHandover && input.imageRef) {
    image = {
      action: "prebuilt",
      image: input.imageRef.image,
      digest: input.digestHandover,
    };
  } else if (input.tier === "child") {
    image = input.childPin
      ? {
          action: "pinned",
          image: input.childPin.image,
          tag: input.childPin.tag,
          digest: input.childPin.digest,
        }
      : {
          action: "skip",
          reason:
            "child runtime inherits the root's universal image (ADR 0020) — no image leg in this train",
        };
  } else if (!input.imageRef) {
    image = {
      action: "skip",
      reason:
        "set BOS_IMAGE (or repository in bos.config.json) to build and push the runtime image",
    };
  } else if (!input.hasDocker) {
    image = { action: "skip", reason: "docker is not available" };
  } else if (!input.hasDockerfile) {
    image = { action: "skip", reason: "no Dockerfile at the config root" };
  } else {
    image = { action: "build", image: input.imageRef.image };
  }

  let smoke: SmokeStep | undefined;
  if (input.smokeRequested) {
    if (image.action === "pinned" || image.action === "prebuilt") {
      smoke = {
        action: "boot",
        image: image.image,
        ref: imageRefWithDigest(image.image, image.digest),
      };
    } else if (image.action === "build") {
      smoke = { action: "boot", image: image.image };
    } else {
      smoke = {
        action: "skip",
        reason:
          input.tier === "child"
            ? "child runtime inherits the root's universal image — no image digest to boot in this train"
            : "no runtime image digest — pass BOS_IMAGE_DIGEST for a pre-pushed image",
      };
    }
  }

  return { tier: input.tier, image, ...(smoke ? { smoke } : {}) };
}

export type RailwayStep =
  | { action: "repoint-and-redeploy"; service: string; image: string }
  | { action: "redeploy"; service: string }
  | { action: "fail"; detail: string }
  | { action: "skip"; detail: string };

/**
 * The railway step, decided after the image leg ran: a root runtime must
 * have pinned bytes (`pinnedDigest` — handover, pin, or build capture);
 * without them the "pulled bytes are what this train validated" guarantee
 * (ADR 0021) is unmeetable, and that is a failure, not a skip. A child
 * runtime never needs a digest: with a pin the service source repoints to
 * the pinned ref before the redeploy pulls it; without one, `redeploy
 * --from-source` is just a reload trigger for the freshly published config.
 * The token is project-scoped and cannot touch another project's service.
 */
export function resolveRailwayStep(input: {
  tier: RuntimeTier;
  token?: string;
  service?: string;
  pinnedDigest?: string;
  childPin?: ChildImagePin;
}): RailwayStep {
  if (!input.token) {
    return { action: "skip", detail: "RAILWAY_TOKEN not set" };
  }
  if (!input.service) {
    return input.tier === "root"
      ? {
          action: "fail",
          detail: "ci.railway.service is not configured in bos.config.json",
        }
      : {
          action: "skip",
          detail: "set ci.railway.service in bos.config.json to trigger a Railway redeploy",
        };
  }
  if (input.tier === "root" && !input.pinnedDigest) {
    return {
      action: "fail",
      detail:
        "Railway deploy requires a runtime image (pass BOS_IMAGE_DIGEST for a pre-pushed image)",
    };
  }
  if (input.childPin) {
    return {
      action: "repoint-and-redeploy",
      service: input.service,
      image: `${input.childPin.image}:${input.childPin.tag}`,
    };
  }
  return { action: "redeploy", service: input.service };
}

/**
 * The post-publish legs (ticket #422): image → smoke boot gate → Railway,
 * executing the pure decision table (`resolveDeployPlan` +
 * `resolveRailwayStep`). The deploy handler hands over the published-config
 * context; leg outcomes derive from leg results — a red boot gate rolls the
 * config back here, and the handler maps the returned outcome onto the wire
 * result mechanically.
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
  /** The authored leaf config — the platform pin + extends chain a child's
   * image pin resolves from (ADR 0034). */
  localConfig?: Record<string, unknown>;
  repository?: string;
  /** The train's release decision (#571/#573): version + floating image
   * tags move on the release deploy only. */
  release?: boolean;
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
  repointServiceSource: typeof repointServiceSource;
  resolveChildImagePin: typeof resolveChildImagePin;
  rollbackToPreviousSnapshot: typeof rollbackToPreviousSnapshot;
}

export const realPostPublishLegsDeps: PostPublishLegsDeps = {
  buildAndPushImage,
  hasDocker,
  runSmoke,
  deployImageToRailway,
  repointServiceSource,
  resolveChildImagePin,
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
    imageEnv: process.env.BOS_IMAGE,
    hasDockerfile,
  });

  let childPin: ChildImagePin | undefined;
  if (tier === "child") {
    try {
      childPin = await deps.resolveChildImagePin({
        configDir: input.sessionRoot,
        localConfig: input.localConfig ?? {},
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = `Image pin failed: ${message}`;
      legs.image = { status: "failed", detail };
      console.log(colors.yellow(`  ${detail}`));
      return { legs, failure: `Config published but ${detail}` };
    }
  }

  const plan = resolveDeployPlan({
    tier,
    childPin,
    imageRef: resolveImageRef({
      repository: input.repository,
      env: process.env,
    }),
    digestHandover: input.imageDigestInput,
    hasDocker: tier === "root" ? await deps.hasDocker() : false,
    hasDockerfile,
    smokeRequested: input.smoke,
  });

  switch (plan.image.action) {
    case "skip": {
      legs.image = { status: "skipped", detail: plan.image.reason };
      console.log();
      console.log(colors.yellow(`  Image skipped: ${plan.image.reason}`));
      break;
    }
    case "pinned": {
      image = plan.image.image;
      imageDigest = plan.image.digest;
      legs.image = {
        status: "ok",
        detail: `pinned ${plan.image.image}:${plan.image.tag} @ ${plan.image.digest.slice(0, 19)}…`,
      };
      console.log();
      console.log(
        colors.green(
          `  ${icons.ok} Pinned ${plan.image.image}:${plan.image.tag} @ ${plan.image.digest.slice(0, 19)}… (platform manifest)`,
        ),
      );
      break;
    }
    case "prebuilt": {
      image = plan.image.image;
      imageDigest = plan.image.digest;
      legs.image = {
        status: "ok",
        detail: `pre-pushed ${plan.image.image}@${plan.image.digest.slice(0, 19)}…`,
      };
      console.log();
      console.log(
        colors.green(
          `  ${icons.ok} Using pre-pushed image ${plan.image.image}@${plan.image.digest.slice(0, 19)}…`,
        ),
      );
      break;
    }
    case "build": {
      console.log();
      try {
        // Release-conditional image tags (#571/#573): the release decision is
        // made once in the train (the single pointer read) and threaded here
        // — root tier only; children never release. Unverifiable reads as
        // non-release: version tags must never move on a maybe.
        const imageResult = await deps.buildAndPushImage({
          image: plan.image.image,
          configDir: input.sessionRoot,
          verbose: input.verbose,
          release: tier === "root" && input.release,
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
      break;
    }
  }

  // Post-publish boot gate (publish → smoke → Railway, ADR 0021): the
  // just-published config is only promoted to Railway if the runtime image —
  // the one this train pinned — boots against it. A red smoke rolls the
  // config back to the previous snapshot, so the new-config/old-image window
  // never survives the deploy run.
  if (plan.smoke) {
    if (plan.smoke.action === "skip") {
      legs.smoke = { status: "skipped", detail: plan.smoke.reason };
      console.log();
      console.log(colors.yellow(`  Post-publish smoke skipped: ${plan.smoke.reason}`));
    } else {
      const ref =
        plan.smoke.ref ??
        (imageDigest ? imageRefWithDigest(plan.smoke.image, imageDigest) : undefined);
      if (!ref || !imageDigest) {
        const smokeSkip = "no runtime image digest — pass BOS_IMAGE_DIGEST for a pre-pushed image";
        legs.smoke = { status: "skipped", detail: smokeSkip };
        console.log();
        console.log(colors.yellow(`  Post-publish smoke skipped: ${smokeSkip}`));
      } else {
        console.log();
        console.log(colors.cyan("  ▶ Post-publish smoke (boot gate)"));
        const smokeResult = await deps.runSmoke({
          image: ref,
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
  }

  const railwayStep = resolveRailwayStep({
    tier,
    token: process.env.RAILWAY_TOKEN,
    service: input.railwayService,
    pinnedDigest: imageDigest,
    childPin,
  });

  if (railwayStep.action === "skip") {
    legs.railway = { status: "skipped", detail: railwayStep.detail };
    console.log();
    console.log(colors.yellow(`  Railway deploy skipped: ${railwayStep.detail}`));
  } else if (railwayStep.action === "fail") {
    legs.railway = { status: "failed", detail: railwayStep.detail };
    console.log();
    console.log(colors.yellow(`  Railway deploy failed: ${railwayStep.detail}`));
    return {
      legs,
      failure: `Config published but ${railwayStep.detail}`,
    };
  } else {
    service = railwayStep.service;
    try {
      // A pinned child's service source follows the platform manifest pin
      // before the redeploy pulls from it (ADR 0034): the pulled bytes are
      // the pin, not whatever the dashboard's floating ref moved to.
      if (railwayStep.action === "repoint-and-redeploy") {
        await deps.repointServiceSource({
          service: railwayStep.service,
          image: railwayStep.image,
          configDir: input.sessionRoot,
        });
      }
      await deps.deployImageToRailway({
        service: railwayStep.service,
        configDir: input.sessionRoot,
      });
      legs.railway = {
        status: "ok",
        detail:
          railwayStep.action === "repoint-and-redeploy"
            ? `pinned ${railwayStep.image}, redeployed ${service}`
            : `redeployed ${service}`,
      };
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
