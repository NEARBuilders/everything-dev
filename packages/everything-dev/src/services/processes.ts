import { Context, Effect, Layer } from "effect";
import { type PidEntry, pruneDeadEffect, readRegistry } from "../process-registry";

export class ProcessesService extends Context.Service<
  ProcessesService,
  {
    /** Live entries from the shared pid registry, dead claims pruned. */
    list: () => Effect.Effect<PidEntry[], Error>;
  }
>()("bos/ProcessesService") {
  static Live = Layer.succeed(
    ProcessesService,
    ProcessesService.of({
      list: () =>
        Effect.try({
          try: readRegistry,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(Effect.flatMap(pruneDeadEffect)),
    }),
  );
}
