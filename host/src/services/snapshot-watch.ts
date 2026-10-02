import { Context, Effect, Layer } from "effect";
import { fetchBosConfigFromFastKv } from "everything-dev/fastkv";
import { pointerFingerprint } from "everything-dev/fingerprint";
import { verifySriForUrl } from "everything-dev/integrity";
import type { BosConfig, RuntimeConfig } from "everything-dev/types";
import { resolveSlotVersion } from "everything-dev/version-manifest-resolve";
import { logger } from "../utils/logger";
import { ConfigService } from "./config";
import { RuntimeSnapshot } from "./runtime-snapshot";
import { SnapshotCoordinator } from "./snapshot-coordinator";

export const DEFAULT_WATCH_INTERVAL_MS = 30_000;

/** Read BOS_SNAPSHOT_WATCH_INTERVAL_MS with the 30s default. */
export function watchIntervalMs(): number {
  const raw = Number(process.env.BOS_SNAPSHOT_WATCH_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WATCH_INTERVAL_MS;
}

/**
 * The published pointer's version identity: a hash over every slot's
 * `pin` — cheap to compute (no version-manifest fetch), and stable exactly
 * when the deployed set is. A pointer-fingerprint change is what triggers
 * the adopt transaction.
 */
export { pointerFingerprint } from "everything-dev/fingerprint";

export type WatchTickOutcome = "clean" | "swapped" | "swap-failed" | "pointer-unreachable";

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
              cause instanceof Error ? cause.message : cause,
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
 * SRI-verify the live slots against their derived pins (the monitor's old
 * job, ported): every production slot is pin-derived, so each target URL IS
 * the (hashed) entry — verified directly, no fixed-name resolution; an
 * extends-ref slot re-reads the PARENT config from FastKV and verifies
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
      const parentConfig = await fetchBosConfigFromFastKv<Record<string, unknown>>(
        target.extendsRef,
      );
      const parentSlot = getSlotForExtends(parentConfig, target.key);
      const parentPin = getPinForExtends(parentConfig, target.key);
      if (parentPin) {
        // resolve the parent's pin to its (possibly newer) entry coordinates
        // and verify this snapshot's (older) entry bytes against them — an
        // upstream republish surfaces as an integrity failure
        const resolved = await resolveSlotVersion({
          base: typeof parentSlot?.production === "string" ? parentSlot.production : "",
          pin: parentPin,
        });
        await verifySriForUrl(target.url, resolved.entryIntegrity, { resolveEntryUrl: false });
      } else if (parentSlot && typeof parentSlot.integrity === "string") {
        await verifySriForUrl(target.url, parentSlot.integrity, { resolveEntryUrl: false });
      }
      continue;
    }
    if (target.integrity) {
      await verifySriForUrl(target.url, target.integrity, { resolveEntryUrl: false });
    }
  }
}

function getSlotForExtends(
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
  const slot = getSlotForExtends(config, key);
  const pin = slot?.pin as { manifest?: unknown; integrity?: unknown } | undefined;
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
        const tick = Effect.gen(function* () {
          const result = yield* runWatchTick({
            snapshot,
            adopt: (published) =>
              Effect.runPromiseWith(effectContext)(coordinator.adopt(published)),
            fetchPointer: () =>
              fetchBosConfigFromFastKv<BosConfig>(
                `bos://${config.account}/${config.domain ?? "everything.dev"}`,
              ).catch(() => null),
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

        logger.info(
          `[SnapshotWatch] watching bos://${config.account}/${config.domain ?? "everything.dev"} every ${intervalMs / 1000}s`,
        );
        yield* Effect.forkScoped(
          Effect.forever(Effect.flatMap(Effect.sleep(intervalMs), () => tick)),
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
