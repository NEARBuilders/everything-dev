import type { BosConfigInput } from "../../types";
import { walkRemotes } from "../remotes";
import { fetchVerifiedManifest } from "./manifest-verify";

/**
 * Rollback safety gate (atomic-deploys 11): before republishing a historical
 * snapshot, every pinned remote's version manifest must still serve and match
 * its SRI — Phase A made bytes additive and retention is keep-everything, so
 * a verify failure means the pointer is broken, never publishable. Snapshots
 * from before the pin existed cannot be verified this way; they are allowed
 * only with an explicit force (their bytes were overwritten in place), with
 * the caller expected to warn loudly.
 */

export interface RollbackRemoteCheck {
  remote: string;
  manifest?: string;
  ok: boolean;
  reason?: string;
}

export interface RollbackVerification {
  /** false = pre-pin snapshot with no verifiable pins (force required) */
  verifiable: boolean;
  ok: boolean;
  remotes: RollbackRemoteCheck[];
}

interface PinnedRemoteRef {
  production?: unknown;
  digest?: { manifest?: unknown; integrity?: unknown };
}

function collectPinnedRemotes(
  config: BosConfigInput,
): Array<{ remote: string; ref: PinnedRemoteRef }> {
  const remotes: Array<{ remote: string; ref: PinnedRemoteRef }> = [];
  walkRemotes(config as unknown as Record<string, unknown>, ({ remote, entry }) => {
    if (entry && typeof entry === "object") remotes.push({ remote, ref: entry as PinnedRemoteRef });
  });
  return remotes;
}

function digestOf(ref: PinnedRemoteRef): { manifest: string; integrity: string } | null {
  const manifest = typeof ref.digest?.manifest === "string" ? ref.digest.manifest : undefined;
  const integrity = typeof ref.digest?.integrity === "string" ? ref.digest.integrity : undefined;
  return manifest && integrity ? { manifest, integrity } : null;
}

export interface RemoteDescriptor {
  remote: string;
  /** the remote's production base URL (…/bundles/<account>/<gateway>/<workspace>/) */
  base: string;
  digest: { manifest: string; integrity: string };
}

/** Every pinned remote with both a production base and a verifiable pin. */
export function collectRemoteDescriptors(config: BosConfigInput): RemoteDescriptor[] {
  return collectPinnedRemotes(config)
    .map(({ remote, ref }) => {
      const digest = digestOf(ref);
      const base = typeof ref.production === "string" ? ref.production : undefined;
      return digest && base ? { remote, base, digest } : null;
    })
    .filter((entry): entry is RemoteDescriptor => entry !== null);
}

async function verifyRemote(
  remote: string,
  ref: PinnedRemoteRef,
  fetchImpl: typeof fetch,
): Promise<RollbackRemoteCheck> {
  const base = typeof ref.production === "string" ? ref.production : undefined;
  const digest = digestOf(ref);
  if (!digest) return { remote, ok: true };
  const { manifest, integrity } = digest;

  if (!base)
    return { remote, manifest, ok: false, reason: "no production URL to fetch the manifest from" };

  const verified = await fetchVerifiedManifest({
    base,
    digest: { manifest, integrity },
    fetchImpl,
  });
  if (!verified.ok) {
    return { remote, manifest, ok: false, reason: verified.reason };
  }
  return { remote, manifest, ok: true };
}

export async function verifyRollbackSnapshot(
  config: BosConfigInput,
  opts?: { fetchImpl?: typeof fetch },
): Promise<RollbackVerification> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const pinned = collectPinnedRemotes(config).filter((entry) => digestOf(entry.ref) !== null);

  if (pinned.length === 0) {
    return { verifiable: false, ok: false, remotes: [] };
  }

  const remotes = await Promise.all(
    pinned.map((entry) => verifyRemote(entry.remote, entry.ref, fetchImpl)),
  );
  return { verifiable: true, ok: remotes.every((check) => check.ok), remotes };
}

export function summarizeRemoteDigests(config: BosConfigInput): string {
  const pinned = collectPinnedRemotes(config)
    .map((entry) => {
      const digest = digestOf(entry.ref);
      return digest ? `${entry.remote}=${digest.manifest}` : null;
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
