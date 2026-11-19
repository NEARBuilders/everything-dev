/**
 * The per-deploy audit record's wire schema (ADR 0040): every publish writes
 * `apps/<account>/<gateway>/deploys/<ts>.json` atomically with the tag swap,
 * and this module is the one derivation of its shape and path forms — the
 * train composes its writes through the schema, and every reader parses
 * through it, so a wire change fails both ends at once.
 */
import { z } from "zod";

/** The release pointer a deploy put in force — `manifest.json`'s thin tag
 * home, its integrity, and the immutable `versions/<v>.json` record home
 * with its integrity. Absent on non-release deploys: only a release leg
 * writes manifest keys. */
export const PlatformManifestPinSchema = z.object({
  version: z.string().min(1),
  tag: z.string().min(1),
  tagIntegrity: z.string().min(1),
  record: z.string().min(1),
  integrity: z.string().min(1),
});
export type PlatformManifestPin = z.infer<typeof PlatformManifestPinSchema>;

/** The composition lockfile's digests at publish time (ADR 0042 ticket 04) —
 * provenance, never a gate. */
export const DeployRecordLockfileSchema = z.object({
  digest: z.string().min(1),
  pointerDigest: z.string().min(1),
});
export type DeployRecordLockfile = z.infer<typeof DeployRecordLockfileSchema>;

export const DeployRecordSchema = z.object({
  account: z.string().min(1),
  gateway: z.string().min(1),
  network: z.string().min(1),
  publishedAt: z.string().min(1),
  registryUrl: z.string().min(1),
  lockfile: DeployRecordLockfileSchema.optional(),
  platformManifest: PlatformManifestPinSchema.optional(),
});
export type DeployRecord = z.infer<typeof DeployRecordSchema>;

/** A record timestamp's FastKV-safe path form (`:` and `.` are not path-safe
 * in the key family) — the train derives the record key with this and the
 * history readers re-derive it for keyless entries, so the munge lives here
 * and nowhere else. */
export function deployRecordTsOf(publishedAt: string): string {
  return publishedAt.replace(/[:.]/g, "-");
}
