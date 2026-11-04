/**
 * The approved boot snapshot's wire schema (ADR 0041) — a leaf module so the
 * host's snapshot coordinator (write on adopt), the boot path (degraded load),
 * and the CLI verification tools (`bos smoke`, the sentinel) can all import it
 * without a cycle. The snapshot is the persisted, verified serving state: the
 * composition this host last adopted, stored so a restart can serve it during
 * a registry/CDN outage. The bundle cache (`registry/bundle-cache.ts`) is the
 * bytes-plane equivalent; the two never share a root (plan 043 — cached bytes
 * are a resilience artifact, never a deployment, and the same line holds for
 * the snapshot: it authorizes restarts of an already-approved generation, it
 * never activates a new one).
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type BosConfig, BosConfigSchema } from "../../types";
import { pointerFingerprint } from "../registry/fingerprint";
import { parseRuntimeRef } from "../registry/keys";
import { walkRemotes } from "../remotes";

/** The immutable descriptor a pinned remote composes — the release manifest's
 * `remotes:` entry shape (ADR 0040), reused verbatim: one vocabulary for the
 * same bytes. */
export const RemoteDigestSchema = z.object({
  base: z.string().min(1),
  digest: z.object({
    manifest: z.string().min(1),
    integrity: z.string().min(1),
  }),
});
export type RemoteDigest = z.infer<typeof RemoteDigestSchema>;

export const BootSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("everything-dev/boot-snapshot"),
    runtimeRef: z.string().regex(/^bos:\/\/[^/]+\/[^/]+$/),
    /** The manifest tag `{version, digest}` that authorized the generation —
     * null when the generation came from a registry config resolution that
     * read no release tag. Authorization facts come from the tag + version
     * record chain (ADR 0040). */
    manifestTag: z.object({ version: z.string().min(1), digest: z.string().min(1) }).nullable(),
    /** Hash over every remote coordinate of the stored config
     * (`pointerFingerprint`). The loader recomputes it from `config` and
     * refuses a mismatch — the file's own integrity check, independent of the
     * registry. */
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    /** The resolved published config the generation served. The loader parses
     * it (`BosConfigSchema`) and re-derives the runtime config
     * deterministically — env-derived fields are never persisted. */
    config: BosConfigSchema,
    /** Per-remote digest map mirrored from the config at write time (dotted
     * config path → descriptor), for verification and tooling. */
    remotes: z.record(z.string(), RemoteDigestSchema),
    /** The registry deploy record (`deploys/<ts>.json` key) naming the publish
     * that produced the generation. */
    deployRecordKey: z.string().nullable(),
    /** The composition lockfile's content digest (ADR 0042 ticket 04) — the
     * control-plane staging stamp (ADR 0043): the identity that ties this
     * approved generation to the deployment record that named it. */
    lockfileDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    writtenAt: z.string().min(1),
  })
  .strict();
export type BootSnapshot = z.infer<typeof BootSnapshotSchema>;

export function snapshotRoot(input?: { dir?: string }): string {
  return path.resolve(
    input?.dir ?? process.env.BOS_SNAPSHOT_DIR ?? path.join(process.cwd(), ".bos", "snapshot"),
  );
}

export function snapshotPath(account: string, gateway: string, input?: { dir?: string }): string {
  return path.join(snapshotRoot(input), account, `${gateway}.json`);
}

function pinnedRemotesOf(config: BosConfig): Record<string, RemoteDigest> {
  const remotes: Record<string, RemoteDigest> = {};
  walkRemotes(config as unknown as Record<string, unknown>, ({ remote, entry }) => {
    if (!entry || typeof entry !== "object") return;
    const ref = entry as {
      production?: unknown;
      digest?: { manifest?: unknown; integrity?: unknown };
    };
    const base = typeof ref.production === "string" ? ref.production : undefined;
    const manifest = typeof ref.digest?.manifest === "string" ? ref.digest.manifest : undefined;
    const integrity = typeof ref.digest?.integrity === "string" ? ref.digest.integrity : undefined;
    if (base && manifest && integrity) {
      remotes[remote] = { base, digest: { manifest, integrity } };
    }
  });
  return remotes;
}

export function bootSnapshotOf(input: {
  account: string;
  gateway: string;
  config: BosConfig;
  manifestTag?: { version: string; digest: string } | null;
  deployRecordKey?: string | null;
  lockfileDigest?: string;
  writtenAt?: string;
}): BootSnapshot {
  return BootSnapshotSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/boot-snapshot",
    runtimeRef: `bos://${input.account}/${input.gateway}`,
    manifestTag: input.manifestTag ?? null,
    fingerprint: pointerFingerprint(input.config),
    config: input.config,
    remotes: pinnedRemotesOf(input.config),
    deployRecordKey: input.deployRecordKey ?? null,
    ...(input.lockfileDigest ? { lockfileDigest: input.lockfileDigest } : {}),
    writtenAt: input.writtenAt ?? new Date().toISOString(),
  });
}

/** The load-side integrity check: recompute the fingerprint from the stored
 * config and compare. A mismatch means the file was hand-edited or written by
 * a different fingerprint implementation — refuse, loud. */
export function snapshotFingerprintMatches(snapshot: BootSnapshot): boolean {
  return pointerFingerprint(snapshot.config) === snapshot.fingerprint;
}

export function serializeBootSnapshot(snapshot: BootSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function parseBootSnapshot(bytes: string): BootSnapshot {
  return BootSnapshotSchema.parse(JSON.parse(bytes));
}

/** Atomic persist (temp + rename) — a reader never observes a partial write.
 * The account/gateway always derive from the snapshot's runtime ref. */
export async function writeBootSnapshot(
  snapshot: BootSnapshot,
  input?: { dir?: string },
): Promise<string> {
  const { accountId, gatewayId } = parseRuntimeRef(snapshot.runtimeRef);
  const target = snapshotPath(accountId, gatewayId, input);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await writeFile(temp, serializeBootSnapshot(snapshot));
  await rename(temp, target);
  return target;
}
