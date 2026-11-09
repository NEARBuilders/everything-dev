import { Context, Effect, Layer } from "effect";
import { parseRuntimeRef, registryClientShape, runtimeRefOf } from "everything-dev/registry";

const refOf = (bosUrl: string) => {
  const parsed = parseRuntimeRef(bosUrl);
  return runtimeRefOf({ accountId: parsed.accountId, gatewayId: parsed.gatewayId });
};

import { pointerFingerprint } from "everything-dev/fingerprint";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { asDigest, fetchVerified } from "everything-dev/verify";
import { resolveRemoteVersion } from "everything-dev/version-manifest-resolve";
import { logger } from "../utils/logger";
import { ConfigService } from "./config";
import { RuntimeSnapshot } from "./runtime-snapshot";
import { SnapshotCoordinator } from "./snapshot-coordinator";

export const DEFAULT_WATCH_INTERVAL_MS = 30_000;

/** Repeated adopt failures back off exponentially from the base interval,
 * capped here — a deterministically failing adopt must not flood the logs
 * every tick. Reset on any clean/swapped tick. */
export const ADOPT_BACKOFF_CAP_MS = 5 * 60_000;

export const adoptBackoffMs = (intervalMs: number, consecutiveFailures: number): number => {
  if (consecutiveFailures <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** (consecutiveFailures - 1), ADOPT_BACKOFF_CAP_MS);
};

/** Read BOS_SNAPSHOT_WATCH_INTERVAL_MS with the 30s default; 0 disables the
 * watch (a config-path boot's config is the truth — see the start stack). */
