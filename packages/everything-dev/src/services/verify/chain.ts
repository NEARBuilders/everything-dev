import {
  WorkspaceVersionManifestSchema,
  type WorkspaceVersionManifest,
} from "every-plugin/version-manifest";
import type { BosConfigInput } from "../../types";
import { walkRemotes } from "../remotes";
import { manifestDocumentUrl } from "../deploy/manifest-verify";
import { ZodError } from "zod";
import { asDigest, fetchVerified, isVerifyError, verifyDocument } from "./engine";

export type ChainDepth = "pointer" | "entries" | "files";

interface PinnedRemoteRef {
  production?: unknown;
  digest?: { manifest?: unknown; integrity?: unknown };
}

export function collectPinnedRemotes(
  config: BosConfigInput,
): Array<{ remote: string; ref: PinnedRemoteRef }> {
  const remotes: Array<{ remote: string; ref: PinnedRemoteRef }> = [];
  walkRemotes(config as unknown as Record<string, unknown>, ({ remote, entry }) => {
    if (entry && typeof entry === "object") remotes.push({ remote, ref: entry as PinnedRemoteRef });
  });
  return remotes;
}

export function digestOf(ref: PinnedRemoteRef): { manifest: string; integrity: string } | null {
  const manifest = typeof ref.digest?.manifest === "string" ? ref.digest.manifest : undefined;
  const integrity = typeof ref.digest?.integrity === "string" ? ref.digest.integrity : undefined;
  return manifest && integrity ? { manifest, integrity } : null;
}

export interface RemoteDescriptor {
  remote: string;
  /** the remote's production base URL (…/bundles/<account>/<gateway>/<workspace>/) */
  base: string;
  digest: { manifest: string; integrity: string };
}

/** Every pinned remote with both a production base and a verifiable pin. */
export function collectRemoteDescriptors(config: BosConfigInput): RemoteDescriptor[] {
  return collectPinnedRemotes(config)
    .map(({ remote, ref }) => {
      const digest = digestOf(ref);
      const base = typeof ref.production === "string" ? ref.production : undefined;
      return digest && base ? { remote, base, digest } : null;
    })
    .filter((entry): entry is RemoteDescriptor => entry !== null);
}

export interface VerifyFileMismatch {
  file: string;
  expected: string;
  actual?: string;
  error?: string;
}

export interface VerifyRemoteResult {
  remote: string;
  base: string;
  manifest: string;
  manifestOk: boolean;
  manifestReason?: string;
  /** the immutable version directory the pin resolves into (absent on legacy pins) */
  dir?: string;
  legacy: boolean;
  filesChecked: number;
  mismatches: VerifyFileMismatch[];
}

export interface VerifyReport {
  remotes: VerifyRemoteResult[];
}

export interface ChainEntryResult {
  remote: string;
  url: string;
  ok: boolean;
  reason?: string;
}

export interface ChainVerifyResult {
  depth: ChainDepth;
  remotes: VerifyRemoteResult[];
  entries: ChainEntryResult[];
  ok: boolean;
}

const VERIFY_CONCURRENCY = 8;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const manifestLegReason = (error: unknown): string => {
  if (!isVerifyError(error)) return messageOf(error);
  if (error._tag === "IntegrityMismatch") {
    return `manifest SRI mismatch — pin ${error.expected}, served ${error.actual}`;
  }
  if (error._tag === "ProvenanceUnknown") {
    if (error.cause instanceof ZodError) return `manifest schema: ${error.cause.message}`;
    if (error.status !== undefined) return `manifest GET ${error.status}`;
    return `manifest fetch failed: ${messageOf(error.cause)}`;
  }
  return `manifest signature: ${error.reason}`;
};

const entryLegReason = (error: unknown): string => {
  if (!isVerifyError(error)) return messageOf(error);
  if (error._tag === "IntegrityMismatch") {
    return `entry SRI mismatch — pin ${error.expected}, served ${error.actual}`;
  }
  if (error._tag === "ProvenanceUnknown") {
    if (error.status !== undefined) return `entry GET ${error.status}`;
    return `entry fetch failed: ${messageOf(error.cause)}`;
  }
  return `entry signature: ${error.reason}`;
};

const fileBaseOf = (base: string, dir: string | undefined): string =>
  dir ? `${base.replace(/\/$/, "")}/${dir}` : base.replace(/\/$/, "");

