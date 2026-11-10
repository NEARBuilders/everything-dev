/**
 * Deployed-vs-served version delta (atomic-deploys 12): the split-brain
 * detector — the published pointer's digest vs the pointer digest the host
 * actually serves. A mismatch means the host has not adopted the latest
 * publish (or is pinned to stale bytes), which is exactly what the
 * 2026-09-30 incident looked like from the outside.
 */

export interface DeployedVersionStatus {
  publishedDigest: string;
  servedDigest?: string;
  inSync: boolean;
  error?: string;
}

export function computeDeployedVersionStatus(input: {
  publishedDigest: string;
  servedDigest?: string | null;
  servedError?: string;
}): DeployedVersionStatus {
  if (input.servedDigest === null || input.servedDigest === undefined) {
    return {
      publishedDigest: input.publishedDigest,
      inSync: false,
      ...(input.servedError ? { error: input.servedError } : {}),
    };
  }
  return {
    publishedDigest: input.publishedDigest,
    servedDigest: input.servedDigest,
    inSync: input.publishedDigest === input.servedDigest,
  };
}
