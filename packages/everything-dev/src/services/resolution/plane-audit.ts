import type { BosConfigInput } from "../../types";
import { walkConfigSlots } from "../config-slots";
import { collectSlotPinRefs } from "../deploy/rollback";
import { readInstalledFrameworkVersion } from "../framework-version";
import { findWorkspaceRoot } from "../workspace/workspace";
import { auditReleasePlane, authoredSlotPaths, type PlaneAuditLine } from "./release-plane";
import type { ResolutionSession } from "./session";

/**
 * The one dev-boot chain-audit adapter: every consumer that audits a
 * resolution session's release plane (`bos dev`'s post-boot report, the
 * upgrade's owned-slot realignment) derives its inputs from here, so the
 * audit cannot fork into silently divergent copies.
 */
export {
  auditReleasePlane,
  authoredSlotPaths,
  type PlaneAuditLine,
} from "./release-plane";

export const auditSessionPlane = (
  session: NonNullable<ResolutionSession>,
  options?: { fetchImpl?: typeof fetch },
): Promise<PlaneAuditLine[]> =>
  auditReleasePlane({
    slots: collectSlotPinRefs((session.config ?? {}) as BosConfigInput),
    authoredPaths: authoredSlotPaths((session.rawConfig ?? {}) as Record<string, unknown>),
    localVersionOf: (name) =>
      readInstalledFrameworkVersion(findWorkspaceRoot(session.root)?.dir ?? session.root, name),
    provisionedSlots: session.releasePlane?.omitted,
    configSlotPaths: configSlotPathsOf(session.config),
    manifestSlotPaths: Object.keys(session.releaseManifest?.slots ?? {}),
    pinnedReleaseVersion: session.releaseManifest?.frameworkVersion,
    ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

const configSlotPathsOf = (config: unknown): string[] => {
  if (!config || typeof config !== "object") return [];
  const paths: string[] = [];
  walkConfigSlots(config as Record<string, unknown>, ({ slot }) => paths.push(slot));
  return paths;
};
