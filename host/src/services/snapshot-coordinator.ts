import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { buildRuntimeConfigEffect } from "everything-dev/config";
import { verifySriForUrl } from "everything-dev/integrity";
import type { BosConfig } from "everything-dev/types";
import {
  createRuntimeSnapshotState,
  deploymentFingerprint,
  RuntimeSnapshot,
} from "./runtime-snapshot";
import { composeUi } from "./ui-compose";

export class SnapshotAdoptError extends Schema.TaggedError<SnapshotAdoptError>()(
  "SnapshotAdoptError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type SnapshotAdoptOutcome =
  | { status: "swapped"; fingerprint: string; digest?: string }
  | { status: "unchanged" };

const describeCause = (cause: unknown): string =>
  cause instanceof Error
    ? (cause.cause as Error | undefined) instanceof Error
      ? ((cause.cause as Error).message as string)
      : cause.message
    : String(cause);

const adoptFailure = (message: string, cause: unknown) =>
  new SnapshotAdoptError({ message: `${message}: ${describeCause(cause)}`, cause });

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
 * compose surfaces only.
 */
const adoptTransaction = Effect.fn("SnapshotCoordinator.adoptTransaction")(function* (input: {
  snapshot: RuntimeSnapshot["Service"];
  publishedConfig: BosConfig;
  baseDir?: string;
}): Effect.fn.Return<
  Extract<SnapshotAdoptOutcome, { status: "swapped" | "unchanged" }>,
  SnapshotAdoptError
> {
  const { snapshot, publishedConfig } = input;

  const nextConfig = yield* buildRuntimeConfigEffect(
    publishedConfig,
    input.baseDir ?? process.cwd(),
    "production",
  ).pipe(Effect.catch((cause) => adoptFailure("deriving the published pointer failed", cause)));

  const current = yield* snapshot.get;
  const nextFingerprint = deploymentFingerprint(nextConfig);
  if (nextFingerprint === current.fingerprint) {
    return { status: "unchanged" };
  }

  const nextState = createRuntimeSnapshotState({
    fingerprint: nextFingerprint,
    config: nextConfig,
    pointer: publishedConfig,
  });
  const composed = yield* composeUi(nextConfig, nextState.composeState).pipe(
    Effect.catch((cause) => adoptFailure("pre-warm compose failed", cause)),
  );

  const verifyTargets = (
    [
      { url: nextConfig.ui.entryUrl, integrity: nextConfig.ui.integrity },
      nextConfig.ui.ssrEntryUrl
        ? { url: nextConfig.ui.ssrEntryUrl, integrity: nextConfig.ui.ssrIntegrity }
        : null,
    ] satisfies Array<{ url?: string; integrity?: string } | null>
  ).filter((target): target is { url: string; integrity: string } =>
    Boolean(target?.url && target?.integrity),
  );
  for (const target of verifyTargets) {
    yield* Effect.tryPromise(() =>
      verifySriForUrl(target.url, target.integrity, { resolveEntryUrl: false }),
    ).pipe(
      Effect.catch((cause) =>
        adoptFailure(`pinned entry failed verification (${target.url})`, cause),
      ),
    );
  }

  nextConfig.deploymentFingerprint = nextFingerprint;
  yield* snapshot.swap(nextState);
  return { status: "swapped", fingerprint: nextFingerprint, digest: composed.digest };
});

/** Concurrent adopts serialize: two pre-warms racing would both swap (last
 * writer wins) and double the transient SSR re-registration flapping. */
const adoptPermits = Semaphore.makeUnsafe(1);

/** The adopt transaction is wrapped by `adoptPermits`; the adopted config's
 * `deploymentFingerprint` is stamped before the swap so the client config —
 * and the soft-refresh signal — carries it (atomic-deploys 10). */
export const adoptPublishedPointer = Effect.fn("SnapshotCoordinator.adopt")(function* (input: {
  snapshot: RuntimeSnapshot["Service"];
  publishedConfig: BosConfig;
  baseDir?: string;
}): Effect.fn.Return<
  Extract<SnapshotAdoptOutcome, { status: "swapped" | "unchanged" }>,
  SnapshotAdoptError
> {
  return yield* adoptPermits.withPermits(1)(adoptTransaction(input));
});

/**
 * Service seam over the transaction: resolves the published pointer against
 * the snapshot (the watch fiber's tick and admin re-adopts call this).
 */
export class SnapshotCoordinator extends Context.Service<
  SnapshotCoordinator,
  {
    readonly adopt: (
      publishedConfig: BosConfig,
    ) => Effect.Effect<
      Extract<SnapshotAdoptOutcome, { status: "swapped" | "unchanged" }>,
      SnapshotAdoptError
    >;
  }
>()("host/SnapshotCoordinator") {
  static readonly layer = Layer.effect(
    SnapshotCoordinator,
    Effect.gen(function* () {
      const snapshot = yield* RuntimeSnapshot;
      return SnapshotCoordinator.of({
        adopt: (publishedConfig) =>
          adoptPublishedPointer({ snapshot, publishedConfig, baseDir: process.cwd() }),
      });
    }),
  );
}
