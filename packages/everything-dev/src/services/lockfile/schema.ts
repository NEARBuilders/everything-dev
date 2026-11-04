/**
 * The composition lockfile's wire schema (ADR 0042) — a leaf module so the
 * producers (`bos lock`, the deploy train), the boot consumer, and the
 * runtime-map generator can all import it without a cycle. The lockfile
 * freezes one runtime's exact composition: what the author wants
 * (`bos.app.ts`) resolved to named bytes. The pinned descriptor's `{base,
 * digest}` shape is deliberately the release manifest's `remotes:` entry shape
 * (ADR 0040) — one vocabulary for the same bytes; the scope differs (the
 * platform's per-release memory of inherited slots vs this app's frozen
 * whole). The `remotes` record is written in `walkRemotes` order — including
 * entries that freeze nothing — so the stored fingerprint recomputes exactly
 * (`lockfileFingerprint` ≡ `pointerFingerprint` over the same config), and
 * JSON round-trips preserve that order.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { BosConfig } from "../../types";
import { pointerFingerprint } from "../registry/fingerprint";
import { walkRemotes } from "../remotes";

export const LOCKFILE_NAME = "bos.lock.json";

/** A frozen remote coordinate. `descriptor` mirrors the release manifest's
 * remote entry — `digest` (the immutable manifest pointer), a direct entry
 * `integrity` (digest-less fixed-name remotes), and the `base` they resolve
 * against; fields are individually optional because the freeze is faithful to
 * what the config carries, not to what a producer wishes it carried.
 * `pluginRef` freezes a bare plugin reference (`plugins.<id>: "<key>"`). */
export const LockfileRemoteSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("descriptor"),
      base: z.string().min(1).optional(),
      digest: z.object({ manifest: z.string().min(1), integrity: z.string().min(1) }).optional(),
      integrity: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pluginRef"),
      ref: z.string().min(1),
    })
    .strict(),
]);
export type LockfileRemote = z.infer<typeof LockfileRemoteSchema>;

export const CompositionLockfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("everything-dev/composition-lockfile"),
    runtimeRef: z.string().regex(/^bos:\/\/[^/]+\/[^/]+$/),
    /** The release the composition resolves to; null when the runtime is
     * unpinned — the lockfile still freezes what channel resolution
     * returned. */
    release: z.string().min(1).nullable(),
    /** The frozen composition, in `walkRemotes` order (dotted config path →
     * coordinate). Order is load-bearing: the fingerprint recomputes from it. */
    remotes: z.record(z.string(), LockfileRemoteSchema),
    /** Shared-singleton versions the composition is verified against —
     * recorded when the sources provide them (remote plugin manifests, the
     * release manifest's `sharedDeps`); tightened as producers mature. */
    sharedSingletons: z.record(z.string(), z.string()).optional(),
    /** Per-remote contract hash (`plugin.manifest.json`'s
     * `contract.types.sha256`). */
    contracts: z.record(z.string(), z.string()).optional(),
    /** THE composition identity — equal to `pointerFingerprint(config)` by
     * construction (`lockfileOf`), recomputable from `remotes` alone
     * (`lockfileFingerprint`). */
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    resolvedAt: z.string().min(1),
  })
  .strict();
export type CompositionLockfile = z.infer<typeof CompositionLockfileSchema>;

export function lockfilePath(configDir: string = process.cwd()): string {
  return path.join(configDir, LOCKFILE_NAME);
}

function descriptorPart(
  remote: string,
  entry: Extract<LockfileRemote, { kind: "descriptor" }>,
): string {
  const digestPart = entry.digest ? `${entry.digest.manifest}:${entry.digest.integrity}` : "";
  const directPart = entry.integrity ?? "";
  return `${remote}:${digestPart}:${directPart}`;
}

/** The load-side identity check: recompute the fingerprint from the stored
 * `remotes` record (insertion order — JSON round-trips preserve it) and
 * compare. A mismatch means the file was hand-edited or written by a
 * different fingerprint implementation — refuse, loud. */
export function lockfileFingerprint(lock: CompositionLockfile): string {
  const parts = Object.entries(lock.remotes).map(([remote, entry]) =>
    entry.kind === "pluginRef" ? `${remote}:${entry.ref}` : descriptorPart(remote, entry),
  );
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function lockfileOf(input: {
  account: string;
  gateway: string;
  config: BosConfig;
  release?: string | null;
  sharedSingletons?: Record<string, string>;
  contracts?: Record<string, string>;
  resolvedAt?: string;
}): CompositionLockfile {
  const remotes: Record<string, LockfileRemote> = {};
  walkRemotes(
    input.config as unknown as Record<string, unknown>,
    ({ remote, entry, isPluginRef }) => {
      if (isPluginRef) {
        remotes[remote] = { kind: "pluginRef", ref: entry as string };
        return;
      }
      if (!entry || typeof entry !== "object") return;
      const ref = entry as {
        production?: unknown;
        integrity?: unknown;
        digest?: { manifest?: unknown; integrity?: unknown };
      };
      const base = typeof ref.production === "string" ? ref.production : undefined;
      const digest =
        ref.digest &&
        typeof ref.digest.manifest === "string" &&
        typeof ref.digest.integrity === "string"
          ? { manifest: ref.digest.manifest, integrity: ref.digest.integrity }
          : undefined;
      const integrity = typeof ref.integrity === "string" ? ref.integrity : undefined;
      remotes[remote] = {
        kind: "descriptor",
        ...(base ? { base } : {}),
        ...(digest ? { digest } : {}),
        ...(integrity ? { integrity } : {}),
      };
    },
  );
  return CompositionLockfileSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/composition-lockfile",
    runtimeRef: `bos://${input.account}/${input.gateway}`,
    release: input.release ?? null,
    remotes,
    ...(input.sharedSingletons ? { sharedSingletons: input.sharedSingletons } : {}),
    ...(input.contracts ? { contracts: input.contracts } : {}),
    fingerprint: pointerFingerprint(input.config),
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  });
}

export function serializeLockfile(lock: CompositionLockfile): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function parseLockfile(bytes: string): CompositionLockfile {
  return CompositionLockfileSchema.parse(JSON.parse(bytes));
}
