import { readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SourceRef } from "every-plugin/version-manifest";
import {
  diffWorkspaceFiles,
  localSriMap,
  mergedFileIntegrity,
  type PreviousPin,
} from "../../deploy-diff";
import { buildSourceArchive, makeSourceArchiveTempDir } from "../../source-archive";
import {
  type BundleUploadResult,
  collectDistFiles,
  type DistFile,
  uploadBundle,
  uploadWorkspaceDist,
} from "../../storage-upload";
import { padRight } from "../../utils/string";
import { colors, icons } from "../../utils/theme";
import { formatDuration } from "../../utils/timing";
import { composeWorkspaceVersionManifest, readBuildReport } from "../../version-manifest-deploy";
import { resolveSlotVersion } from "../../version-manifest-resolve";

/**
 * The ONE workspace upload leg (ticket #422): dist collection → diff upload
 * → version-manifest pin → memory-backend guard. Every workspace bundle in
 * the train — the workspace itself and a folder-form plugin's `-ui` sub-bundle —
 * goes through this single implementation; the previous near line-for-line ui
 * copy is gone.
 */

export interface VersionManifestPin {
  file: string;
  integrity: string;
  storage?: "s3" | "memory";
}

/** The storage surface the upload leg needs — injectable for tests, provided
 * by the real modules in production (BundleStorage service in T3). */
export interface StorageLegDeps {
  collectDistFiles: typeof collectDistFiles;
  uploadWorkspaceDist: typeof uploadWorkspaceDist;
  uploadBundle: typeof uploadBundle;
  resolveSlotVersion: typeof resolveSlotVersion;
  readBuildReport: typeof readBuildReport;
  composeWorkspaceVersionManifest: typeof composeWorkspaceVersionManifest;
  buildSourceArchive: typeof buildSourceArchive;
}

export const realStorageLegDeps: StorageLegDeps = {
  collectDistFiles,
  uploadWorkspaceDist,
  uploadBundle,
  resolveSlotVersion,
  readBuildReport,
  composeWorkspaceVersionManifest,
  buildSourceArchive,
};

function formatBundleMb(files: Array<{ bytes: Uint8Array }>): string {
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  return `${(total / 1024 / 1024).toFixed(1)} MB`;
}

interface DiffUploadOutcome {
  result: BundleUploadResult;
  /** per-file SRI map covering the whole dist (uploaded → server SRI, skipped → previous manifest SRI) */
  fileIntegrity: Record<string, string>;
  uploaded: number;
  skipped: number;
  total: number;
}

/** One workspace's upload with skip-unchanged diffing; any failure to resolve
 * the previous manifest's file map degrades to a full upload. */
async function diffUploadWorkspace(
  deps: StorageLegDeps,
  input: {
    origin: string;
    apiKey?: string;
    account: string;
    gateway: string;
    workspace: string;
    files: DistFile[];
    base: string;
    previousPin: PreviousPin | undefined;
  },
): Promise<DiffUploadOutcome> {
  const localSri = localSriMap(input.files);
  let uploadFiles = input.files;
  let prevFiles: Record<string, string> | undefined;
  if (input.previousPin) {
    try {
      const resolved = await deps.resolveSlotVersion({ base: input.base, pin: input.previousPin });
      if (resolved.files) {
        const diff = diffWorkspaceFiles(input.files, localSri, resolved.files);
        prevFiles = resolved.files;
        uploadFiles = diff.upload;
        if (diff.skipped > 0) {
          console.log(
            `    ${colors.dim(`${padRight(input.workspace, 28)} ${diff.skipped} unchanged file(s) — skipping (manifest diff)`)}`,
          );
        }
      }
    } catch {
      console.log(
        `    ${colors.dim(`${padRight(input.workspace, 28)} previous manifest unusable — uploading everything`)}`,
      );
    }
  }

  console.log(
    `    ${padRight(input.workspace, 28)} uploading ${uploadFiles.length} of ${input.files.length} files (${formatBundleMb(uploadFiles)}) → ${input.base}`,
  );
  const result =
    uploadFiles.length > 0
      ? await deps.uploadWorkspaceDist({
          origin: input.origin,
          apiKey: input.apiKey,
          account: input.account,
          gateway: input.gateway,
          workspace: input.workspace,
          files: uploadFiles,
        })
      : { stored: 0, totalBytes: 0, integrity: {} };
  return {
    result,
    fileIntegrity: mergedFileIntegrity(input.files, result.integrity, prevFiles),
    uploaded: result.stored,
    skipped: input.files.length - uploadFiles.length,
    total: input.files.length,
  };
}

