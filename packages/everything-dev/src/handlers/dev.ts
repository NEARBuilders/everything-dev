import { DevFlowService } from "../services/dev/flow";
import { chainHeadPinLagNotice } from "../services/platform/manifest";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerDev(builder: BosBuilder) {
  return {
    dev: builder.dev.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const flow = yield* DevFlowService;
      const result = yield* flow.dev(session, input);
      if (result.status === "started") {
        const notice = chainHeadPinLagNotice(
          session?.releaseManifest?.frameworkVersion,
          session?.rawConfig?.platform,
        );
        if (notice) console.log(`\n  ${notice}\n`);
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
