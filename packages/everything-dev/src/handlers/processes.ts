import { Effect } from "effect";
import type { PsResult } from "../contract";
import { ProcessesService } from "../services/processes/service";
import type { BosBuilder } from "./shared";

export function registerProcesses(builder: BosBuilder) {
  return {
    ps: builder.ps.effect(function* () {
      const processes = yield* ProcessesService;
      return yield* processes.list.pipe(
        Effect.map((entries): PsResult => ({ status: "ok", entries })),
        Effect.catchTag(
          "ProcessesRegistryError",
          (error): Effect.Effect<PsResult> =>
            Effect.succeed({
              status: "error",
              entries: [],
              error: error.message,
            }),
        ),
      );
    }),
  };
}
