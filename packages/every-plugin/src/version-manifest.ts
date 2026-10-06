import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * WorkspaceVersionManifest — the immutable per-deploy document at
 * `bundles/<account>/<gateway>/<workspace>/versions/<version>.json`
 * (ADR 0020, as amended; atomic-deploys MAP decision 1). The published
 * config's slot pins this document via its `pin` (`manifest` + the
 * manifest's own SRI); every artifact coordinate lives here, so the config
 * stops growing with artifact kinds and old versions stay fully servable.
 */

const SRI = z.string().regex(/^sha384-[A-Za-z0-9+/=]+$/);

export const WorkspaceVersionManifestSchema = z.object({
  version: z.string().regex(/^[0-9a-f]{16}$/),
  builtAt: z.string().optional(),
  gitSha: z.string().optional(),
  entry: z.string().min(1),
  entryIntegrity: SRI,
  ssr: z
    .object({
      entry: z.string().min(1),
      integrity: SRI,
    })
    .optional(),
  browserManifest: z
    .object({
      file: z.string().min(1),
      integrity: SRI,
    })
    .optional(),
  /** extra assets (css, icons) — logical name → served-object SRI */
  assets: z.record(z.string(), SRI).optional(),
  /** shared-dependency versions this build was built against */
  shared: z.record(z.string(), z.string()).optional(),
});
export type WorkspaceVersionManifest = z.infer<typeof WorkspaceVersionManifestSchema>;

export interface VersionManifestInput {
  /** Omit: a per-build timestamp makes the same version id map to different
   * manifest bytes per machine, breaking the pin's SRI against the image's
   * staged copy and the CDN's immutability for republished versions. */
  builtAt?: string;
  gitSha?: string;
  entry: string;
  entryIntegrity: string;
  ssr?: { entry: string; integrity: string };
  browserManifest?: { file: string; integrity: string };
  assets?: Record<string, string>;
  shared?: Record<string, string>;
}

/**
 * Compose the manifest with its `version` derived from the canonical content
 * of the artifact coordinates alone (key-sorted, `builtAt` excluded) —
 * identical bytes → identical version id regardless of when they were built,
 * so republishing unchanged content is a pointer no-op. Any changed
 * coordinate → a new version (and a new file).
 */
export function composeVersionManifest(input: VersionManifestInput): WorkspaceVersionManifest {
  const { builtAt, ...hashedInputs } = input;
  const version = createHash("sha256")
    .update(stableStringify(hashedInputs))
    .digest("hex")
    .slice(0, 16);
  return WorkspaceVersionManifestSchema.parse({ ...input, version });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .sort()
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
