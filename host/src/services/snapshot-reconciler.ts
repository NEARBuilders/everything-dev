import { Context, Effect, Layer } from "effect";
import { parseRuntimeRef, registryClientShape, runtimeRefOf } from "everything-dev/registry";
import type { BosConfig } from "everything-dev/types";
import { logger } from "../utils/logger";
import { ConfigService } from "./config";
import { InstanceReplacement } from "./instance-replacement";
import { deploymentDigest } from "./runtime-snapshot";
import {
  persistBootSnapshot,
  SnapshotCoordinator,
  verifyPublishedPointer,
} from "./snapshot-coordinator";
import { describeCauseChain, watchIntervalMs } from "./snapshot-watch";

export type ReconcileOutcome =
  | { status: "idle" }
  | { status: "committed"; held: readonly string[]; digest: string }
  | { status: "deferred"; held: readonly string[]; reason: string };

/**
 * The reconciler's opt-in switch (issue #941): the in-instance consumer of
 * the `pendingRestart` ledger. Off by default — a host that terminates
 * itself needs a supervisor that replaces exited instances (the container
 * restart policy, systemd, or a hosting adapter's blue/green layer), so the
 * operator asks for it: `BOS_RECONCILE_HELD_GENERATIONS=1`.
 */
export const reconcileHeldGenerations = (): boolean =>
  process.env.BOS_RECONCILE_HELD_GENERATIONS === "1";

export interface ReconcileTickDeps {
  /** The coherence guard's ledger — the boot-frozen remotes of the last held
   * adoption, empty when nothing is owed. */
  ledger: () => Promise<readonly string[]>;
  clearLedger: () => Promise<void>;
  /** The published pointer, fetched fresh per tick (the watch's seam). */
  fetchPointer: () => Promise<BosConfig | null>;
  /** Verify the candidate generation without adopting it — the derive
   * pipeline plus the chain walk. Resolves to the verified pointer's
   * resolved form and the target digest. */
  verifyGeneration: (pointer: BosConfig) => Promise<{ resolved: BosConfig; digest: string }>;
  /** The ADR 0041 writer seam: stamp the verified generation as the approved
   * snapshot, so the replacement boots the moved pin even when the registry
   * is unreachable mid-window. Non-fatal. */
  persistApprovedSnapshot: (resolved: BosConfig) => Promise<void>;
  /** Commit the replacement (the default adapter terminates the instance). */
  replaceInstance: (held: readonly string[]) => Promise<void>;
}

/**
 * One reconcile tick: a non-empty ledger → fetch the published pointer →
 * verify the candidate generation → persist it as the approved snapshot →
 * commit the replacement → clear the ledger. Every failure defers (the
 * coherent old pair keeps serving and the next tick retries); only a
 * committed replacement clears the ledger. Never fails — outcomes carry the
 * failure, so the loop fiber cannot die on a bad tick.
 */
export const runReconcileTick = (deps: ReconcileTickDeps): Effect.Effect<ReconcileOutcome> =>
  Effect.gen(function* () {
    const held = yield* Effect.tryPromise(() => deps.ledger()).pipe(
      Effect.match({
        onSuccess: (value) => value,
        onFailure: (cause) => {
          logger.error(
            `[SnapshotReconciler] reading the pendingRestart ledger failed: ${describeCauseChain(cause)}`,
          );
          return undefined;
        },
      }),
    );
    if (!held || held.length === 0) return { status: "idle" };

    const pointer = yield* Effect.tryPromise(() => deps.fetchPointer()).pipe(
      Effect.match({
        onSuccess: (value) => value,
        onFailure: (cause) => {
          logger.warn(`[SnapshotReconciler] pointer fetch failed: ${describeCauseChain(cause)}`);
          return null;
        },
      }),
    );
    if (!pointer) {
      return { status: "deferred", held, reason: "the published pointer is unreachable" };
    }

    const verified = yield* Effect.tryPromise(() => deps.verifyGeneration(pointer)).pipe(
      Effect.match({
        onSuccess: (value) => value,
        onFailure: (cause) => {
          logger.warn(
            `[SnapshotReconciler] the published generation failed verification — keeping the serving generation: ${describeCauseChain(cause)}`,
          );
          return null;
        },
      }),
    );
    if (!verified) {
      return { status: "deferred", held, reason: "the published generation failed verification" };
    }

    yield* Effect.tryPromise(() => deps.persistApprovedSnapshot(verified.resolved)).pipe(
      Effect.catch((cause) =>
        Effect.sync(() =>
          logger.warn(
            `[SnapshotReconciler] approved-snapshot persist failed (non-fatal): ${describeCauseChain(cause)}`,
          ),
        ),
      ),
    );

    const replaced = yield* Effect.tryPromise(() => deps.replaceInstance(held)).pipe(
      Effect.match({
        onSuccess: () => true,
        onFailure: (cause) => {
          logger.error(
            `[SnapshotReconciler] the replacement could not be committed — a restart is still owed: ${describeCauseChain(cause)}`,
          );
          return false;
        },
      }),
    );
    if (!replaced) {
      return { status: "deferred", held, reason: "the replacement could not be committed" };
    }

    yield* Effect.tryPromise(() => deps.clearLedger()).pipe(
      Effect.catch((cause) =>
        Effect.sync(() =>
          logger.warn(
            `[SnapshotReconciler] clearing the pendingRestart ledger failed: ${describeCauseChain(cause)}`,
          ),
        ),
      ),
    );
    logger.info(
      `[SnapshotReconciler] replacement committed — the replacement boots ${verified.digest} whole (UI and backends together)`,
    );
    return { status: "committed", held, digest: verified.digest };
  });

