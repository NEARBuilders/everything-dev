import process from "node:process";
import { Effect } from "effect";
import { MISSING_CONFIG_MESSAGE } from "../config";
import type {
  DeployResult,
  PublishResult,
  RollbackResult,
  WorkspaceDeployResult,
} from "../contract";
import { fetchDeployManifests } from "../fastkv";
import { isValidImageDigest } from "../image-deploy";
import { openResolution } from "../resolution/session";
import { summarizeSlotPins, verifyRollbackSnapshot } from "../rollback";
import type { PublishTrainError, PublishTrainOk } from "../services/deploy/errors";
import { runPostPublishLegs } from "../services/deploy/legs";
import {
  fetchLiveConfig,
  fetchRollbackHistory,
  isSnapshotLive,
  publishRollbackSnapshot,
} from "../services/deploy/rollback-flow";
import { type DeployTrainInput, DeployTrainService } from "../services/deploy/train";
import type { BosConfig, BosConfigInput, RuntimeConfig } from "../types";
import { type BosBuilder, BosDepsTag } from "./shared";

type TrainErrorResult = {
  status: "error";
  registryUrl: string;
  error: string;
  txHash?: string;
  built?: string[];
  skipped?: string[];
  deployResults?: WorkspaceDeployResult[];
};

type TrainOk = PublishTrainOk & { status: "published" | "dry-run" };
type TrainResult = TrainOk | TrainErrorResult;

const mapTrainError = (error: PublishTrainError) =>
  Effect.succeed({ ...error.toResult(), status: "error" as const }) as Effect.Effect<TrainResult>;

const runTrain = (
  train: { publish: (input: DeployTrainInput) => Effect.Effect<PublishTrainOk, PublishTrainError> },
  input: DeployTrainInput,
): Promise<TrainResult> =>
  Effect.runPromise(train.publish(input).pipe(Effect.catchTag("PublishTrainError", mapTrainError)));

