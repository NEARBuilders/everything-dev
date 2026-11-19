import { Context, Effect, Layer, Ref, Schema, Semaphore } from "effect";
import {
  BosConfigSchema,
  buildRuntimeConfigEffect,
  resolveConfigComposableEntries,
} from "everything-dev/config";
import { remoteDigests } from "everything-dev/digest";
import { resolveMergedConfigInput } from "everything-dev/resolution";
import { bootSnapshotOf, writeBootSnapshot } from "everything-dev/snapshot";
import type { BosConfig, BosConfigInput } from "everything-dev/types";
import { formatChainFailures, verifyChain } from "everything-dev/verify";
import { logger } from "../utils/logger";
import { createRuntimeSnapshotState, deploymentDigest, RuntimeSnapshot } from "./runtime-snapshot";
import { composeUi } from "./ui-compose";

export class SnapshotAdoptError extends Schema.TaggedError<SnapshotAdoptError>()(
  "SnapshotAdoptError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type SnapshotAdoptOutcome =
  | { status: "swapped"; deploymentDigest: string; digest?: string }
  | { status: "unchanged" }
  | { status: "held"; pendingRestart: string[] };

/**
 * Hosted coherence guard (fly-hosting 14): `BOS_HOLD_ON_BACKEND_CHANGE=1` —
 * set by the hosting adapter's descriptor, default OFF so single-box/
 * self-hosted behavior is unchanged — refuses to swap the serving snapshot
 * while boot-frozen pins (api, auth, plugin backends) moved, because the swap
 * cannot reload them. The generation then moves as a unit: the old instance
 * keeps serving a coherent old UI+API pair until the reconciler (reading
 * `pendingRestart` on /health and /.well-known/version) replaces it, and the
 * replacement boots both together. Read at adopt time so tests can stub it.
 */
export const holdOnBackendChange = (): boolean => process.env.BOS_HOLD_ON_BACKEND_CHANGE === "1";

const describeCause = (cause: unknown): string =>
  cause instanceof Error
    ? (cause.cause as Error | undefined) instanceof Error
      ? ((cause.cause as Error).message as string)
      : cause.message
    : String(cause);

const adoptFailure = (message: string, cause: unknown) =>
  new SnapshotAdoptError({ message: `${message}: ${describeCause(cause)}`, cause });

/**
 * Boot-frozen slots whose pins the newly adopted pointer moved (#826
 * follow-up): the swap adopts UI/SSR/compose surfaces only, so a moved
 * api/auth/plugin-backend pin keeps the previous generation serving until a
 * restart — surfaced at /.well-known/version and /health instead of
 * silently running stale. Comparison is against the previously adopted
 * pointer; a first adopt after boot has no baseline and reports nothing.
 */
const bootFrozenRestartRemotes = (
  previous: Record<string, unknown> | undefined,
  next: BosConfig,
): string[] => {
  if (!previous) return [];
  const before = remoteDigests(previous as never);
  const after = remoteDigests(next as never);
  return Object.keys(before)
    .concat(Object.keys(after))
    .filter((remote, index, all) => all.indexOf(remote) === index)
    .filter(
      (remote) =>
        /^(app\.(api|auth|host)|plugins\.[^.]+)$/.test(remote) && before[remote] !== after[remote],
    )
    .sort();
};

/**
 * Persist the approved snapshot (ADR 0041): one writer seam — every verified
 * generation is stamped to disk so a restart can serve it during a
 * registry/CDN outage. Non-fatal: a snapshot-write failure must never fail
 * the adopt.
 */
const persistBootSnapshot = (resolvedPointer: BosConfig) =>
  Effect.tryPromise(async () => {
    if (!resolvedPointer.domain) {
      throw new Error(`resolved pointer for ${resolvedPointer.account} has no domain`);
    }
    await writeBootSnapshot(
      bootSnapshotOf({
        account: resolvedPointer.account,
        gateway: resolvedPointer.domain,
        config: resolvedPointer,
      }),
    );
  }).pipe(
    Effect.catch((cause) =>
      Effect.sync(() =>
        logger.warn(
          `[SnapshotCoordinator] approved-snapshot persist failed (non-fatal): ${describeCause(cause)}`,
        ),
      ),
    ),
  );

/**
 * A published pointer stores only the runtime's own overrides — remotes it
 * inherits from its parent via `extends` (notably `app.host`) are absent.
 * Derive the adoptable config through the same extends-walking pipeline the
 * boot path uses (tenant-runtime): building a runtime config straight from
 * the raw pointer crashes on the first inherited remote. A pointer without a
 * domain has no bos:// ref to resolve — fail rather than guess one; failure
 * of any kind leaves the live snapshot untouched.
 */
const resolvePointerConfig = async (
  publishedConfig: BosConfig,
  baseDir: string,
): Promise<BosConfig> => {
  if (!publishedConfig.domain) {
    throw new Error(`published pointer for ${publishedConfig.account} has no domain`);
  }
  const merged = await resolveMergedConfigInput(
    `bos://${publishedConfig.account}/${publishedConfig.domain}`,
    { env: "production", seedConfig: publishedConfig as BosConfigInput },
  );
  return resolveConfigComposableEntries(BosConfigSchema.parse(merged), baseDir, "production");
};

/**
 * The swap transaction (atomic-deploys 07): derive the published pointer into
 * a runtime config (version manifests fetched + SRI-verified), pre-warm the
 * NEXT state's own compose cache (validating compose + digest parity), then
 * atomically swap the snapshot — caches included, so the pre-warmed state IS
 * the serving state (C7). Any failure leaves the live snapshot untouched —
 * the previously published version keeps serving.
 *
 * Order constraints (MAP): the pointer-derived config is resolved FIRST
 * (SSR entry URLs derive from it); composeUi validates the digest the client
 * payload will carry; the swap is a single atomic Ref write. Old-snapshot
 * in-flight requests keep composing against their own entry URLs through the
 * shared composition instance (the same per-request re-registration steady
 * state tenant overrides already exercise).
 *
 * API plugins and auth are boot-frozen (MAP decision 3): the derived config
 * still carries them, but they are not reloaded — the swap adopts UI/SSR/
 * compose surfaces only. Under `BOS_HOLD_ON_BACKEND_CHANGE=1` (fly-hosting
 * 14) an adopt whose pointer moved a boot-frozen pin refuses to swap at all —
 * a new UI must not pair with the old API — and reports the held remotes as
 * `pendingRestart` instead; the reconciler replaces the instance, which boots
 * the whole generation together.
 */
const adoptTransaction = Effect.fn("SnapshotCoordinator.adoptTransaction")(function* (input: {
  snapshot: RuntimeSnapshot["Service"];
  publishedConfig: BosConfig;
  baseDir?: string;
  pendingRestart?: Ref.Ref<readonly string[]>;
}): Effect.fn.Return<
  Extract<SnapshotAdoptOutcome, { status: "swapped" | "unchanged" | "held" }>,
  SnapshotAdoptError
> {
  const { snapshot, publishedConfig } = input;
  const baseDir = input.baseDir ?? process.cwd();

  const resolvedPointer = yield* Effect.tryPromise(() =>
    resolvePointerConfig(publishedConfig, baseDir),
  ).pipe(Effect.catch((cause) => adoptFailure("deriving the published pointer failed", cause)));

  const nextConfig = yield* buildRuntimeConfigEffect(resolvedPointer, baseDir, "production").pipe(
    Effect.catch((cause) => adoptFailure("deriving the published pointer failed", cause)),
  );

  const current = yield* snapshot.get;
  const nextDigest = deploymentDigest(nextConfig);
  if (nextDigest === current.deploymentDigest) {
    yield* recordPendingRestart(input.pendingRestart, []);
    yield* persistBootSnapshot(resolvedPointer);
    return { status: "unchanged" };
  }

  const restartRemotes = bootFrozenRestartRemotes(current.pointer, publishedConfig);
  if (restartRemotes.length > 0 && holdOnBackendChange()) {
    yield* recordPendingRestart(input.pendingRestart, restartRemotes);
    logger.warn(
      `[SnapshotCoordinator] adoption held — boot-frozen slots moved pin (${restartRemotes.join(", ")}) and the swap cannot reload them; serving the current generation until restart`,
    );
    return { status: "held", pendingRestart: restartRemotes };
  }

  const nextState = createRuntimeSnapshotState({
    deploymentDigest: nextDigest,
    config: nextConfig,
    pointer: publishedConfig,
    restartRequired: restartRemotes,
  });
  const composed = yield* composeUi(nextConfig, nextState.composeState).pipe(
    Effect.catch((cause) => adoptFailure("pre-warm compose failed", cause)),
  );

  const chain = yield* Effect.tryPromise(() =>
    verifyChain({
      config: resolvedPointer as unknown as BosConfigInput,
      depth: "entries",
    }),
  ).pipe(
    Effect.catch((cause) =>
      adoptFailure("the candidate composition failed chain verification", cause),
    ),
  );
  if (!chain.ok) {
    return yield* adoptFailure(
      "the candidate composition failed chain verification",
      new Error(formatChainFailures(chain)),
    );
  }

  nextConfig.deploymentDigest = nextDigest;
  yield* recordPendingRestart(input.pendingRestart, []);
  yield* snapshot.swap(nextState);
  yield* persistBootSnapshot(resolvedPointer);
  return { status: "swapped", deploymentDigest: nextDigest, digest: composed.digest };
});

/** The held-generation ledger mirrors the last adopt decision: the refused
 * boot-frozen remotes on a hold, empty once a later adopt swaps or converges
 * (the published backends then match what is serving). */
const recordPendingRestart = (
  ref: Ref.Ref<readonly string[]> | undefined,
  remotes: readonly string[],
) => (ref ? Ref.set(ref, remotes) : Effect.void);

/** Concurrent adopts serialize: two pre-warms racing would both swap (last
 * writer wins) and double the transient SSR re-registration flapping. */
const adoptPermits = Semaphore.makeUnsafe(1);

/** The adopt transaction is wrapped by `adoptPermits`; the adopted config's
 * `deploymentDigest` is stamped before the swap so the client config —
 * and the soft-refresh signal — carries it (atomic-deploys 10). */
export const adoptPublishedPointer = Effect.fn("SnapshotCoordinator.adopt")(function* (input: {
  snapshot: RuntimeSnapshot["Service"];
  publishedConfig: BosConfig;
  baseDir?: string;
  pendingRestart?: Ref.Ref<readonly string[]>;
}): Effect.fn.Return<
  Extract<SnapshotAdoptOutcome, { status: "swapped" | "unchanged" | "held" }>,
  SnapshotAdoptError
> {
  return yield* adoptPermits.withPermits(1)(adoptTransaction(input));
});

/**
 * Service seam over the transaction: resolves the published pointer against
 * the snapshot (the watch fiber's tick and admin re-adopts call this).
 * `pendingRestart` is the coherence guard's ledger — the boot-frozen remotes
 * of the last held adoption, read by /health and /.well-known/version so the
 * reconciler knows a restart is owed (fly-hosting 14).
 */
export class SnapshotCoordinator extends Context.Service<
  SnapshotCoordinator,
  {
    readonly adopt: (
      publishedConfig: BosConfig,
    ) => Effect.Effect<
      Extract<SnapshotAdoptOutcome, { status: "swapped" | "unchanged" | "held" }>,
      SnapshotAdoptError
    >;
    readonly pendingRestart: Effect.Effect<readonly string[]>;
  }
>()("host/SnapshotCoordinator") {
  static readonly layer = Layer.effect(
    SnapshotCoordinator,
    Effect.gen(function* () {
      const snapshot = yield* RuntimeSnapshot;
      const pendingRestartRef = yield* Ref.make<readonly string[]>([]);
      return SnapshotCoordinator.of({
        adopt: (publishedConfig) =>
          adoptPublishedPointer({
            snapshot,
            publishedConfig,
            baseDir: process.cwd(),
            pendingRestart: pendingRestartRef,
          }),
        pendingRestart: Ref.get(pendingRestartRef),
      });
    }),
  );
}