/** Compose + upload the workspace's version manifest — server-computed SRI of
 * the just-finished upload, uploaded additively at `versions/<version>.json`.
 * Returns undefined when the dist predates hashed entry names. */
async function pinWorkspaceVersionManifest(
  deps: StorageLegDeps,
  input: {
    origin: string;
    apiKey?: string;
    account: string;
    gateway: string;
    workspace: string;
    report: ReturnType<typeof readBuildReport>;
    ssrReport: ReturnType<typeof readBuildReport>;
    integrityMap: Record<string, string>;
    files?: Record<string, string>;
    source?: SourceRef;
    gitSha?: string;
  },
): Promise<VersionManifestPin | undefined> {
  if (!input.report) return undefined;
  const versionManifest = deps.composeWorkspaceVersionManifest({
    report: input.report,
    ssrReport: input.ssrReport,
    integrityMap: input.integrityMap,
    ...(input.files ? { files: input.files } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.gitSha ? { gitSha: input.gitSha } : {}),
  });
  if (!versionManifest) return undefined;

  const manifestFile = `versions/${versionManifest.version}.json`;
  const manifestUpload = await deps.uploadBundle({
    origin: input.origin,
    apiKey: input.apiKey,
    account: input.account,
    gateway: input.gateway,
    workspace: input.workspace,
    files: [
      {
        path: manifestFile,
        bytes: new TextEncoder().encode(`${JSON.stringify(versionManifest, null, 2)}\n`),
      },
    ],
  });
  const manifestIntegrity = manifestUpload.integrity[manifestFile];
  if (!manifestIntegrity) return undefined;
  console.log(
    `    ${colors.dim(`${padRight("", 28)} version manifest ${manifestFile} (SRI pinned)`)}`,
  );
  return { file: manifestFile, integrity: manifestIntegrity, storage: manifestUpload.storage };
}

/** Source-archive leg (publish.sourcePublish, #406): tar the workspace
 * subtree, dedupe against the previous pin by archive SRI, otherwise upload
 * and take the server-computed SRI. The temp dir is cleaned on every path. */
