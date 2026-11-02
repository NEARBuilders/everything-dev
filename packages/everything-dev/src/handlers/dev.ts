import { Effect } from "effect";
import { chainHeadPinLagNotice, resolvePlatformManifest } from "../services/platform/manifest";
import { DevFlowService } from "../services/dev/flow";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerDev(builder: BosBuilder) {
  return {
    dev: builder.dev.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const flow = yield* DevFlowService;
      const result = yield* flow.dev(session, input);
      if (result.status === "started") {
        const notice = yield* Effect.gen(function* () {
          const pin = session?.rawConfig?.platform;
          if (!session?.root || !pin) return undefined;
          const head = yield* Effect.tryPromise({
            try: () =>
              resolvePlatformManifest({
                configDir: session.root,
                localConfig: { ...session.rawConfig, platform: undefined },
              }),
            catch: () => null,
          });
          if (!head) return undefined;
          return chainHeadPinLagNotice(head.manifest.frameworkVersion, pin);
        });
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
