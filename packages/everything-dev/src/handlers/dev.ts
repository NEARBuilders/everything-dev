import { Effect } from "effect";
import { DevFlowService } from "../services/dev/flow";
import { chainHeadPinLagNotice } from "../services/platform/manifest";
import { auditSessionPlane, type PlaneAuditLine } from "../services/resolution/plane-audit";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

const renderAuditLines = (lines: readonly PlaneAuditLine[]): void => {
  const divergences = lines.filter((line) => line.kind !== "uncomposed");
  const notes = lines.filter((line) => line.kind === "uncomposed");
  if (divergences.length > 0) {
    console.log(`\n  ${divergences.length} release-plane divergence(s) in the composition:`);
    for (const line of divergences) {
      console.log(`  - ${line.message}`);
    }
    console.log("\n  The runtime survived on its pinned bytes — realign before shipping.\n");
  }
  if (notes.length > 0) {
    console.log(
      `\n  ${notes.length} pinned-release slot(s) this config does not compose (informational):`,
    );
    for (const line of notes) {
      console.log(`  - ${line.message}`);
    }
    console.log("");
  }
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
          session.rawConfig?.release,
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
