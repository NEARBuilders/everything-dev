import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BuildEntryReport, BuildEntryReportSchema } from "every-plugin/build/artifact-names";
import {
  composeVersionManifest,
  type WorkspaceVersionManifest,
} from "every-plugin/version-manifest";

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
}): WorkspaceVersionManifest | null {
  const { report, ssrReport, integrityMap, files } = input;

  const entryIntegrity = integrityMap[report.entry];
  if (!entryIntegrity) return null;

  const ssrEntry = ssrReport?.entry;
  const ssrIntegrity = ssrEntry ? integrityMap[`ssr/${ssrEntry}`] : undefined;

  return composeVersionManifest({
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
    ...(files ? { files } : {}),
  });
}
