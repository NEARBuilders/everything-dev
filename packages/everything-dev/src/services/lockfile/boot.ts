/**
 * The boot-side lockfile application (ADR 0042 ticket 03): when a runtime
 * boots with a `bos.lock.json` present, the frozen composition is the
 * authority for remote coordinates — frozen descriptors stamp over the
 * resolved config (filling missing pins, overriding drifted ones), and every
 * disagreement is reported to the caller. The boot never fails BECAUSE of the
 * lockfile: reproducibility wins silently-when-agreeing, loudly-when-not
 * (the warnings ride the start summary), while `bos lock --check` in CI is
 * the gate that keeps the committed lockfile fresh.
 */
import type { BosConfig } from "../../types";
import type { CompositionLockfile } from "./schema";

export interface LockfileDrift {
  path: string;
  detail: string;
}

export interface LockfileApplication {
  config: BosConfig;
  /** Dotted paths where the frozen descriptor was stamped — the resolved
   * remote had no pin of its own. */
  applied: string[];
  /** Dotted paths where the serving composition disagreed with the frozen
   * one — the frozen composition wins, the disagreement is reported. */
  drift: LockfileDrift[];
}

function segmentsOf(remotePath: string): string[] {
  return remotePath.split(".");
}

function entryAt(root: Record<string, unknown>, segments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Clone-and-set along the path: untouched branches keep their identity. */
function setIn(
  root: Record<string, unknown>,
  segments: string[],
  value: unknown,
): Record<string, unknown> {
  if (segments.length === 0) return root;
  const clone: Record<string, unknown> = { ...root };
  const [head, ...rest] = segments;
  const headKey = head!;
  if (rest.length === 0) {
    clone[headKey] = value;
    return clone;
  }
  const child = root[headKey];
  clone[headKey] =
    child && typeof child === "object"
      ? setIn(child as Record<string, unknown>, rest, value)
      : setIn({}, rest, value);
  return clone;
}

export function applyCompositionLockfile(
  config: BosConfig,
  lockfile: CompositionLockfile,
): LockfileApplication {
  const applied: string[] = [];
  const drift: LockfileDrift[] = [];
  let working: Record<string, unknown> = config as unknown as Record<string, unknown>;
  let mutated = false;

  const runtimeRef = `bos://${config.account}/${config.domain}`;
  if (lockfile.runtimeRef !== runtimeRef) {
    return {
      config,
      applied,
      drift: [
        {
          path: "*",
          detail: `the lockfile freezes ${lockfile.runtimeRef}, not this runtime (${runtimeRef}) — not applied`,
        },
      ],
    };
  }

  for (const [remotePath, entry] of Object.entries(lockfile.remotes)) {
    const segments = segmentsOf(remotePath);
    const current = entryAt(working, segments);
    if (entry.kind === "pluginRef") {
      if (typeof current === "string") {
        if (current !== entry.ref) {
          drift.push({
            path: remotePath,
            detail: `plugin ref ${current} differs from the frozen ${entry.ref}`,
          });
          working = setIn(working, segments, entry.ref);
          mutated = true;
        }
        continue;
      }
      drift.push({
        path: remotePath,
        detail: `the lockfile freezes a bare plugin ref but the resolved composition carries an entry`,
      });
      continue;
    }

    if (!current || typeof current !== "object") {
      drift.push({
        path: remotePath,
        detail: "the resolved composition no longer carries this remote — run `bos lock`",
      });
      continue;
    }
    const ref = current as {
      production?: unknown;
      digest?: { manifest?: unknown; integrity?: unknown };
    };
    const frozenDigest =
      entry.digest && typeof entry.digest.manifest === "string" ? entry.digest.manifest : undefined;
    const servingDigest =
      typeof ref.digest?.manifest === "string" ? ref.digest.manifest : undefined;
    if (!frozenDigest) continue;
    if (servingDigest && servingDigest === frozenDigest) continue;
    if (servingDigest) {
      drift.push({
        path: remotePath,
        detail: `serving ${servingDigest} differs from the frozen ${frozenDigest}`,
      });
    } else {
      applied.push(remotePath);
    }
    const base = entry.base ?? (typeof ref.production === "string" ? ref.production : undefined);
    const stamped: Record<string, unknown> = { ...ref };
    if (base) stamped.production = base;
    if (entry.digest) stamped.digest = entry.digest;
    working = setIn(working, segments, stamped);
    mutated = true;
  }

  return {
    config: mutated ? (working as unknown as BosConfig) : config,
    applied,
    drift,
  };
}
