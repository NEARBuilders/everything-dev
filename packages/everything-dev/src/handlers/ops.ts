import type { InfraExportResult, KillResult, LogsResult, StatusResult } from "../contract";
import { OpsService } from "../services/ops";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerOps(builder: BosBuilder) {
  return {
    status: builder.status.effect(function* () {
      const session = yield* ResolutionSessionService;
      const ops = yield* OpsService;
      return yield* ops.status(session);
    }),

    logs: builder.logs.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const ops = yield* OpsService;
      return yield* ops.logs(input, session?.root ?? process.cwd());
    }),

    kill: builder.kill.effect(function* (_opts, input) {
      const ops = yield* OpsService;
      return yield* ops.kill(input);
    }),

    infraExport: builder.infraExport.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const ops = yield* OpsService;
      return yield* ops.infraExport(session, input.configDir);
    }),
  };
}
