import { registryClientShape } from "./client";
import { keyPathOf, type RegistryKey } from "./keys";

/**
 * The publish-confirmation state machine: a registry write is verified, not
 * assumed. Every leg the publish wrote — the runtime config always, the
 * manifest tag and its version record on release trains — must read back
 * byte-equal before the publish counts, because FastKV writes are
 * action-indexed: the on-chain transaction's execution is irrelevant
 * (CodeDoesNotExist is the designed success path), the read-back is the
 * only authority.
 *
 * States: Pending → Indexed (the tx is visible in the registry's history;
 * the cheap probe) → Verified (every leg reads back deep-equal) | TimedOut
 * (deadline; the unverified legs are named). Two provisions carry over from
 * the polling loop this replaces: the history probe is informative only —
 * after two informative-but-absent probes, or any history failure, the
 * machine falls back permanently to plain content polling, so a registry
 * whose history never carries the tx still verifies; and a leg read failure
 * never skips the leg — it retries until the deadline.
 */

export type ConfirmLegKind = "runtimeConfig" | "manifest" | "version" | "platformPointer";

export interface ConfigConfirmLeg {
  readonly kind: "runtimeConfig" | "manifest" | "version";
  readonly key: RegistryKey;
  /** The expected value — the exact publish payload (deep-equality via
   * JSON compare; the registry serves the written value verbatim). */
  readonly expected: unknown;
}

export interface PlatformPointerConfirmLeg {
  readonly kind: "platformPointer";
  /** The pre-cutover wire key (`apps/<a>/<g>/platform.json`) — named
   * verbatim in the timeout message. The pointer lives outside the key
   * model's union until ticket 10's cutover, so it carries its wire key
   * explicitly instead of a RegistryKey. */
  readonly wireKey: string;
  /** The pre-cutover transport, injected — `readPlatformPointer` bound to
   * the runtime; never baked into keys.ts. */
  readonly read: () => Promise<unknown>;
  /** The expected value — the composed release manifest the leg wrote. */
  readonly expected: unknown;
}

export type ConfirmLeg = ConfigConfirmLeg | PlatformPointerConfirmLeg;

export type ConfirmVerdict =
  | { readonly ok: true; readonly verified: readonly ConfirmLegKind[] }
  | {
      readonly ok: false;
      readonly unverified: readonly ConfirmLegKind[];
      readonly lastError?: string;
    };

export interface ConfirmOptions {
  readonly legs: readonly ConfirmLeg[];
  /** The submit's tx hash (#430) — enables the indexed-probe fast path. */
  readonly txHash?: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** Seams — tests substitute fakes; production defaults to the client. */
  readonly read?: (key: RegistryKey) => Promise<unknown>;
  readonly history?: (key: RegistryKey, limit: number) => Promise<Array<{ txHash?: string }>>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const envMs = (name: string): number | undefined => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
};

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export async function confirmPublish(opts: ConfirmOptions): Promise<ConfirmVerdict> {
  const timeoutMs = opts.timeoutMs ?? envMs("BOS_PUBLISH_CONFIRMATION_TIMEOUT_MS") ?? 120_000;
  const intervalMs = opts.intervalMs ?? envMs("BOS_PUBLISH_CONFIRMATION_INTERVAL_MS") ?? 3_000;
  const read = opts.read ?? ((key: RegistryKey) => registryClientShape.read(key));
  const history =
    opts.history ?? ((key: RegistryKey, limit: number) => registryClientShape.history(key, limit));
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const verified = new Set<ConfirmLegKind>();
  const pending = () => opts.legs.filter((leg) => !verified.has(leg.kind));
  const lastErrors = new Map<ConfirmLegKind, string>();

  // The tx probe is informative only: after TX_PROBE_SKIP_LIMIT
  // informative-but-absent probes — or any probe failure — the machine
  // tracks by content alone. It probes the first keyed leg (the runtime
  // config, always present in a real publish).
  const TX_PROBE_SKIP_LIMIT = 2;
  const probeLeg = opts.legs.find((leg): leg is ConfigConfirmLeg => "key" in leg);
  let trackByTx = opts.txHash !== undefined && opts.history !== undefined && probeLeg !== undefined;
  let txProbeSkips = 0;
  let indexed = false;

  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (trackByTx && !indexed) {
      try {
        const entries = await history(probeLeg!.key, 5);
        if (entries.some((entry) => entry.txHash === opts.txHash)) {
          indexed = true;
          txProbeSkips = 0;
        } else {
          txProbeSkips += 1;
          if (txProbeSkips >= TX_PROBE_SKIP_LIMIT) trackByTx = false;
          await sleep(intervalMs);
          continue;
        }
      } catch {
        trackByTx = false;
      }
    }

    for (const leg of pending()) {
      try {
        const served = "read" in leg ? await leg.read() : await read(leg.key);
        if (deepEqual(served, leg.expected)) {
          verified.add(leg.kind);
          lastErrors.delete(leg.kind);
        } else {
          lastErrors.set(leg.kind, "registry serves a different value");
        }
      } catch (error) {
        lastErrors.set(leg.kind, error instanceof Error ? error.message : String(error));
      }
    }

    if (pending().length === 0) {
      return { ok: true, verified: [...verified] };
    }
    await sleep(intervalMs);
  }

  const unverified = pending().map((leg) => leg.kind);
  const lastError = [...lastErrors.values()].at(-1);
  return { ok: false, unverified, ...(lastError ? { lastError } : {}) };
}

/** The train-facing failure message — the wire form of `TimedOut` (#422's
 * confirm channel): the legs' actual wire keys, named. */
export function describeConfirmTimeout(
  legs: readonly ConfirmLeg[],
  verdict: Extract<ConfirmVerdict, { ok: false }>,
): string {
  const unverifiedKeys = legs
    .filter((leg) => verdict.unverified.includes(leg.kind))
    .map((leg) => ("wireKey" in leg ? leg.wireKey : keyPathOf(leg.key)));
  return (
    `Timed out waiting for publish confirmation — unverified: ${unverifiedKeys.join(", ")}` +
    (verdict.lastError ? ` (last error: ${verdict.lastError})` : "")
  );
}