async function walkRemotePin(
  descriptor: { remote: string; base: string; digest: { manifest: string; integrity: string } },
  depth: ChainDepth,
  fetchImpl: typeof fetch,
): Promise<{ remote: VerifyRemoteResult; entryResults: ChainEntryResult[] }> {
  const manifestUrl = manifestDocumentUrl(descriptor.base, descriptor.digest.manifest);
  const remote: VerifyRemoteResult = {
    remote: descriptor.remote,
    base: descriptor.base,
    manifest: descriptor.digest.manifest,
    manifestOk: false,
    legacy: true,
    filesChecked: 0,
    mismatches: [],
  };
  const entryResults: ChainEntryResult[] = [];

  let manifest: WorkspaceVersionManifest;
  try {
    manifest = await verifyDocument({
      url: manifestUrl,
      expected: asDigest(descriptor.digest.integrity),
      schema: WorkspaceVersionManifestSchema,
      fetchImpl,
      cache: false,
    });
  } catch (error) {
    remote.manifestReason = manifestLegReason(error);
    return { remote, entryResults };
  }

  remote.manifestOk = true;
  if (manifest.dir) {
    remote.dir = manifest.dir;
    remote.legacy = false;
  }
  const fileBase = fileBaseOf(descriptor.base, manifest.dir);

  if (depth === "entries") {
    const targets = [
      { url: `${fileBase}/${manifest.entry}`, integrity: manifest.entryIntegrity },
      ...(manifest.ssr
        ? [{ url: `${fileBase}/${manifest.ssr.entry}`, integrity: manifest.ssr.integrity }]
        : []),
    ];
    for (const target of targets) {
      try {
        await fetchVerified({
          url: target.url,
          expected: asDigest(target.integrity),
          fetchImpl,
          cache: false,
        });
        entryResults.push({ remote: descriptor.remote, url: target.url, ok: true });
      } catch (error) {
        entryResults.push({
          remote: descriptor.remote,
          url: target.url,
          ok: false,
          reason: entryLegReason(error),
        });
      }
    }
  }

  if (depth === "files") {
    const entries = Object.entries(manifest.files ?? {});
    remote.filesChecked = entries.length;

    const check = async ([path, expected]: [string, string]): Promise<VerifyFileMismatch | null> => {
      try {
        await fetchVerified({
          url: `${fileBase}/${path}`,
          expected: asDigest(expected),
          fetchImpl,
          cache: false,
        });
        return null;
      } catch (error) {
        if (isVerifyError(error)) {
          if (error._tag === "IntegrityMismatch") {
            return { file: path, expected, actual: error.actual };
          }
          if (error._tag === "ProvenanceUnknown") {
            return {
              file: path,
              expected,
              error: error.status !== undefined ? `GET ${error.status}` : messageOf(error.cause),
            };
          }
          return { file: path, expected, error: error.reason };
        }
        return { file: path, expected, error: messageOf(error) };
      }
    };

    const mismatches: VerifyFileMismatch[] = [];
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(VERIFY_CONCURRENCY, entries.length) },
      async () => {
        while (cursor < entries.length) {
          const entry = entries[cursor++];
          if (!entry) continue;
          const mismatch = await check(entry);
          if (mismatch) mismatches.push(mismatch);
        }
      },
    );
    await Promise.all(workers);
    remote.mismatches = mismatches.sort((a, b) => a.file.localeCompare(b.file));
  }

  return { remote, entryResults };
}

export async function verifyChain(input: {
  config: BosConfigInput;
  depth: ChainDepth;
  fetchImpl?: typeof fetch;
}): Promise<ChainVerifyResult> {
  const descriptors = collectRemoteDescriptors(input.config);
  const remotes: VerifyRemoteResult[] = [];
  const entries: ChainEntryResult[] = [];
  const fetchImpl = input.fetchImpl ?? fetch;
  for (const descriptor of descriptors) {
    const walk = await walkRemotePin(descriptor, input.depth, fetchImpl);
    remotes.push(walk.remote);
    entries.push(...walk.entryResults);
  }
  const ok =
    remotes.every((remote) => remote.manifestOk && remote.mismatches.length === 0) &&
    entries.every((entry) => entry.ok);
  return { depth: input.depth, remotes, entries, ok };
}

export function formatChainFailures(result: ChainVerifyResult): string {
  const lines: string[] = [];
  for (const remote of result.remotes) {
    if (!remote.manifestOk) {
      lines.push(`${remote.remote}: ${remote.manifestReason}`);
    }
    for (const mismatch of remote.mismatches) {
      const detail = mismatch.actual
        ? `expected ${mismatch.expected}, served ${mismatch.actual}`
        : (mismatch.error ?? "mismatch");
      lines.push(`${remote.remote}/${mismatch.file}: ${detail}`);
    }
  }
  for (const entry of result.entries) {
    if (!entry.ok) lines.push(`${entry.remote} entry: ${entry.url} — ${entry.reason}`);
  }
  return lines.join("\n");
}
