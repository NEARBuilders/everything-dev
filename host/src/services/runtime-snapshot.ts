import { createHash } from "node:crypto";
import { Context, Effect, Layer, Ref } from "effect";
import type { RuntimeConfig } from "everything-dev/types";
import { ConfigService } from "./config";
import { type ClientConfigCacheState, createClientConfigCacheState } from "./serving-caches";
import { createUiComposeCacheState, type UiComposeCacheState } from "./ui-compose";

export interface RuntimeSnapshotState {
  /** hash over the load-bearing slot coordinates — changes on every adopted deploy */
  fingerprint: string;
  config: RuntimeConfig;
  /** the adopted published pointer — set by the coordinator on every swap;
   * absent at boot (the fingerprint is the identity until the first adopt) */
  pointer?: Record<string, unknown>;
  /** THE serving compose cache: requests compose through the state they
   * captured, so the pre-warmed state the coordinator installs IS the serving
   * state — no re-compose on adopt, and a swap under traffic flips readers
   * atomically (one `get` captures config + caches together). */
  composeState: UiComposeCacheState;
  /** the client-config cache rides the same lifecycle: entries are keyed by
   * compose digest but NOT by deployment URLs, so a cross-generation entry
   * could carry stale entry URLs — a fresh cache per generation makes the
   * flip safe by construction */
  clientConfigState: ClientConfigCacheState;
  /** Releases the abandoned generation: clears its serving caches so old
   * compose graphs and manifests drop once in-flight requests finish. Run by
   * the snapshot's swap on the state it replaces — the explicit-disposal seam
   * the ESM-graph question (v2-platform-services/09) hangs on. */
  readonly release: Effect.Effect<void>;
}

/**
 * The one factory for snapshot states: mints fresh serving caches (or adopts
 * pre-existing ones — integration fixtures) and attaches the release that the
 * swap runs on the state it replaces. The Ref only ever receives complete,
 * pre-warmed states built here.
 */
export function createRuntimeSnapshotState(input: {
  fingerprint: string;
  config: RuntimeConfig;
  pointer?: Record<string, unknown>;
  composeState?: UiComposeCacheState;
  clientConfigState?: ClientConfigCacheState;
}): RuntimeSnapshotState {
  const composeState = input.composeState ?? createUiComposeCacheState();
  const clientConfigState = input.clientConfigState ?? createClientConfigCacheState();
  return {
    fingerprint: input.fingerprint,
    config: input.config,
    pointer: input.pointer,
    composeState,
    clientConfigState,
    release: Effect.sync(() => {
      composeState.remoteManifests.clear();
      composeState.variants.clear();
      clientConfigState.entries.clear();
    }),
  };
}

/**
 * The swappable base state of the host's UI/SSR surfaces (atomic-deploys 06)
 * — and the single owner of the serving caches (C7). An atomic Ref: requests
 * that already captured a state keep serving it while new requests see the
 * swapped one — session-level blue/green without any draining machinery
 * (shadow-flip). A swap releases the previous state's caches, so repeated
 * adopts never accumulate old generations. API plugins and auth stay
 * boot-frozen by design (MAP decision 3); the fingerprint deliberately
 * includes their coordinates anyway — a published pointer that changed them
 * is change-detection signal for the watch fiber, even though a swap cannot
 * adopt them.
 */
export class RuntimeSnapshot extends Context.Service<
  RuntimeSnapshot,
  {
    readonly get: Effect.Effect<RuntimeSnapshotState>;
    /** Atomically install the next state and release the one it replaces. The
     * fallible transaction that produces it (derive → pre-warm → verify)
     * lives in the coordinator — the Ref only ever receives complete,
     * pre-warmed states. */
    readonly swap: (next: RuntimeSnapshotState) => Effect.Effect<void>;
  }
>()("host/RuntimeSnapshot") {
  static readonly layer = (options?: {
    composeState?: UiComposeCacheState;
    clientConfigState?: ClientConfigCacheState;
  }) =>
    Layer.effect(
      RuntimeSnapshot,
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const ref = yield* Ref.make<RuntimeSnapshotState>(
          createRuntimeSnapshotState({
            fingerprint: deploymentFingerprint(config),
            config,
            ...(options?.composeState ? { composeState: options.composeState } : {}),
            ...(options?.clientConfigState ? { clientConfigState: options.clientConfigState } : {}),
          }),
        );
        return RuntimeSnapshot.of({
          get: Ref.get(ref),
          swap: (next) =>
            Effect.gen(function* () {
              const previous = yield* Ref.getAndUpdate(ref, () => next);
              if (previous !== next) yield* previous.release;
            }),
        });
      }),
    );
}

/**
 * Deployment fingerprint: a stable hash over every load-bearing slot
 * coordinate (entryUrl + integrity per slot) — a new published deploy mints a
 * new fingerprint even when the composed digest is unchanged.
 */
export function deploymentFingerprint(config: RuntimeConfig): string {
  const parts: Array<string> = [];
  const slot = (
    prefix: string,
    s: { entryUrl?: string; integrity?: string; ssrIntegrity?: string } | undefined,
  ) => {
    if (!s) return;
    parts.push(`${prefix}:${s.entryUrl ?? ""}:${s.integrity ?? ""}:${s.ssrIntegrity ?? ""}`);
  };
  slot("ui", config.ui);
  slot("api", config.api);
  slot("auth", config.auth);
  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    slot(`plugin.${key}`, plugin);
    slot(`plugin.${key}.ui`, plugin.ui);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
