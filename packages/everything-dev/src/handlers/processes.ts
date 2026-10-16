import { Effect } from "effect";
import type { BosBuilder } from "../commands/shared";
import type { PsResult } from "../contract";
import { ProcessesService } from "../services/processes";

export function registerProcesses(builder: BosBuilder) {
  return {
    ps: builder.ps.effect(function* () {
      const processes = yield* ProcessesService;
      return yield* processes.list().pipe(
        Effect.map((entries): PsResult => ({ status: "ok", entries })),
        Effect.catchIf(
          (error) => error instanceof Error,
          (error): Effect.Effect<PsResult> =>
            Effect.succeed({
              status: "error",
              entries: [],
              error: error instanceof Error ? error.message : "Unknown error",
            }),
        ),
      );
    }),
  };
}
