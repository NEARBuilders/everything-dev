import { createHash } from "node:crypto";
import type { BosConfig, RuntimeConfig } from "../../types";
import { walkRemotes } from "../remotes";

/**
 * The registry's identity module — every composition-plane digest derives
 * here so the planes can't drift apart (ADR 0046 ticket 04). Vocabulary: a
 * digest is any identity hash; the species are distinguished by what they
 * hash and who consumes them, never compared across.
 *
 * - `pointerDigest` — THE composition identity (what is pinned): a hash over
 *   every remote's pin coordinates (digest manifest + integrity, or the
 *   direct entry integrity). It is the lockfile's identity (ADR 0042), the
 *   watch's change-detection hash, and what deployment records name. The
 *   derivation never changes silently: stored lockfiles and boot snapshots
 *   recompute and compare it.
 * - `deploymentDigest` — the serving-generation identity (what is served,
 *   atomic-deploys 10): derived from the pointer inputs — the same pin
 *   coordinates `pointerDigest` hashes, stamped onto the resolved slots at
 *   resolution — plus the resolved entry coordinates (entryUrl, entry
 *   integrity, SSR integrity) per slot. Stamped into the runtime config as
 *   the client's soft-refresh signal (wire field `deploymentDigest`) and
 *   used by the host's adopt comparison.
 *
 * The relation, and its limit: pointer stable + entries stable ⇒ deployment
 * stable, because deployment hashes exactly those inputs. The converse is
 * deliberately NOT a guarantee the code may rely on: deployment stability is
 * a serving-plane statement ("keep serving this generation"), pointer
 * stability is a provenance statement ("the published pins moved"). The
 * watch tracks the pointer independently; adopt treats an unchanged
 * deployment digest as skip — a heuristic, never proof that nothing was
 * republished.
 *
 * Species inventory (each answers one question; homes are authoritative):
 * - content digests — bytes-hash-to-SRI: the engine's `Digest` brand
 *   (`services/verify/engine.ts`) is the only SRI primitive's output type.
 *   `version id`/`dirId` (every-plugin `artifact-names`) are artifact
 *   content hashes — versioned manifests and `versions/<dirId>/` dirs — not
 *   composition identities; they stay in every-plugin.
 * - compose digest — `digestOf` (`everything-dev/ui/manifest`, wrapped by
 *   the host's `digestOfSources`): SSR/client parity over sorted manifests
 *   + keys; deliberately deployment-free so parity holds across pin churn.
 * - lockfile digest — `digestOfLockfile` (lockfile/schema.ts): content
 *   digest of the serialized lockfile; what a deployment record names when
 *   it answers "what exact composition was live". Its sibling
 *   `lockfilePointerDigest` recomputes the pointer digest from the stored
 *   `remotes` record — ≡ `pointerDigest` by construction; kept beside the
 *   `pointerDigest` field it validates.
 * - compose variant cache key — host ui-compose `variantCacheKey`: SSR
 *   integrity / local mtimes. A cache key, NOT an identity — it hashes the
 *   dev filesystem, so it can never be compared across planes.
 *
 * Vocabulary cutover (ticket 04 + follow-up): the word "fingerprint" is
 * retired — the identities it named were `pointerDigest`/`deploymentDigest`
 * all along, every wire field it survived in (lockfile, boot snapshot, deploy
 * records, the version endpoint, the client payload) is renamed in the same
 * change, and the module's own subpath moved with it: this file is
 * `everything-dev/digest` (the old `everything-dev/fingerprint` subpath is
 * removed, not deprecated). Files written by older framework versions fail
 * the strict parse naming the field; they regenerate on the next `bos lock` /
 * first adopt.
 */

/**
 * The composition-plane digest form: sha256 over "|"-joined parts, trimmed
 * to 16 hex chars. One helper so every producer of this form (this module,
 * the lockfile recompute) shares the exact serialization — the form is
 * load-bearing in stored files.
 */
export function digestOfParts(parts: Array<string>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * The published pointer's version identity (atomic-deploys 08/12): a hash
 * over every remote's pin coordinates — cheap to compute (no version-manifest
 * fetch), and stable exactly when the deployed set is. Shared so the CLI and
 * the host compute the same identity for the same pointer.
 */
export function pointerDigest(config: BosConfig): string {
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
  return digestOfParts(parts);
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
 * The serving-generation identity — see the module docstring for the
 * derivation contract versus `pointerDigest`. Per slot: the pointer inputs
 * (pin coordinates — what is pinned) then the resolved coordinates (what is
 * served). The pointer inputs ride the resolved slots because resolution
 * stamps them (`deriveVersionManifestFields`), so the runtime config is
 * self-describing and this stays a single-argument derivation.
 */
export function deploymentDigest(config: RuntimeConfig): string {
  const parts: Array<string> = [];
  const remote = (
    prefix: string,
    s:
      | {
          digest?: { manifest?: unknown; integrity?: unknown };
          integrity?: string;
          entryUrl?: string;
          ssrIntegrity?: string;
        }
      | undefined,
  ) => {
    if (!s) return;
    const digest = s.digest;
    const digestPart =
      digest && typeof digest.manifest === "string" && typeof digest.integrity === "string"
        ? `${digest.manifest}:${digest.integrity}`
        : "";
    const directPart = typeof s.integrity === "string" ? s.integrity : "";
    parts.push(
      `${prefix}:${digestPart}:${directPart}:${s.entryUrl ?? ""}:${s.integrity ?? ""}:${s.ssrIntegrity ?? ""}`,
    );
  };
  remote("ui", config.ui);
  remote("api", config.api);
  remote("auth", config.auth);
  for (const [key, plugin] of Object.entries(config.plugins ?? {})) {
    remote(`plugin.${key}`, plugin);
    remote(`plugin.${key}.ui`, plugin.ui);
  }
  return digestOfParts(parts);
}
