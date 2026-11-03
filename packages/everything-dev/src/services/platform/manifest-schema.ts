/**
 * The platform release manifest's wire schema (ADR 0034) — a leaf module so
 * the registry's resolution machine and the manifest's composer can both
 * import it without a cycle. The composer, inventory, compat gate, and
 * resolution machine live in `platform/manifest.ts` and
 * `registry/resolution.ts` respectively; this file holds only the schema.
 */
import { z } from "zod";

export const PlatformReleaseManifestSchema = z.object({
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
   * The release's own slot-pin map (ADR 0034 amendment — release-scoped
   * extends inheritance): each entry records the immutable version-manifest
   * pointer the release published for a config slot (dotted config path, e.g.
   * `app.auth`, `app.auth.ui`, `plugins.votes.ui`) — the son of the store, so
   * children pinned to this release can re-point inherited slots at THESE
   * bytes instead of the parent's live config whenever the parent publishes.
   * Optional: releases composed before the field carry no slots, and old
   * readers strip unknown keys.
   */
  slots: z
    .record(
      z.string(),
      z.object({
        base: z.string().min(1),
        pin: z.object({
          manifest: z.string().min(1),
          integrity: z.string().min(1),
        }),
      }),
    )
    .optional(),
});
export type PlatformReleaseManifest = z.infer<typeof PlatformReleaseManifestSchema>;
