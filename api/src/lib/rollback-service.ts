import { Context, Data, Effect, Layer } from "effect";
import { type SigningStrategy, submitRegistryWrite } from "everything-dev/auth/near-signer";
import {
  buildRollbackPayload,
  type RollbackVerification,
  verifyRollbackSnapshot,
} from "everything-dev/deploy/rollback";
import {
  DeployRecordSchema,
  deployRecordTsOf,
  keyPathOf,
  type NetworkId,
  networkIdForAccount,
  type RegistryHistoryEntry,
  registryClientShape,
  runtimeRefOf,
} from "everything-dev/registry";
import {
  buildRegistryConfigUrlForNetwork,
  getRegistryNamespaceForAccount,
} from "everything-dev/registry/fastkv";

export class RollbackReadError extends Data.TaggedError("RollbackReadError")<{
  message: string;
  cause?: unknown;
}> {}

export interface RollbackRemoteCheck {
  remote: string;
  ok: boolean;
  reason?: string;
}

export type RollbackResult =
  | {
      readonly status: "published";
      readonly txHash?: string;
      readonly blockHeight: number;
    }
  | {
      readonly status: "refused";
      readonly reason: string;
      readonly verification?: RollbackRemoteCheck[];
    };

export interface RollbackIdentity {
  readonly account: string;
  readonly gateway: string;
}

interface RollbackVerificationFailure {
  readonly kind: "read-failed";
  readonly error: RollbackReadError;
}

export interface RollbackDeps {
  readonly fetchConfigEntries: (input: {
    account: string;
    gateway: string;
    limit: number;
  }) => Effect.Effect<RegistryHistoryEntry[], RollbackReadError>;
  readonly fetchLiveConfig: (input: {
    account: string;
    gateway: string;
  }) => Effect.Effect<unknown, RollbackReadError>;
  readonly verifySnapshot: (
    config: unknown,
  ) => Effect.Effect<RollbackVerification, RollbackReadError>;
  readonly submit: (input: {
    account: string;
    gateway: string;
    network: NetworkId;
    args: Record<string, string>;
  }) => Effect.Effect<{ txHash?: string }, { message: string }>;
  readonly now?: () => string;
}

const ROLLBACK_HISTORY_LIMIT = 20;

const isSnapshotLive = (targetValue: unknown, liveValue: unknown): boolean =>
  JSON.stringify(liveValue) === JSON.stringify(targetValue);

export function buildRollbackService(
  deps: RollbackDeps,
  identity: RollbackIdentity | undefined,
): {
  rollback: (input: {
    account: string;
    gateway: string;
    blockHeight: number;
  }) => Effect.Effect<RollbackResult>;
} {
  const now = deps.now ?? (() => new Date().toISOString());

  const rollback = (input: { account: string; gateway: string; blockHeight: number }) =>
    Effect.gen(function* () {
      if (!identity) {
        return {
          status: "refused" as const,
          reason:
            "Rollback is not configured on this runtime — set hosting.rollback in the api variables and provide a signing key",
        };
      }
      if (input.account !== identity.account || input.gateway !== identity.gateway) {
        return {
          status: "refused" as const,
          reason: `This runtime's rollback key signs for ${identity.account}/${identity.gateway} only`,
        };
      }

      const entriesOrRefused = yield* deps
        .fetchConfigEntries({
          account: input.account,
          gateway: input.gateway,
          limit: ROLLBACK_HISTORY_LIMIT,
        })
        .pipe(Effect.orElseSucceed((error) => refusedRead(describeCause(error))));
      if (!Array.isArray(entriesOrRefused)) return entriesOrRefused;
      const entries = entriesOrRefused;

      const target = entries.find((entry) => entry.blockHeight === input.blockHeight);
      if (!target) {
        return {
          status: "refused" as const,
          reason: `No published snapshot at block height ${input.blockHeight} — pick a block height from the deploy list`,
        };
      }

      const live = yield* deps
        .fetchLiveConfig({ account: input.account, gateway: input.gateway })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (live !== undefined && isSnapshotLive(target.value, live)) {
        return {
          status: "refused" as const,
          reason: "The selected snapshot is identical to the live config — nothing to do",
        };
      }

      const verification = yield* deps.verifySnapshot(target.value).pipe(
        Effect.orElseSucceed((error): RollbackVerification | RollbackVerificationFailure => ({
          kind: "read-failed",
          error,
        })),
      );
      if ("kind" in verification) {
        return {
          status: "refused" as const,
          reason: `Refusing to roll back — the pinned remotes could not be verified: ${describeCause(verification.error)}`,
        };
      }
      if (!verification.ok && verification.verifiable) {
        return {
          status: "refused" as const,
          reason:
            "Refusing to roll back — a pinned remote's bytes are gone or no longer match their SRI",
          verification: verification.remotes.map((remote) => ({
            remote: remote.remote,
            ok: remote.ok,
            ...(remote.reason ? { reason: remote.reason } : {}),
          })),
        };
      }
      if (!verification.verifiable) {
        return {
          status: "refused" as const,
          reason:
            "Snapshot predates the registry wire cutover and cannot be verified — its bytes were overwritten in place and are deliberately unrestorable (ADR 0040 §4). Server-side rollback does not force; use the CLI with --force.",
        };
      }

      const publishedAt = now();
      const network = networkIdForAccount(input.account);
      const payload = buildRollbackPayload(
        target.value as Parameters<typeof buildRollbackPayload>[0],
        publishedAt,
      );
      const ref = runtimeRefOf({ accountId: input.account, gatewayId: input.gateway });
      const args = {
        [keyPathOf({ kind: "runtimeConfig", ref })]: JSON.stringify(payload),
        [keyPathOf({ kind: "deployRecord", ref, ts: deployRecordTsOf(publishedAt) })]:
          JSON.stringify(
            DeployRecordSchema.parse({
              account: input.account,
              gateway: input.gateway,
              network,
              publishedAt,
              registryUrl: buildRegistryConfigUrlForNetwork(network, input.account, input.gateway),
            }),
          ),
      };

      const submitted = yield* deps
        .submit({ account: input.account, gateway: input.gateway, network, args })
        .pipe(Effect.orElseSucceed((error) => refusedRead(describeCause(error))));
      if ("status" in submitted) return submitted;
      return {
        status: "published" as const,
        txHash: submitted.txHash,
        blockHeight: input.blockHeight,
      };
    });

  return { rollback };
}

