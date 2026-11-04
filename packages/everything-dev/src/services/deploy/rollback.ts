import type { BosConfigInput } from "../../types";
import { walkRemotes } from "../remotes";
import { fetchVerifiedManifest } from "./manifest-verify";

/**
 * Rollback safety gate (atomic-deploys 11): before republishing a historical
 * snapshot, every pinned slot's version manifest must still serve and match
 * its SRI — Phase A made bytes additive and retention is keep-everything, so
 * a verify failure means the pointer is broken, never publishable. Snapshots
 * from before the pin existed cannot be verified this way; they are allowed
 * only with an explicit force (their bytes were overwritten in place), with
 * the caller expected to warn loudly.
 */

export interface RollbackSlotCheck {
  slot: string;
  manifest?: string;
  ok: boolean;
  reason?: string;
}

export interface RollbackVerification {
  /** false = pre-pin snapshot with no verifiable pins (force required) */
  verifiable: boolean;
  ok: boolean;
  slots: RollbackSlotCheck[];
}

interface PinnedSlotRef {
  production?: unknown;
  digest?: { manifest?: unknown; integrity?: unknown };
}

function collectPinnedSlots(config: BosConfigInput): Array<{ slot: string; ref: PinnedSlotRef }> {
  const slots: Array<{ slot: string; ref: PinnedSlotRef }> = [];
  walkRemotes(config as unknown as Record<string, unknown>, ({ slot, entry }) => {
    if (entry && typeof entry === "object") slots.push({ slot, ref: entry as PinnedSlotRef });
  });
  return slots;
}

function digestOf(ref: PinnedSlotRef): { manifest: string; integrity: string } | null {
  const manifest = typeof ref.digest?.manifest === "string" ? ref.digest.manifest : undefined;
  const integrity = typeof ref.digest?.integrity === "string" ? ref.digest.integrity : undefined;
  return manifest && integrity ? { manifest, integrity } : null;
}

export interface RemoteDescriptor {
  slot: string;
  /** the remote's production base URL (…/bundles/<account>/<gateway>/<workspace>/) */
  base: string;
  digest: { manifest: string; integrity: string };
}

/** Every pinned slot with both a production base and a verifiable pin. */
export function collectRemoteDescriptors(config: BosConfigInput): RemoteDescriptor[] {
  return collectPinnedSlots(config)
    .map(({ slot, ref }) => {
      const digest = digestOf(ref);
      const base = typeof ref.production === "string" ? ref.production : undefined;
      return digest && base ? { slot, base, digest } : null;
    })
    .filter((entry): entry is RemoteDescriptor => entry !== null);
}

async function verifySlot(
  slot: string,
  ref: PinnedSlotRef,
  fetchImpl: typeof fetch,
): Promise<RollbackSlotCheck> {
  const base = typeof ref.production === "string" ? ref.production : undefined;
  const digest = digestOf(ref);
  if (!digest) return { slot, ok: true };
  const { manifest, integrity } = digest;

  if (!base)
    return { slot, manifest, ok: false, reason: "no production URL to fetch the manifest from" };

  const verified = await fetchVerifiedManifest({
    base,
    digest: { manifest, integrity },
    fetchImpl,
  });
  if (!verified.ok) {
    return { slot, manifest, ok: false, reason: verified.reason };
  }
  return { slot, manifest, ok: true };
}

export async function verifyRollbackSnapshot(
  config: BosConfigInput,
  opts?: { fetchImpl?: typeof fetch },
): Promise<RollbackVerification> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const pinned = collectPinnedSlots(config).filter((entry) => digestOf(entry.ref) !== null);

  if (pinned.length === 0) {
    return { verifiable: false, ok: false, slots: [] };
  }

  const slots = await Promise.all(
    pinned.map((entry) => verifySlot(entry.slot, entry.ref, fetchImpl)),
  );
  return { verifiable: true, ok: slots.every((check) => check.ok), slots };
}

export function summarizeSlotPins(config: BosConfigInput): string {
  const pinned = collectPinnedSlots(config)
    .map((entry) => {
      const digest = digestOf(entry.ref);
      return digest ? `${entry.slot}=${digest.manifest}` : null;
    })
    .filter(Boolean) as string[];
  return pinned.length > 0 ? pinned.join(" ") : "no version pins (pre-pin snapshot)";
}

export function buildRollbackPayload<T extends object>(
  targetConfig: T,
  rolledBackFrom: string,
): T & { rolledBackFrom: string } {
  return { ...targetConfig, rolledBackFrom };
}
