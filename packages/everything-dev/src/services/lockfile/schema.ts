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
 * entries that freeze nothing — so the stored pointer digest recomputes exactly
 * (the `pointerDigest` field ≡ `pointerDigest(config)` over the same config), and
 * JSON round-trips preserve that order.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BosConfig } from "../../types";
import { digestOfParts, pointerDigest } from "../registry/digest";
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
    schemaVersion: z.literal(2),
    kind: z.literal("everything-dev/composition-lockfile"),
    runtimeRef: z.string().regex(/^bos:\/\/[^/]+\/[^/]+$/),
    /** The release the composition resolves to; null when the runtime is
     * unpinned — the lockfile still freezes what channel resolution
     * returned. */
    release: z.string().min(1).nullable(),
    /** The frozen composition, in `walkRemotes` order (dotted config path →
     * coordinate). Order is load-bearing: the pointer digest recomputes from it. */
    remotes: z.record(z.string(), LockfileRemoteSchema),
    /** Shared-singleton versions the composition is verified against —
     * recorded when the sources provide them (remote plugin manifests, the
     * release manifest's `sharedDeps`); tightened as producers mature. */
    sharedSingletons: z.record(z.string(), z.string()).optional(),
    /** Per-remote contract hash (`plugin.manifest.json`'s
     * `contract.types.sha256`). */
    contracts: z.record(z.string(), z.string()).optional(),
    /** The template sync baseline (ADR 0047 — the absorbed
     * `.bos/sync-snapshot.json`): per-file template hashes recorded at
     * init/sync/import, read by `bos sync`'s three-way comparison. A local
     * annotation, never produced by `lockfileOf` — writers carry it forward
     * from the existing file, and it never enters the lockfile digest (the
     * digest answers "what exact composition was live"; the baseline is not
     * composition). */
    template: z
      .object({
        syncedAt: z.string().min(1),
        files: z.record(z.string(), z.string()),
      })
      .strict()
      .optional(),
    /** THE composition identity — equal to `pointerDigest(config)` by
     * construction (`lockfileOf`), recomputable from `remotes` alone
     * (`lockfilePointerDigest`). */
    pointerDigest: z.string().regex(/^[0-9a-f]{16}$/),
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

/** The load-side identity check: recompute the pointer digest from the
 * stored `remotes` record (insertion order — JSON round-trips preserve it)
 * and compare. A mismatch means the file was hand-edited or written by a
 * different digest implementation — refuse, loud. */
export function lockfilePointerDigest(lock: CompositionLockfile): string {
  const parts = Object.entries(lock.remotes).map(([remote, entry]) =>
    entry.kind === "pluginRef" ? `${remote}:${entry.ref}` : descriptorPart(remote, entry),
  );
  return digestOfParts(parts);
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
    schemaVersion: 2,
    kind: "everything-dev/composition-lockfile",
    runtimeRef: `bos://${input.account}/${input.gateway}`,
    release: input.release ?? null,
    remotes,
    ...(input.sharedSingletons ? { sharedSingletons: input.sharedSingletons } : {}),
    ...(input.contracts ? { contracts: input.contracts } : {}),
    pointerDigest: pointerDigest(input.config),
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  });
}

export function serializeLockfile(lock: CompositionLockfile): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** Writers carry the `template` annotation forward from the existing file:
 * `lockfileOf` never produces it, so a producer rewrite (`bos lock`, the
 * deploy train's persist leg) must not silently drop the sync baseline the
 * file already carries. A corrupt existing file degrades to a plain write. */
function carriedTemplate(lock: CompositionLockfile, existing: string | null): CompositionLockfile {
  if (!existing) return lock;
  try {
    const parsed = parseLockfile(existing);
    if (!parsed.template) return lock;
    return { ...lock, template: parsed.template };
  } catch {
    return lock;
  }
}

/** The lockfile's content digest — what a deployment record names when it
 * answers "what exact composition was live". Producers serialize `lockfileOf`
 * output, which never carries the `template` annotation, so the digest stays
 * a composition identity even when the on-disk file carries a baseline. */
export function digestOfLockfile(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

export function parseLockfile(bytes: string): CompositionLockfile {
  return CompositionLockfileSchema.parse(JSON.parse(bytes));
}

/** The sync producer for the deploy train (its publish path is sync-fs):
 * atomic temp + rename, parent dirs created. Carries the `template`
 * annotation forward from the existing file. */
export function writeLockfileSync(lock: CompositionLockfile, configDir?: string): string {
  const target = lockfilePath(configDir);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, serializeLockfile(carriedTemplate(lock, existing)));
  renameSync(temp, target);
  return target;
}

/** Absent or unparseable → null: the lockfile is an input, and a corrupt one
 * degrades the explainer's provenance rather than failing a build. */
export async function readLockfileIfExists(
  configDir?: string,
): Promise<CompositionLockfile | null> {
  try {
    return parseLockfile(await readFile(lockfilePath(configDir), "utf8"));
  } catch {
    return null;
  }
}

export interface LockWriteResult {
  status: "written" | "unchanged" | "drift";
  path: string;
  pointerDigest: string;
  /** The `--check` refusal reasons — empty unless status is "drift". */
  drift: string[];
}

/** The producer seam both writers share (`bos lock`, and the deploy train's
 * post-publish leg): freeze the resolved composition, atomically, with the
 * `--check` refusal the CI gate exits on. */
export async function writeLockfile(
  lock: CompositionLockfile,
  configDir?: string,
  opts?: { check?: boolean },
): Promise<LockWriteResult> {
  const target = lockfilePath(configDir);
  const existing = await readFile(target, "utf8").catch(() => null);
  const serialized = serializeLockfile(carriedTemplate(lock, existing));
  if (opts?.check) {
    if (existing === null) {
      return {
        status: "drift",
        path: target,
        pointerDigest: lock.pointerDigest,
        drift: ["bos.lock.json is missing — run `bos lock` and commit the result"],
      };
    }
    if (existing !== serialized) {
      return {
        status: "drift",
        path: target,
        pointerDigest: lock.pointerDigest,
        drift: [
          "bos.lock.json differs from the resolved composition — run `bos lock` and commit the result",
        ],
      };
    }
    return { status: "unchanged", path: target, pointerDigest: lock.pointerDigest, drift: [] };
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await writeFile(temp, serialized);
  await rename(temp, target);
  return {
    status: existing === serialized ? "unchanged" : "written",
    path: target,
    pointerDigest: lock.pointerDigest,
    drift: [],
  };
}
