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
 * never skips the leg — it retries until the deadline. The transaction probe
 * is consultative: it runs only after a content miss and may terminate a
 * wait content has already failed to satisfy, never preempt a verify — the
 * read-back outranks it (a landed publish executes with CodeDoesNotExist on
 * the codeless namespace and that is success).
 */

export type ConfirmLegKind = "runtimeConfig" | "manifest" | "version";

/** The submit's transaction as the chain sees it, from the `txStatus` seam.
 * `invalid` is explicit rejection (stale nonce, expired); `unknown` means no
 * node has the transaction; `unreachable` is a failed status probe — always
 * treated as informative-only, never proof of anything. */
export type TxStatus = "included" | "invalid" | "unknown" | "unreachable";

export interface ConfigConfirmLeg {
  readonly kind: ConfirmLegKind;
  readonly key: RegistryKey;
  /** The expected value — the exact publish payload (deep-equality via
   * JSON compare; the registry serves the written value verbatim). */
  readonly expected: unknown;
  /** Overrides the default keyed read — the manifest/version legs read
   * through pointer.ts's transports (the train binds account/gateway and
   * the registry override); the config leg reads through the injected
   * `read` seam. */
  readonly read?: () => Promise<unknown>;
}

export type ConfirmLeg = ConfigConfirmLeg;

export type ConfirmVerdict =
  | { readonly ok: true; readonly verified: readonly ConfirmLegKind[] }
  | {
      readonly ok: false;
      readonly unverified: readonly ConfirmLegKind[];
      readonly lastError?: string;
      /** The transaction reached a terminal-unapplied outcome — rejected on-chain
       * or dropped at broadcast (most often a stale nonce). The registry was
       * never written; content polling is pointless. The caller may resubmit
       * identical bytes. */
      readonly terminalTx?: true;
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
  /** The submit's transaction status as the chain sees it. `invalid` and an
   * `unknown` state persisting past {@link TX_UNKNOWN_GRACE_MS} end the wait
   * early with a terminal verdict; everything else keeps content polling. */
  readonly txStatus?: (txHash: string) => Promise<TxStatus>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const envMs = (name: string): number | undefined => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
};

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** How long a transaction may stay unknown to the chain before the wait is
 * declared terminal: a broadcast that landed is visible within seconds; one
 * still unknown past this grace was dropped (most often a stale nonce from a
 * lagging RPC at broadcast) and will never apply. */
export const TX_UNKNOWN_GRACE_MS = 30_000;

const terminalVerdict = (
  txHash: string,
  reason: string,
  unverified: readonly ConfirmLegKind[],
): Extract<ConfirmVerdict, { ok: false }> => ({
  ok: false,
  unverified: [...unverified],
  lastError: `transaction ${txHash} will never apply (${reason}) — the registry was not written`,
  terminalTx: true,
});

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
  const probeLeg = opts.legs[0];
  let trackByTx = opts.txHash !== undefined && opts.history !== undefined && probeLeg !== undefined;
  let txProbeSkips = 0;
  let indexed = false;

  const startedAt = now();
  let txUnknownSince: number | undefined;
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

    let contentMissed = false;
    for (const leg of pending()) {
      try {
        const served = leg.read ? await leg.read() : await read(leg.key);
        if (deepEqual(served, leg.expected)) {
          verified.add(leg.kind);
          lastErrors.delete(leg.kind);
        } else {
          lastErrors.set(leg.kind, "registry serves a different value");
          contentMissed = true;
        }
      } catch (error) {
        lastErrors.set(leg.kind, error instanceof Error ? error.message : String(error));
        contentMissed = true;
      }
    }

    if (pending().length === 0) {
      return { ok: true, verified: [...verified] };
    }

    // The transaction probe runs only after content failed to verify: the
    // read-back is the authority (a landed publish executes with
    // CodeDoesNotExist on the codeless namespace and that is success), so the
    // probe may terminate a wait content has already failed to satisfy — it
    // must never preempt a verify.
    if (contentMissed && opts.txHash && opts.txStatus && !indexed) {
      let status: TxStatus;
      try {
        status = await opts.txStatus(opts.txHash);
      } catch {
        status = "unreachable";
      }
      if (status === "invalid") {
        return terminalVerdict(
          opts.txHash,
          "rejected on-chain (stale nonce, missing publish key, or expired — re-mint with `bos login --key` and update NEAR_PRIVATE_KEY)",
          pending().map((leg) => leg.kind),
        );
      }
      if (status === "unknown") {
        if (txUnknownSince === undefined) {
          txUnknownSince = now();
        } else if (now() - txUnknownSince >= TX_UNKNOWN_GRACE_MS) {
          return terminalVerdict(
            opts.txHash,
            `unknown to the chain past ${TX_UNKNOWN_GRACE_MS / 1000}s — dropped at broadcast`,
            pending().map((leg) => leg.kind),
          );
        }
      } else {
        txUnknownSince = undefined;
      }
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
    .map((leg) => keyPathOf(leg.key));
  return (
    `Timed out waiting for publish confirmation — unverified: ${unverifiedKeys.join(", ")}` +
    (verdict.lastError ? ` (last error: ${verdict.lastError})` : "")
  );
}
