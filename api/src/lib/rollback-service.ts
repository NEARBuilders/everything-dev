import { Context, Data, Effect, Layer } from "effect";
import { type SigningStrategy, submitRegistryWrite } from "everything-dev/auth/near-signer";
import {
  buildRollbackPayload,
  type RollbackVerification,
  verifyRollbackSnapshot,
} from "everything-dev/deploy/rollback";
import type { HistoryFetch } from "./deploy-history";
import {
  auditManifestKeyPrefix,
  fetchHistoryJson,
  historyPrefixBody,
  historyUrlForKey,
  historyUrlForPrefix,
  networkIdForAccount,
  normalizeHistoryEntries,
  parseAuditManifest,
  type RegistryHistoryEntry,
  registryConfigKey,
  registryNamespaceForAccount,
} from "./deploy-history";

export class RollbackReadError extends Data.TaggedError("RollbackReadError")<{
  message: string;
  cause?: unknown;
}> {}

export interface RollbackSlotCheck {
  slot: string;
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
      readonly verification?: RollbackSlotCheck[];
    };

export interface RollbackIdentity {
  readonly account: string;
  readonly gateway: string;
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
  }) => Effect.Effect<unknown | undefined, RollbackReadError>;
  readonly fetchManifestRegistryUrl: (input: {
    account: string;
    gateway: string;
    blockHeight: number;
  }) => Effect.Effect<string | undefined, RollbackReadError>;
  readonly verifySnapshot: (config: unknown) => Effect.Effect<RollbackVerification>;
  readonly submit: (input: {
    account: string;
    gateway: string;
    network: "mainnet" | "testnet";
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

      const entries = yield* deps
        .fetchConfigEntries({
          account: input.account,
          gateway: input.gateway,
          limit: ROLLBACK_HISTORY_LIMIT,
        })
        .pipe(Effect.catch((error) => Effect.succeed(refusedRead(describeCause(error)))));
      if (!Array.isArray(entries)) return entries;
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

      const verification = yield* deps.verifySnapshot(target.value);
      if (!verification.ok && verification.verifiable) {
        return {
          status: "refused" as const,
          reason:
            "Refusing to roll back — a pinned slot's bytes are gone or no longer match their SRI",
          verification: verification.slots.map((check) => ({
            slot: check.slot,
            ok: check.ok,
            ...(check.reason ? { reason: check.reason } : {}),
          })),
        };
      }
      if (!verification.verifiable) {
        return {
          status: "refused" as const,
          reason:
            "Snapshot predates version manifests and cannot be verified — its bytes were overwritten in place. Server-side rollback does not force; use the CLI with --force.",
        };
      }

      const publishedAt = now();
      const network = networkIdForAccount(input.account);
      const payload = buildRollbackPayload(
        target.value as Parameters<typeof buildRollbackPayload>[0],
        publishedAt,
      );
      const manifestKey = `apps/${input.account}/${input.gateway}/manifests/${publishedAt.replace(/[:.]/g, "-")}.json`;
      const targetRegistryUrl = yield* deps
        .fetchManifestRegistryUrl({
          account: input.account,
          gateway: input.gateway,
          blockHeight: input.blockHeight,
        })
        .pipe(Effect.orElseSucceed(() => undefined));
      const args = {
        [registryConfigKey(input.account, input.gateway)]: JSON.stringify(payload),
        [manifestKey]: JSON.stringify({
          account: input.account,
          gateway: input.gateway,
          network,
          publishedAt,
          registryUrl: targetRegistryUrl ?? "",
        }),
      };

      const submitted = yield* deps
        .submit({
          account: input.account,
          gateway: input.gateway,
          network,
          args,
        })
        .pipe(Effect.catch((error) => Effect.succeed(refusedRead(describeCause(error)))));
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
      ? ((error as { message: string }).message as string)
      : String(error);

export function buildFastKvRollbackDeps(fetchJson: HistoryFetch, privateKey: string): RollbackDeps {
  const strategy: SigningStrategy = { strategy: "near-kit", privateKey, source: "provided" };
  return {
    fetchConfigEntries: ({ account, gateway, limit }) =>
      Effect.tryPromise({
        try: () =>
          fetchJson(
            historyUrlForKey({ account, keyPath: registryConfigKey(account, gateway), limit }),
          ),
        catch: (cause) => new RollbackReadError({ message: "FastKV history read failed", cause }),
      }).pipe(Effect.map(normalizeHistoryEntries)),
    fetchLiveConfig: ({ account, gateway }) =>
      Effect.tryPromise({
        try: () =>
          fetchJson(
            historyUrlForKey({
              account,
              keyPath: registryConfigKey(account, gateway),
              limit: 1,
            }),
          ),
        catch: (cause) =>
          new RollbackReadError({ message: "FastKV live-config read failed", cause }),
      }).pipe(
        Effect.map(normalizeHistoryEntries),
        Effect.map((entries) => entries[0]?.value),
      ),
    fetchManifestRegistryUrl: ({ account, gateway, blockHeight }) =>
      Effect.tryPromise({
        try: () =>
          fetchJson(
            historyUrlForPrefix({
              account,
              keyPrefix: auditManifestKeyPrefix(account, gateway),
              limit: ROLLBACK_HISTORY_LIMIT,
            }),
            {
              method: "POST",
              body: JSON.stringify(
                historyPrefixBody({
                  keyPrefix: auditManifestKeyPrefix(account, gateway),
                  limit: ROLLBACK_HISTORY_LIMIT,
                }),
              ),
            },
          ),
        catch: (cause) =>
          new RollbackReadError({ message: "FastKV manifest history read failed", cause }),
      }).pipe(
        Effect.map(normalizeHistoryEntries),
        Effect.map((entries) => {
          const row = entries.find((entry) => entry.blockHeight === blockHeight);
          const parsed = row ? parseAuditManifest(row.value) : null;
          return parsed?.registryUrl;
        }),
      ),
    verifySnapshot: (config) => Effect.promise(() => verifyRollbackSnapshot(config as never)),
    submit: ({ account, network, args }) =>
      Effect.tryPromise({
        try: () =>
          submitRegistryWrite(
            {
              account,
              contract: registryNamespaceForAccount(account),
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
    RollbackService.of(
      buildRollbackService(
        buildFastKvRollbackDeps((url, init) => fetchHistoryJson(url, init), privateKey),
        identity,
      ),
    ),
  );
};