export function watchIntervalMs(): number {
  const raw = Number(process.env.BOS_SNAPSHOT_WATCH_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_WATCH_INTERVAL_MS;
}

/**
 * The published pointer's version identity: a hash over every remote's
 * `pin` — cheap to compute (no version-manifest fetch), and stable exactly
 * when the deployed set is. A pointer-fingerprint change is what triggers
 * the adopt transaction.
 */
export { pointerFingerprint } from "everything-dev/fingerprint";

export type WatchTickOutcome = "clean" | "swapped" | "swap-failed" | "pointer-unreachable";

/**
 * The full cause chain of a watch-tick failure. A bare `Effect.tryPromise`
 * wraps its rejection in an `UnknownError` whose own message is the generic
 * "An error occurred in Effect.tryPromise" — the real cause lives one or
 * more `.cause` hops deeper. Walk the chain, dedupe adjacent repeats, and
 * join so a single greppable line carries the whole story.
 */
export const describeCauseChain = (cause: unknown): string => {
  const parts: string[] = [];
  let current: unknown = cause;
  for (let hops = 0; current != null && typeof current === "object" && hops < 6; hops += 1) {
    if (current instanceof Error && current.message) {
      const { message } = current;
      if (message !== parts[parts.length - 1]) parts.push(message);
    }
    current = (current as { cause?: unknown }).cause;
  }
  if (parts.length > 0) return parts.join(" → ");
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
};

export interface WatchTickDeps {
  snapshot: RuntimeSnapshot["Service"];
  adopt: (published: BosConfig) => Promise<{ status: string }>;
  fetchPointer: () => Promise<BosConfig | null>;
  verifyEntries: (config: RuntimeConfig) => Promise<void>;
  lastSeen: string | undefined;
}

/**
 * One watch tick (atomic-deploys 08): fetch the published pointer; a
 * fingerprint change → the adopt transaction (derive → pre-warm → verify →
 * swap — the adopt's own SRI pass covers the entries it adopts). An adopt
 * failure logs and leaves `lastSeen` unchanged so the next tick retries.
 * On the unchanged-pointer path the current entries are SRI-verified each
 * tick; a verification failure there means the pinned bytes are wrong on the
 * serving side for an unchanged pointer — alert (the greppable
 * `[IntegrityMonitor] INTEGRITY FAILURE` string, kept for the regression
 * suite).
 */
export const runWatchTick = (
  deps: WatchTickDeps,
): Effect.Effect<{ lastSeen: string | undefined; outcome: WatchTickOutcome }> =>
  Effect.gen(function* () {
    const state = yield* deps.snapshot.get;
    const config = state.config;

    const pointer = yield* Effect.tryPromise(() => deps.fetchPointer()).pipe(
      Effect.catch((cause) => {
        logger.warn(
          `[SnapshotWatch] pointer fetch failed: ${cause instanceof Error ? cause.message : cause}`,
        );
        return Effect.succeed(null);
      }),
    );
    if (!pointer) return { lastSeen: deps.lastSeen, outcome: "pointer-unreachable" };

    const fingerprint = pointerFingerprint(pointer);
    if (fingerprint !== deps.lastSeen) {
      const adopted = yield* Effect.tryPromise(() => deps.adopt(pointer)).pipe(
        Effect.match({
          onSuccess: (outcome) => {
            if (outcome.status === "swapped") {
              logger.info(`[SnapshotWatch] snapshot swapped to ${fingerprint}`);
            }
            return true;
          },
          onFailure: (cause) => {
            logger.error(
              `[SnapshotWatch] adopt failed for ${fingerprint} — retrying next tick:`,
              describeCauseChain(cause),
            );
            return false;
          },
        }),
      );
      return {
        lastSeen: adopted ? fingerprint : deps.lastSeen,
        outcome: adopted ? "swapped" : "swap-failed",
      };
    }

    yield* Effect.tryPromise(() => deps.verifyEntries(config)).pipe(
      Effect.catch((cause) => {
        logger.error(
          `[IntegrityMonitor] INTEGRITY FAILURE for ${config.account}/${config.domain ?? ""}:`,
          cause instanceof Error ? cause.message : cause,
        );
        return Effect.void;
      }),
    );
    return { lastSeen: deps.lastSeen, outcome: "clean" };
  });

interface VerifyTarget {
  key: string;
  url?: string;
  integrity?: string;
  extendsRef?: string;
}

/**
 * SRI-verify the live remotes against their derived pins (the monitor's old
 * job, ported): every production remote is pin-derived, so each target URL IS
 * the (hashed) entry — verified directly, no fixed-name resolution; an
 * extends-ref remote re-reads the PARENT config from FastKV and verifies
 * against the parent's latest pin — an upstream republish is noticed without
 * a restart (the parent's freshly-resolved `entryIntegrity` no longer matches
 * this snapshot's (older) entry bytes).
 */
async function verifyCurrentEntries(config: RuntimeConfig): Promise<void> {
  const targets: Array<VerifyTarget> = [
    {
      key: "ui",
      url: config.ui.entryUrl ?? config.ui.url,
      integrity: config.ui.integrity,
    },
    ...(config.ui.ssrEntryUrl
      ? [
          {
            key: "ui-ssr",
            url: config.ui.ssrEntryUrl,
            integrity: config.ui.ssrIntegrity,
          },
        ]
      : []),
    ...(config.api?.url
      ? [
          {
            key: "api",
            url: config.api.entryUrl ?? config.api.url,
            integrity: config.api.integrity,
          },
        ]
      : []),
    ...(config.auth?.url
      ? [
          {
            key: "auth",
            url: config.auth.entryUrl ?? config.auth.url,
            integrity: config.auth.integrity,
            extendsRef: config.auth.extendsRef,
          },
        ]
      : []),
  ];
  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    if (plugin?.url) {
      targets.push({
        key,
        url: plugin.entryUrl ?? plugin.url,
        integrity: plugin.integrity,
        extendsRef: plugin.extendsRef,
      });
    }
    if (plugin?.ui?.url) {
      targets.push({
        key: `${key}-ui`,
        url: plugin.ui.entryUrl ?? plugin.ui.url,
        integrity: plugin.ui.integrity,
        extendsRef: plugin.extendsRef,
      });
    }
  }

  for (const target of targets) {
    if (!target.url) continue;
    if (target.extendsRef) {
      const parentConfig = await registryClientShape.read<Record<string, unknown>>({
        kind: "runtimeConfig",
        ref: refOf(target.extendsRef),
      });
      const parentRemote = getRemoteForExtends(parentConfig, target.key);
      const parentPin = getPinForExtends(parentConfig, target.key);
      if (parentPin) {
        // resolve the parent's pin to its (possibly newer) entry coordinates
        // and verify this snapshot's (older) entry bytes against them — an
        // upstream republish surfaces as an integrity failure
        const resolved = await resolveRemoteVersion({
          base: typeof parentRemote?.production === "string" ? parentRemote.production : "",
          digest: parentPin,
        });
        await fetchVerified({ url: target.url, expected: asDigest(resolved.entryIntegrity) });
      } else if (parentRemote && typeof parentRemote.integrity === "string") {
        await fetchVerified({ url: target.url, expected: asDigest(parentRemote.integrity) });
      }
      continue;
    }
    if (target.integrity) {
      await fetchVerified({ url: target.url, expected: asDigest(target.integrity) });
    }
  }
}

