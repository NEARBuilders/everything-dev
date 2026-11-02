import { Effect } from "effect";
import { collectSlotPinRefs } from "../services/deploy/rollback";
import { DevFlowService } from "../services/dev/flow";
import { readInstalledFrameworkVersion } from "../services/framework-version";
import { chainHeadPinLagNotice } from "../services/platform/manifest";
import {
  auditReleasePlane,
  authoredSlotPaths,
  type PlaneAuditLine,
} from "../services/resolution/release-plane";
import { type ResolutionSession, ResolutionSessionService } from "../services/resolution/session";
import { findWorkspaceRoot } from "../services/workspace/workspace";
import type { BosConfigInput } from "../types";
import type { BosBuilder } from "./shared";

const auditSessionPlane = (session: NonNullable<ResolutionSession>): Promise<PlaneAuditLine[]> =>
  auditReleasePlane({
    slots: collectSlotPinRefs((session.config ?? {}) as BosConfigInput),
    authoredPaths: authoredSlotPaths((session.rawConfig ?? {}) as Record<string, unknown>),
    localVersionOf: (name) =>
      readInstalledFrameworkVersion(findWorkspaceRoot(session.root)?.dir ?? session.root, name),
    provisionedSlots: session.releasePlane.omitted,
    pinnedReleaseVersion: session.releaseManifest?.frameworkVersion,
  });

const renderAuditLines = (lines: readonly PlaneAuditLine[]): void => {
  console.log(`\n  ${lines.length} release-plane divergence(s) in the composition:`);
  for (const line of lines) {
    console.log(`  - ${line.message}`);
  }
  console.log("\n  The runtime survived on its pinned bytes — realign before shipping.\n");
};

export function registerDev(builder: BosBuilder) {
  return {
    dev: builder.dev.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const flow = yield* DevFlowService;
      const result = yield* flow.dev(session, input);
      if (result.status === "started" && session) {
        const notice = chainHeadPinLagNotice(
          session.releaseManifest?.frameworkVersion,
          session.rawConfig?.platform,
        );
        if (notice) console.log(`\n  ${notice}\n`);
        const audit = yield* Effect.tryPromise({
          try: () => auditSessionPlane(session),
          catch: () => undefined,
        });
        if (audit && audit.length > 0) renderAuditLines(audit);
      }
      return result;
    }),

    start: builder.start.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const flow = yield* DevFlowService;
      return yield* flow.start(session, input);
    }),
  };
}
