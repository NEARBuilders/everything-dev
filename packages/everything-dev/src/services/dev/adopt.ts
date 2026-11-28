import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The backend dev-generation plane's shared primitives (issue #942, stack/2b
 * on the reconciler — ADR 0049's plane split): both dev adopters — the dev
 * session's supervisor (child replacement) and the dev host's serving plane
 * (in-process plugin reload) — key adoption on the same built-dist
 * fingerprint and the same settle state machine.
 *
 * The generation identity is the CONTENT of the built container and the
 * built manifest, not their mtimes. ADR 0049's mtime lesson is the UI
 * plane's (rsbuild skips rewriting a byte-identical SSR container, so the
 * host busters the URL with the mtime). Backend plugin dists are the other
 * shape: `rspack build --watch` rewrites byte-identical output on every
 * rebuild (verified: two consecutive no-edit builds hash identically), and
 * the supervisor's child replacement runs one more full build on every
 * adopt — an mtime fingerprint would adopt its own no-op rebuild forever.
 * Content identity is loop-safe and strictly more precise: identical bytes
 * ARE the same generation, so there is nothing to adopt.
 */
/** How often an adopter samples the watched workspaces. */
export const DEV_ADOPT_POLL_MS = 1_000;
/** How long a new dist content must stay stable before it earns an adopt —
 * rspack rewrites several dist files across a rebuild window, and adopting
 * mid-rebuild would load a half-written generation. */
export const DEV_ADOPT_SETTLE_MS = 1_000;

export interface BuiltArtifactFingerprint {
  readonly mtimeMs: number;
  readonly content: string;
}

export interface BackendDistFingerprint {
  /** The built container the dev server loads — `dist/remoteEntry.js`.
   * Null when the dist has no container (mid-build wipe, not built yet). */
  readonly container: BuiltArtifactFingerprint | null;
  /** The built manifest — `dist/mf-manifest.json`. Null when absent. */
  readonly manifest: BuiltArtifactFingerprint | null;
}

const hashContent = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);

export const fingerprintContentOf = (fingerprint: BackendDistFingerprint | null): string =>
  fingerprint === null
    ? "missing"
    : `${fingerprint.container?.content ?? "missing"}:${fingerprint.manifest?.content ?? "missing"}`;

export const fingerprintDebugOf = (fingerprint: BackendDistFingerprint | null): string =>
  fingerprint === null
    ? "missing"
    : `${fingerprint.container?.mtimeMs ?? -1}:${fingerprint.manifest?.mtimeMs ?? -1} ${fingerprintContentOf(fingerprint)}`;

const artifactFingerprint = async (
  file: string,
  memo: { statKey: string; content: string } | undefined,
): Promise<{ statKey: string; content: string } | undefined> => {
  try {
    const info = await stat(file);
    const statKey = `${info.mtimeMs}:${info.size}`;
    if (memo && memo.statKey === statKey) return memo;
    const content = hashContent(await readFile(file));
    return { statKey, content };
  } catch {
    return undefined;
  }
};

/**
 * The ADR 0049 dev freshness coordinate for a backend workspace, sampled
 * with a per-caller stat memo: only a changed (mtime, size) stat re-hashes
 * the file, so steady-state polling costs two stats per workspace. Returns
 * null when the workspace has no built container.
 */
export const createBackendFingerprintSampler = (localPath: string) => {
  let container: { statKey: string; content: string } | undefined;
  let manifest: { statKey: string; content: string } | undefined;
  return async (): Promise<BackendDistFingerprint | null> => {
    const distDir = path.join(localPath, "dist");
    const nextContainer = await artifactFingerprint(
      path.join(distDir, "remoteEntry.js"),
      container,
    );
    const nextManifest = await artifactFingerprint(
      path.join(distDir, "mf-manifest.json"),
      manifest,
    );
    if (!nextContainer) return null;
    container = nextContainer;
    manifest = nextManifest;
    return {
      container: { mtimeMs: Number(container.statKey.split(":")[0]), content: container.content },
      manifest: manifest
        ? { mtimeMs: Number(manifest.statKey.split(":")[0]), content: manifest.content }
        : null,
    };
  };
};

/** One adopt decision: the unit moved to a new generation and the adopter
 * serves/replaces it. `generation` counts moves per unit — the boot build
 * is generation 0, the first adopted move is 1. */
export interface AdoptMove {
  readonly key: string;
  readonly content: string;
  readonly generation: number;
}

export interface AdoptServed {
  readonly content: string;
  readonly fingerprint: BackendDistFingerprint;
  readonly generation: number;
}

export interface AdoptPending {
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

export interface AdvanceAdoptInput {
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