async function resolveSourceReference(
  deps: StorageLegDeps,
  input: {
    origin: string;
    apiKey?: string;
    account: string;
    gateway: string;
    workspace: string;
    base: string;
    previousPin: PreviousPin | undefined;
    repoRoot: string;
    workspaceDir: string;
  },
): Promise<{ source: SourceRef } | { memory: true }> {
  const outDir = makeSourceArchiveTempDir();
  try {
    const archive = await deps.buildSourceArchive({
      repoRoot: input.repoRoot,
      workspace: input.workspaceDir,
      outDir,
    });
    if (input.previousPin) {
      try {
        const resolved = await deps.resolveSlotVersion({
          base: input.base,
          pin: input.previousPin,
        });
        if (resolved.source?.integrity === archive.integrity) {
          console.log(
            `    ${colors.dim(`${padRight(input.workspace, 28)} source unchanged — reusing ${archive.file}`)}`,
          );
          return {
            source: { file: resolved.source.file, integrity: resolved.source.integrity },
          };
        }
      } catch {
        // previous manifest unusable — fall through to a full upload
      }
    }
    const upload = await deps.uploadBundle({
      origin: input.origin,
      apiKey: input.apiKey,
      account: input.account,
      gateway: input.gateway,
      workspace: input.workspace,
      files: [{ path: archive.file, bytes: new Uint8Array(readFileSync(archive.path)) }],
    });
    if (upload.storage === "memory") return { memory: true };
    const integrity = upload.integrity[archive.file];
    if (!integrity) {
      throw new Error(
        `[publish] source archive upload for ${input.workspace}: missing server SRI for ${archive.file}`,
      );
    }
    console.log(
      `    ${colors.dim(`${padRight(input.workspace, 28)} source archive ${archive.file}`)}`,
    );
    return { source: { file: archive.file, integrity } };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

export interface UploadWorkspaceBundleInput {
  account: string;
  gateway: string;
  /** bundle key: the workspace key itself, or `<key>-ui` for the folder-form ui sub-bundle */
  workspaceKey: string;
  distDir: string;
  storageOrigin: string;
  storageApiKey?: string;
  /** the public CDN origin the bundle URL is printed + pinned against */
  urlOrigin: string;
  previousPin: PreviousPin | undefined;
  /** enable the source-archive leg (publish.sourcePublish) — main workspaces only */
  source?: { repoRoot: string; workspaceDir: string };
  gitSha?: string;
  deps?: StorageLegDeps;
}

export type WorkspaceBundleUpload =
  | {
      kind: "ok";
      pin: VersionManifestPin;
      /** the serving backend of the diff upload — memory aborts the train */
      storage?: "s3" | "memory";
      /** entry SRI keyed by the build report's hashed name */
      entryIntegrity?: string;
      ssrEntryIntegrity?: string;
      uploaded: number;
      skipped: number;
      durationMs: number;
    }
  | { kind: "memory" }
  /** the dist predates hashed entry names — the train aborts (atomic-deploys hard break) */
  | { kind: "missing-manifest" }
  | { kind: "error"; message: string };

export async function uploadWorkspaceBundle(
  input: UploadWorkspaceBundleInput,
): Promise<WorkspaceBundleUpload> {
  const deps = input.deps ?? realStorageLegDeps;
  const base = `${input.urlOrigin}/bundles/${input.account}/${input.gateway}/${input.workspaceKey}/`;
  const startedAt = Date.now();
  let phase: "upload" | "source" = "upload";
  try {
    const distFiles = await deps.collectDistFiles(input.distDir);
    const outcome = await diffUploadWorkspace(deps, {
      origin: input.storageOrigin,
      apiKey: input.storageApiKey,
      account: input.account,
      gateway: input.gateway,
      workspace: input.workspaceKey,
      files: distFiles,
      base,
      previousPin: input.previousPin,
    });
    const report = deps.readBuildReport(input.distDir);
    const ssrReport = deps.readBuildReport(join(input.distDir, "ssr"));
    const entryIntegrity = report ? outcome.fileIntegrity[report.entry] : undefined;
    const ssrEntryIntegrity = ssrReport?.entry
      ? outcome.fileIntegrity[`ssr/${ssrReport.entry}`]
      : undefined;

    let sourceRef: SourceRef | undefined;
    if (input.source) {
      if (outcome.result.storage === "memory") {
        return { kind: "memory" };
      }
      phase = "source";
      const sourceOutcome = await resolveSourceReference(deps, {
        origin: input.storageOrigin,
        apiKey: input.storageApiKey,
        account: input.account,
        gateway: input.gateway,
        workspace: input.workspaceKey,
        base,
        previousPin: input.previousPin,
        repoRoot: input.source.repoRoot,
        workspaceDir: input.source.workspaceDir,
      });
      if ("memory" in sourceOutcome) return { kind: "memory" };
      sourceRef = sourceOutcome.source;
      phase = "upload";
    }

    const pin = await pinWorkspaceVersionManifest(deps, {
      origin: input.storageOrigin,
      apiKey: input.storageApiKey,
      account: input.account,
      gateway: input.gateway,
      workspace: input.workspaceKey,
      report,
      ssrReport,
      integrityMap: outcome.fileIntegrity,
      files: outcome.fileIntegrity,
      ...(sourceRef ? { source: sourceRef } : {}),
      ...(input.gitSha ? { gitSha: input.gitSha } : {}),
    });
    if (!pin) return { kind: "missing-manifest" };
    if (outcome.result.storage === "memory" || pin.storage === "memory") {
      return { kind: "memory" };
    }

    console.log(
      `    ${colors.green(icons.ok)} ${padRight(input.workspaceKey, 28)} → ${base} (${outcome.uploaded} uploaded, ${outcome.skipped} skipped, ${formatDuration(Date.now() - startedAt)})`,
    );
    return {
      kind: "ok",
      pin,
      storage: outcome.result.storage,
      entryIntegrity,
      ssrEntryIntegrity,
      uploaded: outcome.uploaded,
      skipped: outcome.skipped,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : phase === "source"
            ? `[publish] source archive for ${input.workspaceKey} failed`
            : `[publish] bundle upload for ${input.workspaceKey} failed`,
    };
  }
}

/** Directory names the source leg needs (main workspaces only). */
export function sourceLegDirs(workspacePath: string): { repoRoot: string; workspaceDir: string } {
  return { repoRoot: dirname(workspacePath), workspaceDir: basename(workspacePath) };
}
