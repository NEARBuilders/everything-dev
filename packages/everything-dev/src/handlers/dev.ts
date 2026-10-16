import type { DevResult, StartResult } from "../contract";
import { DevFlowService } from "../services/dev-flow";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerDev(builder: BosBuilder) {
  return {
    dev: builder.dev.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const flow = yield* DevFlowService;
      return yield* flow.dev(session, input);
    }),

    start: builder.start.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const flow = yield* DevFlowService;
      return yield* flow.start(session, input);
    }),
  };
}