const refusedRead = (reason: string): RollbackResult => ({ status: "refused", reason });

const describeCause = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown })?.message === "string"
      ? (error as { message: string }).message
      : String(error);

export function buildFastKvRollbackDeps(privateKey: string): RollbackDeps {
  const strategy: SigningStrategy = { strategy: "near-kit", privateKey, source: "provided" };
  const configRef = (account: string, gateway: string) =>
    runtimeRefOf({ accountId: account, gatewayId: gateway });
  return {
    fetchConfigEntries: ({ account, gateway, limit }) =>
      Effect.tryPromise({
        try: () =>
          registryClientShape.history(
            { kind: "runtimeConfig", ref: configRef(account, gateway) },
            limit,
          ),
        catch: (cause) =>
          new RollbackReadError({ message: "FastKV config history read failed", cause }),
      }),
    fetchLiveConfig: ({ account, gateway }) =>
      Effect.tryPromise({
        try: () =>
          registryClientShape.read<unknown>({
            kind: "runtimeConfig",
            ref: configRef(account, gateway),
          }),
        catch: (cause) =>
          new RollbackReadError({ message: "FastKV live-config read failed", cause }),
      }),
    verifySnapshot: (config) =>
      Effect.tryPromise({
        try: () => verifyRollbackSnapshot(config as Parameters<typeof verifyRollbackSnapshot>[0]),
        catch: (cause) =>
          new RollbackReadError({ message: "Pinned remote verification failed", cause }),
      }),
    submit: ({ account, network, args }) =>
      Effect.tryPromise({
        try: () =>
          submitRegistryWrite(
            {
              account,
              contract: getRegistryNamespaceForAccount(account),
              method: "__fastdata_kv",
              args,
              network,
            },
            strategy,
          ),
        catch: (cause) => ({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      }).pipe(Effect.map((result) => ({ txHash: result.txHash }))),
  };
}

export class RollbackService extends Context.Service<
  RollbackService,
  {
    rollback: (input: {
      account: string;
      gateway: string;
      blockHeight: number;
    }) => Effect.Effect<RollbackResult>;
  }
>()("api/RollbackService") {}

const refuseAlways = (reason: string) =>
  Layer.succeed(
    RollbackService,
    RollbackService.of({
      rollback: () => Effect.succeed({ status: "refused" as const, reason }),
    }),
  );

export const RollbackServiceLive = (
  identity: RollbackIdentity | undefined,
  privateKey?: string,
) => {
  if (!identity) {
    return refuseAlways(
      "Rollback is not configured on this runtime — set hosting.rollback in the api variables",
    );
  }
  if (!privateKey) {
    return refuseAlways(
      "Rollback signing key not configured — set the ROLLBACK_PRIVATE_KEY secret",
    );
  }
  return Layer.succeed(
    RollbackService,
    RollbackService.of(buildRollbackService(buildFastKvRollbackDeps(privateKey), identity)),
  );
};
