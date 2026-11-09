import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path, { join } from "node:path";
import { type BuildEntryReport, BuildEntryReportSchema } from "every-plugin/build/artifact-names";
import {
  composeVersionManifest,
  type SourceRef,
  type WorkspaceVersionManifest,
  WorkspaceVersionManifestSchema,
} from "every-plugin/version-manifest";
import { bundleUrlToStagedPath, resolveContained } from "../resolution/resolver";
import {
  asDigest,
  clearVerifiedCache,
  mark,
  type Verified,
  verifyDocument,
} from "../verify/engine";
import { manifestDocumentUrl, reasonOf } from "./manifest-verify";

/** Read a workspace dist's build-report.json (ticket 01's entry-name report). */
export function readBuildReport(distRoot: string): BuildEntryReport | null {
  const reportPath = join(distRoot, "build-report.json");
  if (!existsSync(reportPath)) return null;
  try {
    return BuildEntryReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Compose the workspace's version manifest from the dist build reports and
 * the **server-computed** SRI map of the upload response (MAP decision 6 —
 * SRI is authoritative from the storage boundary, never computed
 * client-side). Returns null when the dist predates hashed entry names
 * (no report, or the SRI map lacks the entry) — the deploy leg then aborts:
 * uploaded workspaces must pin.
 */
export function composeWorkspaceVersionManifest(input: {
  report: BuildEntryReport;
  ssrReport?: BuildEntryReport | null;
  integrityMap: Record<string, string>;
  /** full per-file SRI map of the dist — recorded for the next deploy's diff */
  files?: Record<string, string>;
  /** slot-relative immutable version directory (`versions/<dirId>`, #826) —
   * artifact coordinates resolve against it instead of the slot root */
  dir?: string;
  /** source archive reference (publish.sourcePublish) — server-computed SRI */
  source?: SourceRef;
  /** the repo HEAD the build was produced from — best-effort, may be absent */
  gitSha?: string;
}): WorkspaceVersionManifest | null {
  const { report, ssrReport, integrityMap, files, dir, source, gitSha } = input;

  const entryIntegrity = integrityMap[report.entry];
  if (!entryIntegrity) return null;

  const ssrEntry = ssrReport?.entry;
  const ssrIntegrity = ssrEntry ? integrityMap[`ssr/${ssrEntry}`] : undefined;

  return composeVersionManifest({
    ...(dir ? { dir } : {}),
    entry: report.entry,
    entryIntegrity,
    ...(ssrEntry && ssrIntegrity
      ? { ssr: { entry: `ssr/${ssrEntry}`, integrity: ssrIntegrity } }
      : {}),
    ...(report.browserManifest && integrityMap[report.browserManifest]
      ? {
          browserManifest: {
            file: report.browserManifest,
            integrity: integrityMap[report.browserManifest]!,
          },
        }
      : {}),
    ...(report.css && integrityMap[report.css]
      ? { assets: { css: integrityMap[report.css]! } }
      : {}),
    // Shared-singleton semantics (#546): the web report's record is primary —
    // the node env resolves the same workspace's node_modules, so the two
    // agree; an ssr-only report still carries the record.
    ...((report.shared ?? ssrReport?.shared)
      ? { shared: (report.shared ?? ssrReport?.shared)! }
      : {}),
    ...(files ? { files } : {}),
    ...(source ? { source } : {}),
    ...(gitSha ? { gitSha } : {}),
  });
}

/**
 * Version-manifest resolution (atomic-deploys 04): a config remote's
 * `pin` ({ manifest, integrity }) resolves to the derived entry-level fields
 * every consumer needs. Verification and the process-lifetime
 * last-known-good cache live in the verify engine; a fetch or SRI failure
 * with nothing cached propagates (a boot-time resolution failure fails the
 * deploy, which is the platform's rollback).
 */

export interface ResolvedRemoteVersion {
  /** The remote's production base (slot root — unprefixed by the version dir). */
  base: string;
  /** Absolute URL of the content-hashed container entry. */
  entryUrl: string;
  entryIntegrity: string;
  /** Absolute URL of the hashed browser manifest (mf-manifest), when present. */
  browserManifestUrl?: string;
  /** Absolute URL of the content-hashed SSR entry, when present. */
  ssrEntryUrl?: string;
  ssrIntegrity?: string;
  /** Shared-singleton `name → version` the pinned build embedded (#546) —
   * stamped onto UI remotes so the host's composition guard can detect a
   * platform skew before loading. */
  sharedVersions?: Record<string, string>;
  /** Slot-relative immutable version directory the artifact coordinates
   * resolve against (`versions/<dirId>`, #826) — undefined on legacy
   * manifests, which resolve against the slot root. */
  dir?: string;
  /** Full per-file digest map of the dist (object path → SRI), when the
   * pinned manifest carries one — the diff base for skip-unchanged uploads. */
  files?: Record<string, string>;
  /** Source archive reference from the pinned manifest (publish.sourcePublish). */
  source?: SourceRef;
}

export interface RemoteDigest {
  /** versioned manifest filename, relative to the remote's production base */
  manifest: string;
  /** the manifest document's own SRI */
  integrity: string;
}

export function clearRemoteVersionCache(): void {
  clearVerifiedCache();
}

function remoteVersionFromManifest(
  base: string,
  manifest: WorkspaceVersionManifest,
  options?: { ignoreDir?: boolean },
): ResolvedRemoteVersion {
  const trimmedBase = base.replace(/\/$/, "");
  const fileBase =
    manifest.dir && !options?.ignoreDir ? `${trimmedBase}/${manifest.dir}` : trimmedBase;
  return {
    base: trimmedBase,
    entryUrl: `${fileBase}/${manifest.entry}`,
    entryIntegrity: manifest.entryIntegrity,
    ...(manifest.dir ? { dir: manifest.dir } : {}),
    ...(manifest.browserManifest
      ? { browserManifestUrl: `${fileBase}/${manifest.browserManifest.file}` }
      : {}),
    ...(manifest.ssr
      ? {
          ssrEntryUrl: `${fileBase}/${manifest.ssr.entry}`,
          ssrIntegrity: manifest.ssr.integrity,
        }
      : {}),
    ...(manifest.shared ? { sharedVersions: manifest.shared } : {}),
    ...(manifest.files ? { files: manifest.files } : {}),
    ...(manifest.source ? { source: manifest.source } : {}),
  };
}

/**
 * Staged-remote preference (ADR 0020/0021 self-contained tier): when a runtime
 * stages its own namespace under `BOS_BUNDLE_DIR`, a remote resolves from the
 * staged dist's own version manifest instead of the config's pin — pinned
 * manifest bytes that predate the image (deploy lag after a release bump)
 * cannot exist in the staged namespace, so their hashed files would 404 the
 * disk and fall through to the network, where the stale immutable bytes
 * still answer 200 and boot a foreign build. The staged manifest is trusted
 * (staged by the image build itself) and skipped entirely when the remote is
 * absent from the staged namespace or the pinned manifest is present (the
 * normal healthy case, which keeps the pin's SRI check).
 */
function readStagedRemoteVersion(base: string, digest: RemoteDigest): ResolvedRemoteVersion | null {
  const bundleDir = process.env.BOS_BUNDLE_DIR;
  if (!bundleDir) return null;

  const slotDir = bundleUrlToStagedPath(base, bundleDir);
  if (!slotDir || !existsSync(slotDir)) return null;

  const pinnedManifestPath = resolveContained(slotDir, digest.manifest);
  if (!pinnedManifestPath || existsSync(pinnedManifestPath)) return null;

  const versionsDir = path.join(slotDir, "versions");
  if (!existsSync(versionsDir)) return null;
  const manifests = readdirSync(versionsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(versionsDir, name))
    .filter((file) => statSync(file).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || (a < b ? -1 : 1));
  if (manifests.length === 0) return null;
  const manifestPath = manifests[0];
  if (!manifestPath) return null;

  try {
    const manifest = WorkspaceVersionManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    // Staged dists materialize flat at the slot dir — `versions/<dirId>/` is
    // a CDN-layout concept the disk does not carry, so the manifest's dir
    // must not prefix the staged coordinates.
    return remoteVersionFromManifest(base, manifest, { ignoreDir: true });
  } catch {
    return null;
  }
}

export async function resolveRemoteVersion(input: {
  base: string;
  digest: RemoteDigest;
  fetchImpl?: typeof fetch;
}): Promise<Verified<ResolvedRemoteVersion>> {
  const staged = readStagedRemoteVersion(input.base, input.digest);
  if (staged) return mark(staged);

  const manifestUrl = manifestDocumentUrl(input.base, input.digest.manifest);
  try {
    const manifest = await verifyDocument({
      url: manifestUrl,
      expected: asDigest(input.digest.integrity),
      schema: WorkspaceVersionManifestSchema,
      fetchImpl: input.fetchImpl,
    });
    return mark(remoteVersionFromManifest(input.base, manifest));
  } catch (error) {
    throw new Error(
      `[SRI] version manifest verification failed for ${manifestUrl}: ${reasonOf(error)}`,
    );
  }
}