/**
 * The pendingRestart consumer (issue #941): when the coherence guard
 * (`BOS_HOLD_ON_BACKEND_CHANGE`) holds an adoption, the boot-frozen pins and
 * the UI must move as ONE unit, and the only unit that moves whole is a new
 * instance — the replacement boots the published pointer from the registry,
 * or from the ADR 0041 approved snapshot when the registry is unreachable
 * mid-window. The tick loop polls the ledger on the watch's cadence; the
 * default replacement adapter terminates the instance and the supervisor's
 * restart policy provides the replacement. Opt-in
 * (`BOS_RECONCILE_HELD_GENERATIONS=1`), production-only, and never armed
 * without a published pointer to watch.
 */
export class SnapshotReconciler extends Context.Service<
  SnapshotReconciler,
  {
    readonly tick: Effect.Effect<ReconcileOutcome>;
    readonly lastOutcome: ReconcileOutcome | undefined;
  }
>()("host/SnapshotReconciler") {
  static readonly layer = (intervalMs = watchIntervalMs()) =>
    Layer.effect(
      SnapshotReconciler,
      Effect.gen(function* () {
        const coordinator = yield* SnapshotCoordinator;
        const config = yield* ConfigService;
        const replacement = yield* InstanceReplacement;
        const effectContext = yield* Effect.context();

        let lastOutcome: ReconcileOutcome | undefined;
        const watchTarget = config.domain ? `bos://${config.account}/${config.domain}` : undefined;

        const tick = Effect.gen(function* () {
          const outcome = yield* runReconcileTick({
            ledger: () => Effect.runPromiseWith(effectContext)(coordinator.pendingRestart),
            clearLedger: () =>
              Effect.runPromiseWith(effectContext)(coordinator.clearPendingRestart),
            fetchPointer: () =>
              watchTarget
                ? registryClientShape
                    .readOrNull<BosConfig>({
                      kind: "runtimeConfig",
                      ref: runtimeRefOf(parseRuntimeRef(watchTarget)),
                    })
                    .catch(() => null)
                : Promise.resolve(null),
            verifyGeneration: (pointer) =>
              Effect.runPromiseWith(effectContext)(
                verifyPublishedPointer({ publishedConfig: pointer }).pipe(
                  Effect.map(({ resolved, config: derived }) => ({
                    resolved,
                    digest: deploymentDigest(derived),
                  })),
                ),
              ),
            persistApprovedSnapshot: (resolved) =>
              Effect.runPromiseWith(effectContext)(persistBootSnapshot(resolved)),
            replaceInstance: (held) =>
              Effect.runPromiseWith(effectContext)(replacement.replace(held)),
          });
          lastOutcome = outcome;
          return outcome;
        });

        const disarmed = SnapshotReconciler.of({
          tick,
          get lastOutcome() {
            return lastOutcome;
          },
        });

        if (config.env !== "production" || !watchTarget || intervalMs === 0) {
          logger.info(
            "[SnapshotReconciler] disabled — it reconciles published generations, and there is none to watch (dev boot, no domain, or the watch is off)",
          );
          return disarmed;
        }
        if (!reconcileHeldGenerations()) {
          logger.info(
            "[SnapshotReconciler] disabled — opt in with BOS_RECONCILE_HELD_GENERATIONS=1 (the supervisor must replace exited instances)",
          );
          return disarmed;
        }

        logger.info(
          `[SnapshotReconciler] armed — a held generation commits an instance replacement, checked every ${intervalMs / 1000}s`,
        );
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            while (true) {
              yield* Effect.sleep(intervalMs);
              yield* tick;
            }
          }),
        );
        return disarmed;
      }),
    );
}
