import { createHash } from "node:crypto";
import type { BosConfig, RuntimeConfig } from "../../types";
import { walkRemotes } from "../remotes";

/**
 * The registry's fingerprint module — every identity hash lives here so the
 * planes can't drift apart:
 *
 * - `pointerFingerprint` — THE composition identity: a hash over every
 *   remote's pin coordinates (digest manifest + integrity, or the direct
 *   entry integrity). It is the lockfile's fingerprint (ADR 0042), the
 *   watch's change-detection hash, and what deployment records name.
 * - `deploymentFingerprint` — the serving-generation payload hash
 *   (atomic-deploys 10): entryUrl + entry integrity (+ SSR integrity) per
 *   remote, stamped into the client config as the soft-refresh signal and
 *   used by the host's adopt comparison for derived generations. Derived
 *   from the same remotes AFTER entry resolution, so it changes whenever
 *   the composition changes — plus when only resolved entry coordinates
 *   change. Semantic merge of the two hashes is a recorded future seam:
 *   both sides of every existing comparison must move together.
 */

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

/**
 * The serving-generation payload hash — see the module docstring for its
 * identity contract versus `pointerFingerprint`.
 */
export function deploymentFingerprint(config: RuntimeConfig): string {
  const parts: Array<string> = [];
  const remote = (
    prefix: string,
    s: { entryUrl?: string; integrity?: string; ssrIntegrity?: string } | undefined,
  ) => {
    if (!s) return;
    parts.push(`${prefix}:${s.entryUrl ?? ""}:${s.integrity ?? ""}:${s.ssrIntegrity ?? ""}`);
  };
  remote("ui", config.ui);
  remote("api", config.api);
  remote("auth", config.auth);
  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    remote(`plugin.${key}`, plugin);
    remote(`plugin.${key}.ui`, plugin.ui);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
