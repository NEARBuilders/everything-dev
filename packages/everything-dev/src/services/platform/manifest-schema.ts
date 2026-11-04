/**
 * The platform release manifest's wire schema (ADR 0034) — a leaf module so
 * the registry's resolution machine and the manifest's composer can both
 * import it without a cycle. The composer, inventory, compat gate, and
 * resolution machine live in `platform/manifest.ts` and
 * `registry/resolution.ts` respectively; this file holds only the schema.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** The release that cut the registry wire over (ticket 10): extends targets
 * still publishing the pre-cutover composition must redeploy on this
 * version or newer — resolution rejects their tags with exactly that
 * instruction. */
export const CUTOVER_RELEASE = "2.0.0-rc.37";

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("everything-dev/platform-manifest"),
  frameworkVersion: z.string().min(1),
  everyPluginVersion: z.string().min(1),
  /** The serving build's repo HEAD (full sha) — omitted when the compose
   * context has no git (regression image builds, build-arg-less builds). */
  gitSha: z.string().min(7).optional(),
  image: z.object({
    ref: z.string().min(1),
    tags: z.array(z.string().min(1)),
  }),
  catalog: z.record(z.string(), z.string()),
  sharedDeps: z.record(
    z.string(),
    z.object({
      version: z.string(),
      requiredVersion: z.union([z.string(), z.boolean()]),
      singleton: z.boolean(),
      eager: z.boolean(),
      strictVersion: z.boolean(),
      shareScope: z.string(),
    }),
  ),
  templateInventory: z.array(
    z.object({
      path: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
  compat: z.object({ minChild: z.string().min(1) }),
  /**
   * The release's remote-record map (ADR 0034 amendment — release-scoped
   * extends inheritance): each entry records the immutable descriptor the
   * release published for a config remote (dotted config path, e.g.
   * `app.auth`, `app.auth.ui`, `plugins.votes.ui`) — children authored to
   * this release re-point inherited remotes at THESE bytes instead of the
   * parent's live config whenever the parent publishes. Optional: releases
   * composed before the field carry no remotes, and old readers strip
   * unknown keys.
   */
  remotes: z
    .record(
      z.string(),
      z.object({
        base: z.string().min(1),
        digest: z.object({
          manifest: z.string().min(1),
          integrity: z.string().min(1),
        }),
      }),
    )
    .optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** The thin tag — the manifest.json home carries `{ schemaVersion, version,
 * digest }` and nothing else; the full manifest lives at the immutable
 * `versions/<v>.json` and the digest pins its exact bytes. */
export const ManifestTagSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  digest: z.string().min(1),
});
export type ManifestTag = z.infer<typeof ManifestTagSchema>;

/** The digest of a manifest's serialized bytes — the train hashes the exact
 * string it publishes; the resolution machine re-serializes the fetched
 * record and verifies (JSON preserves key order, so the bytes round-trip). */
export function digestOfManifest(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

/** The thin tag for a composed manifest, over its serialized record bytes. */
export function manifestTagOf(manifest: Manifest, serialized: string): ManifestTag {
  return {
    schemaVersion: 1,
    version: manifest.frameworkVersion,
    digest: digestOfManifest(serialized),
  };
}
