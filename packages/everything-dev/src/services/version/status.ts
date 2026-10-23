/**
 * Deployed-vs-served version delta (atomic-deploys 12): the split-brain
 * detector — the published pointer's fingerprint vs the fingerprint the host
 * actually serves. A mismatch means the host has not adopted the latest
 * publish (or is pinned to stale bytes), which is exactly what the
 * 2026-09-30 incident looked like from the outside.
 */

export interface DeployedVersionStatus {
  publishedFingerprint: string;
  servedFingerprint?: string;
  inSync: boolean;
  error?: string;
}

export function computeDeployedVersionStatus(input: {
  publishedFingerprint: string;
  servedFingerprint?: string | null;
  servedError?: string;
}): DeployedVersionStatus {
  if (input.servedFingerprint === null || input.servedFingerprint === undefined) {
    return {
      publishedFingerprint: input.publishedFingerprint,
      inSync: false,
      ...(input.servedError ? { error: input.servedError } : {}),
    };
  }
  return {
    publishedFingerprint: input.publishedFingerprint,
    servedFingerprint: input.servedFingerprint,
    inSync: input.publishedFingerprint === input.servedFingerprint,
  };
}
