import type { BosConfigInput } from "../../types";
import { collectPinnedRemotes, digestOf, verifyChain } from "../verify/chain";

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

export { collectRemoteDescriptors, type RemoteDescriptor } from "../verify/chain";

export async function verifyRollbackSnapshot(
  config: BosConfigInput,
  opts?: { fetchImpl?: typeof fetch },
): Promise<RollbackVerification> {
  const pinned = collectPinnedRemotes(config).filter((entry) => digestOf(entry.ref) !== null);

  if (pinned.length === 0) {
    return { verifiable: false, ok: false, remotes: [] };
  }

  const chain = await verifyChain({
    config,
    depth: "pointer",
    ...(opts?.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  });
  const walked = new Map(chain.remotes.map((remote) => [remote.remote, remote]));

  const remotes: RollbackRemoteCheck[] = pinned.map((entry) => {
    const digest = digestOf(entry.ref)!;
    const check = walked.get(entry.remote);
    if (!check) {
      return {
        remote: entry.remote,
        manifest: digest.manifest,
        ok: false,
        reason: "no production URL to fetch the manifest from",
      };
    }
    return {
      remote: entry.remote,
      manifest: check.manifest,
      ok: check.manifestOk,
      ...(check.manifestReason !== undefined ? { reason: check.manifestReason } : {}),
    };
  });
  return { verifiable: true, ok: remotes.every((remote) => remote.ok), remotes };
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
