import type { BosConfigInput } from "../../types";
import { collectRemoteDescriptors } from "../deploy/rollback";
import { readInstalledFrameworkVersion } from "../framework-version";
import { walkRemotes } from "../remotes";
import { findWorkspaceRoot } from "../workspace/workspace";
import {
  auditReleaseComposition,
  authoredRemoteKeys,
  type CompositionAuditLine,
} from "./release-composition";
import type { ResolutionSession } from "./session";

/**
 * The one dev-boot chain-audit adapter: every consumer that audits a
 * resolution session's release plane (`bos dev`'s post-boot report, the
 * upgrade's owned-remote realignment) derives its inputs from here, so the
 * audit cannot fork into silently divergent copies.
 */
export {
  auditReleaseComposition,
  authoredRemoteKeys,
  type CompositionAuditLine,
} from "./release-composition";

export const auditSessionComposition = (
  session: NonNullable<ResolutionSession>,
  options?: { fetchImpl?: typeof fetch },
): Promise<CompositionAuditLine[]> =>
  auditReleaseComposition({
    remotes: collectRemoteDescriptors((session.config ?? {}) as BosConfigInput),
    authoredPaths: authoredRemoteKeys((session.rawConfig ?? {}) as Record<string, unknown>),
    localVersionOf: (name) =>
      readInstalledFrameworkVersion(findWorkspaceRoot(session.root)?.dir ?? session.root, name),
    provisionedRemotes: session.releaseComposition?.omitted,
    configRemotePaths: configRemotePathsOf(session.config),
    manifestRemotePaths: Object.keys(session.releaseManifest?.remotes ?? {}),
    pinnedReleaseVersion: session.releaseManifest?.frameworkVersion,
    ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

const configRemotePathsOf = (config: unknown): string[] => {
  if (!config || typeof config !== "object") return [];
  const paths: string[] = [];
  walkRemotes(config as Record<string, unknown>, ({ remote, entry }) => {
    // call-only attachments (proxy + contract, no composed source) compose
    // no federation remote, so the "served by the extends chain but missing
    // from the release composition" line is meaningless for them (their
    // types locator points at the provider's release; their traffic endpoint
    // is authored proxy).
    if (
      remote.startsWith("plugins.") &&
      !remote.endsWith(".ui") &&
      typeof entry === "object" &&
      entry !== null &&
      (entry as { contract?: unknown }).contract !== undefined
    ) {
      return;
    }
    paths.push(remote);
  });
  return paths;
};