export function registerDeploy(builder: BosBuilder) {
  return {
    publish: builder.publish.effect(function* (_opts, input) {
      const deps = yield* BosDepsTag;
      const train = yield* DeployTrainService;
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: MISSING_CONFIG_MESSAGE,
        } satisfies PublishResult;
      }

      const result: TrainResult = yield* train
        .publish({
          bosConfig: session.config,
          runtimeConfig: session.runtime,
          configDir: session.root,
          env: input.env,
          build: false,
          dryRun: input.dryRun,
          verbose: input.verbose,
          packages: "all",
          network: input.network,
          privateKey: input.privateKey,
          wallet: input.wallet,
          registry: input.registry,
        })
        .pipe(Effect.catchTag("PublishTrainError", mapTrainError));

      return {
        status: result.status,
        registryUrl: result.registryUrl,
        txHash: result.txHash,
        ...(result.status === "error" && result.error ? { error: result.error } : {}),
        built: result.built,
        skipped: result.skipped,
        deployResults: result.deployResults,
      } satisfies PublishResult;
    }),

    rollback: builder.rollback.effect(function* (_opts, input) {
      const deps = yield* BosDepsTag;
      const session = deps.session;
      if (!session) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: MISSING_CONFIG_MESSAGE,
        } satisfies RollbackResult;
      }

      return yield* Effect.tryPromise({
        try: () => rollbackBody(session, input),
        catch: (error) => ({
          status: "error" as const,
          registryUrl: "",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }),

    deploy: builder.deploy.effect(function* (_opts, input) {
      const deps = yield* BosDepsTag;
      const train = yield* DeployTrainService;
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: MISSING_CONFIG_MESSAGE,
        } satisfies DeployResult;
      }
      const config = session.config;
      const deploySession = { config, runtime: session.runtime, root: session.root };

      return yield* Effect.tryPromise({
        try: () => deployBody(train, deploySession, input),
        catch: (error) => ({
          status: "error" as const,
          registryUrl: "",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }),
  };
}

async function rollbackBody(
  session: { config: BosConfig | null; runtime: RuntimeConfig | null; root: string },
  input: {
    registry?: string;
    limit: number;
    listOnly: boolean;
    version?: string;
    previous: boolean;
    force: boolean;
    env: "production" | "staging";
    dryRun: boolean;
    verbose: boolean;
    network?: "mainnet" | "testnet";
    privateKey?: string;
    wallet: boolean;
  },
): Promise<RollbackResult> {
  const { account, domain } = session.config ?? {};
  if (!account || !domain) {
    return {
      status: "error",
      registryUrl: "",
      error: "authored config must define account and domain to roll back",
    };
  }

  let history: Awaited<ReturnType<typeof fetchRollbackHistory>>;
  try {
    history = await fetchRollbackHistory({
      account,
      domain,
      registry: input.registry,
      limit: input.limit,
    });
  } catch (error) {
    return {
      status: "error",
      registryUrl: "",
      error: `Failed to fetch publish history: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (history.length === 0) {
    return {
      status: "error",
      registryUrl: "",
      error: `No publish history for ${account}/${domain} — nothing to roll back to`,
    };
  }

  const historyEntries = history.map((entry) => ({
    blockHeight: entry.blockHeight,
    blockTimestamp: new Date(Number(entry.blockTimestampNs.slice(0, 13))).toISOString(),
    ...(entry.txHash ? { txHash: entry.txHash } : {}),
    summary: summarizeSlotPins(entry.value as BosConfigInput),
  }));

  if (input.listOnly) {
    return {
      status: "list",
      registryUrl: "",
      history: historyEntries,
    };
  }

  const target =
    input.version !== undefined
      ? history.find((entry) => {
          const iso = new Date(Number(entry.blockTimestampNs.slice(0, 13))).toISOString();
          return (
            String(entry.blockHeight) === input.version || iso.startsWith(input.version as string)
          );
        })
      : input.previous
        ? history[1]
        : undefined;

  if (!target) {
    return {
      status: "error",
      registryUrl: "",
      history: historyEntries,
      error: input.version
        ? `No history entry matches "${input.version}" — pick a block height from the listing`
        : "Specify --version <block-height> or --previous (interactive selection happens CLI-side)",
    };
  }

  const liveValue = await fetchLiveConfig({ account, domain, registry: input.registry });
  if (liveValue !== undefined && isSnapshotLive(target.value, liveValue)) {
    return {
      status: "error",
      registryUrl: "",
      error: "The selected snapshot is identical to the live config — nothing to do",
    };
  }

  const verification = await verifyRollbackSnapshot(target.value as BosConfigInput);
  const slotChecks = verification.slots.map((check) => ({
    slot: check.slot,
    ok: check.ok,
    ...(check.reason ? { reason: check.reason } : {}),
  }));
  if (!verification.ok && verification.verifiable) {
    return {
      status: "error",
      registryUrl: "",
      verification: slotChecks,
      error: "Refusing to roll back — a pinned slot's bytes are gone or no longer match their SRI",
    };
  }

  if (!verification.verifiable && !input.force) {
    return {
      status: "error",
      registryUrl: "",
      error:
        "Snapshot predates version manifests and cannot be verified — its bytes were overwritten in place. Re-run with --force to publish it anyway.",
    };
  }

  const rollback = await publishRollbackSnapshot(
    target.value,
    {
      account,
      domain,
      env: input.env,
      runtimeConfig: session.runtime,
      configDir: session.root,
      registry: input.registry,
      network: input.network,
      privateKey: input.privateKey,
      wallet: input.wallet,
      verbose: input.verbose,
      dryRun: input.dryRun,
    },
    { skipVerify: true },
  );
  if (!rollback.ok) {
    return {
      status: "error",
      registryUrl: rollback.registryUrl,
      history: historyEntries,
      error: rollback.error,
    };
  }

  return {
    status: rollback.dryRun ? "dry-run" : "published",
    registryUrl: rollback.registryUrl,
    txHash: rollback.txHash,
    history: historyEntries,
    ...(slotChecks.length > 0 ? { verification: slotChecks } : {}),
  };
}

async function deployBody(
  train: { publish: (input: DeployTrainInput) => Effect.Effect<PublishTrainOk, PublishTrainError> },
  session: { config: BosConfig; runtime: RuntimeConfig | null; root: string },
  input: {
    registry?: string;
    statusList: boolean;
    env: "production" | "staging";
    build: boolean;
    dryRun: boolean;
    verbose: boolean;
    packages: string;
    network?: "mainnet" | "testnet";
    privateKey?: string;
    service?: string;
    imageDigest?: string;
    fullUpload: boolean;
    smoke: boolean;
  },
): Promise<DeployResult> {
  if (input.statusList) {
    if (!session.config?.account || !session.config.domain) {
      return {
        status: "error",
        registryUrl: "",
        error: "authored config must define account and domain to list deploy manifests",
      };
    }
    try {
      const manifests = await fetchDeployManifests({
        accountId: session.config.account,
        gatewayId: session.config.domain,
        registry: input.registry,
      });
      return {
        status: "list",
        registryUrl: "",
        history: manifests.map((entry) => ({
          key: entry.key,
          blockHeight: entry.blockHeight,
          blockTimestamp: new Date(Number(entry.blockTimestampNs.slice(0, 13))).toISOString(),
          ...((entry.value as { txHash?: string } | undefined)?.txHash
            ? { txHash: (entry.value as { txHash?: string }).txHash }
            : {}),
          ...((entry.value as { publishedAt?: string } | undefined)?.publishedAt
            ? { publishedAt: (entry.value as { publishedAt?: string }).publishedAt }
            : {}),
        })),
      };
    } catch (error) {
      return {
        status: "error",
        registryUrl: "",
        error: `Failed to list deploy manifests: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const imageDigestInput = input.imageDigest ?? process.env.BOS_IMAGE_DIGEST;
  if (imageDigestInput && !isValidImageDigest(imageDigestInput)) {
    return {
      status: "error",
      registryUrl: "",
      error: `Invalid image digest "${imageDigestInput}" — expected sha256:<64 hex characters> (--image-digest / BOS_IMAGE_DIGEST)`,
    };
  }

  const result = await runTrain(train, {
    bosConfig: session.config,
    runtimeConfig: session.runtime,
    configDir: session.root,
    env: input.env,
    build: input.build,
    dryRun: input.dryRun,
    verbose: input.verbose,
    packages: input.packages,
    network: input.network,
    privateKey: input.privateKey,
    registry: input.registry,
    fullUpload: input.fullUpload,
  });

  if (result.status === "error") {
    return {
      status: "error",
      registryUrl: result.registryUrl,
      txHash: result.txHash,
      built: result.built,
      skipped: result.skipped,
      error: result.error,
      deployResults: result.deployResults,
    };
  }

  if (result.status === "dry-run") {
    return {
      status: "dry-run",
      registryUrl: result.registryUrl,
      built: result.built,
      skipped: result.skipped,
    };
  }

  let nextSession: { config: BosConfig | null; runtime: RuntimeConfig | null; root: string } = {
    config: session.config,
    runtime: session.runtime,
    root: session.root,
  };
  if (result.publishConfig) {
    const opened = await openResolution({ cwd: session.root });
    if (opened) {
      nextSession = { config: opened.config, runtime: opened.runtime, root: opened.root };
    }
  }

  const configPublished = {
    registryUrl: result.registryUrl,
    txHash: result.txHash,
    fingerprint: result.fingerprint,
    slotPins: result.slotPins,
    built: result.built,
    skipped: result.skipped,
    deployResults: result.deployResults,
  } as const;

  const legsOutcome = await runPostPublishLegs({
    sessionRoot: session.root,
    env: input.env,
    smoke: input.smoke,
    imageDigestInput,
    railwayService: input.service ?? nextSession.config?.ci?.railway?.service,
    registry: input.registry,
    network: input.network,
    privateKey: input.privateKey,
    verbose: input.verbose,
    account: nextSession.config?.account,
    domain: nextSession.config?.domain,
    runtimeConfig: nextSession.runtime,
    ciImage: nextSession.config?.ci?.image,
    repository: nextSession.config?.repository,
  });

  if (legsOutcome.failure) {
    return {
      status: "published",
      ...configPublished,
      image: legsOutcome.image,
      service: legsOutcome.service,
      legs: legsOutcome.legs,
      error: legsOutcome.failure,
    };
  }

  return {
    status: "deployed",
    ...configPublished,
    image: legsOutcome.image,
    service: legsOutcome.service,
    legs: legsOutcome.legs,
  };
}
