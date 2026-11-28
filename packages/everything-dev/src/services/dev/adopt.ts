import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The backend dev-generation plane's shared primitives (issue #942, stack/2b
 * on the reconciler — ADR 0049's plane split): both dev adopters — the dev
 * session's supervisor (child replacement) and the dev host's serving plane
 * (in-process plugin reload) — key adoption on the same built-dist
 * fingerprint and the same settle state machine.
 *
 * The generation identity is the CONTENT of the whole built dist, not
 * mtimes: a handler churn rewrites only the expose chunk
 * (`__federation_expose_plugin.js`), while the container bootstrap and the
 * MF manifest stay byte-identical — the churn harness's lesson, backend
 * shape. And mtime-only identity would adopt forever here: the supervisor's
 * child replacement runs one more full rspack build per adopt, and a no-op
 * rebuild rewrites byte-identical output (verified: two consecutive no-edit
 * builds hash identically). Content identity over the dist's JS files is
 * both loop-safe and strictly more precise — identical bytes ARE the same
 * generation, so there is nothing to adopt.
 */
/** The dev generation identity is the whole dist's JS content — see
 * `everything-dev/dev-adopt`. */

/** How often an adopter samples the watched workspaces. */
export const DEV_ADOPT_POLL_MS = 1_000;
/**
 * How long a new dist content must stay stable before it earns an adopt.
 * Deliberately longer than one rspack rebuild: a rebuild's PROGRESSIVE
 * states (old container + new expose chunk, etc.) are stable for over a
 * second, and adopting one means serving a half-rebuilt generation — and
 * the supervisor's replacement rebuilds again, making the next transient
 * another move. A settled tail past the rebuild's write window is what
 * makes "stable" mean "the build finished".
 */
export const DEV_ADOPT_SETTLE_MS = 3_000;

interface BuiltArtifactFingerprint {
  readonly mtimeMs: number;
  readonly content: string;
}

/** A sampled dist: every watched file's content hash plus the dist-wide
 * content digest (the generation identity). Null when the workspace has no
 * built container (mid-build wipe, not built yet). */
export interface BackendDistFingerprint {
  readonly digest: string;
  readonly newestMtimeMs: number;
  readonly files: ReadonlyMap<string, BuiltArtifactFingerprint>;
}

/** The dist files that carry a serving generation: top-level JS chunks and
 * the MF manifest. Source maps and type artifacts are not serving. */
const SERVING_FILE = (name: string): boolean =>
  (name.endsWith(".js") || name === "mf-manifest.json") && !name.endsWith(".map");

const hashContent = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);

export const fingerprintContentOf = (fingerprint: BackendDistFingerprint | null): string =>
  fingerprint?.digest ?? "missing";

/**
 * The dev freshness coordinate for a backend workspace, sampled with a
 * per-caller stat memo: only a changed (mtime, size) stat re-hashes the
 * file, so steady-state polling costs one directory read + N stats per
 * workspace. Returns null when the workspace has no built container.
 */
export const createBackendFingerprintSampler = (localPath: string) => {
  const memo = new Map<string, { statKey: string; content: string }>();
  return async (): Promise<BackendDistFingerprint | null> => {
    const distDir = path.join(localPath, "dist");
    let names: string[];
    try {
      names = (await readdir(distDir)).filter(SERVING_FILE).sort();
    } catch {
      return null;
    }
    if (!names.includes("remoteEntry.js")) return null;

    let newestMtimeMs = 0;
    const digest = createHash("sha256");
    const files = new Map<string, BuiltArtifactFingerprint>();
    const seen = new Set<string>();
    for (const name of names) {
      seen.add(name);
      const file = path.join(distDir, name);
      let statKey: string;
      let mtimeMs: number;
      try {
        const info = await stat(file);
        statKey = `${info.mtimeMs}:${info.size}`;
        mtimeMs = info.mtimeMs;
      } catch {
        continue;
      }
      newestMtimeMs = Math.max(newestMtimeMs, mtimeMs);
      const cached = memo.get(name);
      const content =
        cached && cached.statKey === statKey ? cached.content : hashContent(await readFile(file));
      memo.set(name, { statKey, content });
      files.set(name, { mtimeMs, content });
      digest.update(`${name}:${content}\n`);
    }
    for (const name of [...memo.keys()]) {
      if (!seen.has(name)) memo.delete(name);
    }
    return {
      digest: digest.digest("hex").slice(0, 32),
      newestMtimeMs,
      files,
    };
  };
};

/** One adopt decision: the unit moved to a new generation and the adopter
 * serves/replaces it. `generation` counts moves per unit — the boot build
 * is generation 0, the first adopted move is 1. */
interface AdoptMove {
  readonly key: string;
  readonly content: string;
  readonly generation: number;
}

interface AdoptServed {
  readonly content: string;
  readonly fingerprint: BackendDistFingerprint;
  readonly generation: number;
}

interface AdoptPending {
  readonly content: string;
  readonly firstSeenMs: number;
}

export interface AdoptState {
  readonly served: ReadonlyMap<string, AdoptServed>;
  readonly pending: ReadonlyMap<string, AdoptPending>;
}

export const initialAdoptState: AdoptState = {
  served: new Map(),
  pending: new Map(),
};

export interface AdoptObservation {
  readonly key: string;
  readonly fingerprint: BackendDistFingerprint | null;
}

interface AdvanceAdoptInput {
  readonly now: number;
  readonly settleMs: number;
  readonly observations: readonly AdoptObservation[];
}

/**
 * One settle step of the file-watcher state machine (issue #942): sample the
 * watched workspaces, and let a content change adopt only after it has been
 * stable for `settleMs` — rspack rewrites several dist files across a
 * window, and adopting mid-rebuild would serve a half-written generation.
 *
 * Per unit: a missing dist clears pending (nothing to adopt, the old
 * generation keeps serving); content equal to the served generation clears
 * pending (same generation); a new content enters/advances pending, and
 * pending settles into a move after `settleMs` of stability. A move updates
 * the served generation and increments the unit's counter — so an adoption
 * is owed exactly once per content change, and a failed adopt (the adopter
 * declines to commit) re-owes on the next step.
 */
export const advanceAdopt = (
  state: AdoptState,
  input: AdvanceAdoptInput,
): { state: AdoptState; moves: readonly AdoptMove[] } => {
  const served = new Map(state.served);
  const pending = new Map(state.pending);
  const moves: AdoptMove[] = [];

  for (const observation of input.observations) {
    const { key, fingerprint } = observation;
    const content = fingerprintContentOf(fingerprint);
    const current = served.get(key);

    if (!fingerprint || !current) {
      pending.delete(key);
      if (fingerprint && !current) {
        served.set(key, {
          content,
          fingerprint,
          generation: 0,
        });
      }
      continue;
    }

    if (current.content === content) {
      pending.delete(key);
      served.set(key, { ...current, fingerprint });
      continue;
    }

    const waiting = pending.get(key);
    if (!waiting || waiting.content !== content) {
      pending.set(key, { content, firstSeenMs: input.now });
      continue;
    }
    if (input.now - waiting.firstSeenMs < input.settleMs) continue;

    pending.delete(key);
    const generation = current.generation + 1;
    served.set(key, { content, fingerprint, generation });
    moves.push({ key, content, generation });
  }

  return { state: { served, pending }, moves };
};