function getRemoteForExtends(
  config: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const targetPath =
    key === "ui"
      ? "app.ui"
      : key === "auth"
        ? "app.auth"
        : key.endsWith("-ui")
          ? `plugins.${key.slice(0, -3)}.ui`
          : `plugins.${key}`;

  let current: unknown = config;
  for (const part of targetPath.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === "object" ? (current as Record<string, unknown>) : undefined;
}

function getPinForExtends(
  config: Record<string, unknown>,
  key: string,
): { manifest: string; integrity: string } | undefined {
  const remote = getRemoteForExtends(config, key);
  const pin = remote?.pin as { manifest?: unknown; integrity?: unknown } | undefined;
  if (
    pin &&
    typeof pin.manifest === "string" &&
    typeof pin.integrity === "string" &&
    pin.manifest &&
    pin.integrity
  ) {
    return { manifest: pin.manifest, integrity: pin.integrity };
  }
  return undefined;
}

/**
 * The supervised watch fiber (atomic-deploys 08) — replaces the old
 * setInterval integrity monitor: a scope-owned loop polling the published
 * pointer + verifying the current entries. Production-only (dev has no
 * published pointer; the boot config is the truth there).
 */
export class SnapshotWatch extends Context.Service<
  SnapshotWatch,
  {
    readonly tick: Effect.Effect<{ lastSeen: string | undefined; outcome: WatchTickOutcome }>;
    readonly lastOutcome: WatchTickOutcome | undefined;
  }
>()("host/SnapshotWatch") {
  static readonly layer = (intervalMs = watchIntervalMs()) =>
    Layer.effect(
      SnapshotWatch,
      Effect.gen(function* () {
        const snapshot = yield* RuntimeSnapshot;
        const coordinator = yield* SnapshotCoordinator;
        const config = yield* ConfigService;
        const effectContext = yield* Effect.context();

        let lastSeen: string | undefined;
        let lastOutcome: WatchTickOutcome | undefined;
        let consecutiveAdoptFailures = 0;
        const watchTarget = config.domain ? `bos://${config.account}/${config.domain}` : undefined;
        const tick = Effect.gen(function* () {
          const result = yield* runWatchTick({
            snapshot,
            adopt: (published) =>
              Effect.runPromiseWith(effectContext)(coordinator.adopt(published)),
            fetchPointer: () =>
              watchTarget
                ? registryClientShape
                    .readOrNull<BosConfig>({ kind: "runtimeConfig", ref: refOf(watchTarget) })
                    .catch(() => null)
                : Promise.resolve(null),
            verifyEntries: (current) => verifyCurrentEntries(current),
            lastSeen,
          });
          lastSeen = result.lastSeen;
          lastOutcome = result.outcome;
          return result;
        });

        if (config.env !== "production") {
          logger.info(
            "[SnapshotWatch] disabled outside production (boot config is the truth in dev)",
          );
          return SnapshotWatch.of({
            tick,
            get lastOutcome() {
              return lastOutcome;
            },
          });
        }

        if (intervalMs === 0) {
          logger.info(
            "[SnapshotWatch] disabled by BOS_SNAPSHOT_WATCH_INTERVAL_MS=0 (boot config is the truth)",
          );
          return SnapshotWatch.of({
            tick,
            get lastOutcome() {
              return lastOutcome;
            },
          });
        }

        if (!watchTarget) {
          logger.error(
            "[SnapshotWatch] disabled — the boot config has no domain, so there is no published pointer to watch",
          );
          return SnapshotWatch.of({
            tick,
            get lastOutcome() {
              return lastOutcome;
            },
          });
        }

        logger.info(`[SnapshotWatch] watching ${watchTarget} every ${intervalMs / 1000}s`);
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            while (true) {
              yield* Effect.sleep(adoptBackoffMs(intervalMs, consecutiveAdoptFailures));
              const { outcome } = yield* tick;
              if (outcome === "swap-failed") {
                consecutiveAdoptFailures += 1;
                if (consecutiveAdoptFailures > 1) {
                  const nextDelayS = adoptBackoffMs(intervalMs, consecutiveAdoptFailures) / 1000;
                  logger.warn(
                    `[SnapshotWatch] adopt still failing — next attempt in ${nextDelayS}s`,
                  );
                }
              } else if (outcome === "clean" || outcome === "swapped") {
                consecutiveAdoptFailures = 0;
              }
            }
          }),
        );
        return SnapshotWatch.of({
          tick,
          get lastOutcome() {
            return lastOutcome;
          },
        });
      }),
    );
}
