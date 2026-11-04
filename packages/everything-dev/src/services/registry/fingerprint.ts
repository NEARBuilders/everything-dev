import { createHash } from "node:crypto";
import type { BosConfig } from "../../types";
import { walkRemotes } from "../remotes";

/**
 * The published pointer's version identity (atomic-deploys 08/12): a hash
 * over every remote's `digest` — cheap to compute (no version-manifest
 * fetch), and stable exactly when the deployed set is. Shared so the CLI and
 * the host compute the same identity for the same pointer.
 */
export function pointerFingerprint(config: BosConfig): string {
  const parts: Array<string> = [];
  walkRemotes(config as unknown as Record<string, unknown>, ({ remote, entry, isPluginRef }) => {
    if (isPluginRef) {
      parts.push(`${remote}:${entry as string}`);
      return;
    }
    const s = entry as { digest?: unknown; integrity?: unknown } | undefined;
    if (!s) return;
    const digest = s.digest as { manifest?: unknown; integrity?: unknown } | undefined;
    const digestPart =
      digest && typeof digest.manifest === "string" && typeof digest.integrity === "string"
        ? `${digest.manifest}:${digest.integrity}`
        : "";
    const directPart = typeof s.integrity === "string" ? s.integrity : "";
    parts.push(`${remote}:${digestPart}:${directPart}`);
  });
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Per-remote digest ids for display (remote → versioned manifest filename). */
export function remoteDigests(config: BosConfig): Record<string, string> {
  const digests: Record<string, string> = {};
  walkRemotes(config as unknown as Record<string, unknown>, ({ remote, entry, isPluginRef }) => {
    if (isPluginRef) return;
    const s = entry as { digest?: unknown } | undefined;
    if (!s) return;
    const manifest = (s.digest as { manifest?: unknown } | undefined)?.manifest;
    if (typeof manifest === "string") digests[remote] = manifest;
  });
  return digests;
}
