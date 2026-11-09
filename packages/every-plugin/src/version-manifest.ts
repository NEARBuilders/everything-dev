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

/** Slot-relative directory holding one deploy's immutable file copies (#826). */
export const VERSION_DIR_PATTERN = /^versions\/[0-9a-f]{16}$/;

export const WorkspaceVersionManifestSchema = z.object({
  version: z.string().regex(/^[0-9a-f]{16}$/),
  builtAt: z.string().optional(),
  gitSha: z.string().optional(),
  /**
   * Slot-relative directory (`versions/<dirId>`) holding this deploy's
   * byte-immutable copies of every dist file (#826). When present, all
   * artifact coordinates below resolve against `<slotBase>/<dir>/` — so a
   * pinned child's entry fetches its expose chunk and chunks from the same
   * frozen directory instead of the mutable slot root. Absent on legacy
   * manifests: coordinates resolve against the slot root exactly as before.
   * Derived from the `files` map (see `versionDirPath`), so it participates
   * in the version hash without circularity.
   */
  dir: z.string().regex(VERSION_DIR_PATTERN).optional(),
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
  /**
   * Full per-file digest map of the dist (object path → served-object SRI).
   * Written by `every-plugin`-based deploys so the next deploy can diff against
   * it and skip re-uploading unchanged files; readers that predate the field
   * ignore it (zod strips unknown keys). Participates in the version hash.
   */
  files: z.record(z.string(), SRI).optional(),
  /**
   * Source archive of the workspace subtree (object path → served-object SRI)
   * published beside the dists when the runtime opts in via
   * `publish.sourcePublish` — lets `bos import` dereference a published
   * config slot to the exact source bytes that build came from, with no
   * GitHub dependency. Readers that predate the field ignore it (zod strips
   * unknown keys). Participates in the version hash.
   */
  source: z
    .object({
      file: z.string().min(1),
      integrity: SRI,
    })
    .optional(),
});
export type WorkspaceVersionManifest = z.infer<typeof WorkspaceVersionManifestSchema>;

/** A published-artifact coordinate: object path within the bundle namespace + its served SRI. */
export type SourceRef = NonNullable<WorkspaceVersionManifest["source"]>;

export interface VersionManifestInput {
  /** Omit: a per-build timestamp makes the same version id map to different
   * manifest bytes per machine, breaking the pin's SRI against the image's
   * staged copy and the CDN's immutability for republished versions. */
  builtAt?: string;
  gitSha?: string;
  dir?: string;
  entry: string;
  entryIntegrity: string;
  ssr?: { entry: string; integrity: string };
  browserManifest?: { file: string; integrity: string };
  assets?: Record<string, string>;
  shared?: Record<string, string>;
  files?: Record<string, string>;
  source?: { file: string; integrity: string };
}

/**
 * Compose the manifest with its `version` derived from the canonical content
 * of the artifact coordinates alone (key-sorted, `builtAt` excluded) —
 * identical bytes → identical version id regardless of when they were built,
 * so republishing unchanged content is a pointer no-op. Any changed
 * coordinate → a new version (and a new file).
 */
export function composeVersionManifest(input: VersionManifestInput): WorkspaceVersionManifest {
  const { builtAt: _builtAt, ...hashedInputs } = input;
  const version = createHash("sha256")
    .update(stableStringify(hashedInputs))
    .digest("hex")
    .slice(0, 16);
  return WorkspaceVersionManifestSchema.parse({ ...input, version });
}

/**
 * The content-addressed directory name for one dist's file set (#826): a
 * 16-hex hash over the canonical files map. Identical bytes → identical
 * directory → re-deploying unchanged content is a server-side no-op, and a
 * published pin's directory can never be rewritten by a later deploy
 * (the upload service refuses conflicting writes under `versions/`).
 */
export function versionDirPath(files: Record<string, string>): string {
  const id = createHash("sha256").update(stableStringify(files)).digest("hex").slice(0, 16);
  return `versions/${id}`;
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
